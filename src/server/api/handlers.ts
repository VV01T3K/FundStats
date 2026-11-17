import { sql } from "drizzle-orm"
import { Duration, Effect, Layer } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/http-api"
import { FundStatsApi, InstrumentNotFound, SourceNotFound, type SourceStatus } from "#/shared/api.ts"
import { isSourceId, SOURCE_IDS, SOURCES, type SourceId } from "#/shared/sources.ts"
import { Collector } from "../collector/Collector.ts"
import { AppConfig } from "../config.ts"
import { Database } from "../db/Database.ts"
import { type RunSummary, Store } from "../db/Store.ts"

const DEFAULT_HISTORY_LIMIT = 500
const MAX_HISTORY_LIMIT = 5000

/** A source is stale when its last run failed or its last success is more than two intervals old. */
export const isStale = (summary: RunSummary, interval: Duration.Duration, now = Date.now()) => {
	if (summary.lastSuccess === null) return true
	if (summary.lastRun?.status === "failed") return true
	const age = now - Date.parse(summary.lastSuccess.startedAt)
	return age > 2 * Duration.toMillis(interval) + 5 * 60_000
}

const sourceStatus = Effect.fn("sourceStatus")(function* (id: SourceId) {
	const store = yield* Store
	const collector = yield* Collector
	const summary = yield* store.runSummary(id)
	const interval = collector.interval(id)
	const info = SOURCES[id]
	return {
		id,
		name: info.name,
		kind: info.kind,
		currency: info.currency,
		intervalSeconds: Math.round(Duration.toSeconds(interval)),
		lastRun: summary.lastRun,
		lastSuccess: summary.lastSuccess,
		stale: isStale(summary, interval),
	} satisfies SourceStatus
})

const requireSource = (source: string) =>
	isSourceId(source) ? Effect.succeed(source) : Effect.fail(new SourceNotFound({ source }))

export const SystemHandlers = HttpApiBuilder.group(
	FundStatsApi,
	"system",
	Effect.fn(function* (handlers) {
		const database = yield* Database
		const config = yield* AppConfig
		return handlers.handle("health", () =>
			database
				.use("health", (db) => db.execute(sql`select 1`))
				.pipe(
					Effect.as({
						status: "ok" as const,
						database: "ok" as const,
						collectorEnabled: config.collectorEnabled,
					}),
					Effect.catchTag("DatabaseError", () => Effect.fail(new HttpApiError.ServiceUnavailable())),
				),
		)
	}),
)

export const SourcesHandlers = HttpApiBuilder.group(
	FundStatsApi,
	"sources",
	Effect.fn(function* (handlers) {
		const store = yield* Store
		const collector = yield* Collector
		const withServices = <A, E>(effect: Effect.Effect<A, E, Store | Collector>) =>
			effect.pipe(Effect.provideService(Store, store), Effect.provideService(Collector, collector))

		return handlers
			.handle("list", () =>
				withServices(Effect.forEach(SOURCE_IDS, sourceStatus, { concurrency: "unbounded" })).pipe(Effect.orDie),
			)
			.handle("latest", ({ params }) =>
				Effect.gen(function* () {
					const id = yield* requireSource(params.source)
					const [source, rows] = yield* Effect.all([withServices(sourceStatus(id)), store.latest(id)], {
						concurrency: 2,
					}).pipe(Effect.orDie)
					return { source, rows }
				}),
			)
			.handle("history", ({ params, query }) =>
				Effect.gen(function* () {
					const id = yield* requireSource(params.source)
					const limit = Math.min(Math.max(query.limit ?? DEFAULT_HISTORY_LIMIT, 1), MAX_HISTORY_LIMIT)
					const result = yield* store.history(id, params.externalId, limit).pipe(Effect.orDie)
					if (result === null) {
						return yield* new InstrumentNotFound({ source: id, externalId: params.externalId })
					}
					return { source: id, externalId: params.externalId, name: result.name, points: result.points }
				}),
			)
	}),
)

export const ApiHandlers = Layer.mergeAll(SystemHandlers, SourcesHandlers)
