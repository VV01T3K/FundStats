import { DataEvents } from "@fundstats/db/DataEvents"
import { type RunSummary, type SourceSchedule, Store } from "@fundstats/db/Store"
import { FundStatsApi, InstrumentNotFound, SourceNotFound, type SourceStatus } from "@fundstats/shared/api"
import { isSourceId, SOURCE_IDS, SOURCES, type SourceId } from "@fundstats/shared/sources"
import * as Clock from "effect/Clock"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { HttpApiBuilder, HttpApiError } from "effect/http-api"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"

const DEFAULT_HISTORY_LIMIT = 500
const DEFAULT_SPARKLINE_POINTS = 24
const DEFAULT_SEARCH_LIMIT = 30

/** A source is stale when its last run failed or its last success is more than two intervals old. */
export const isStale = (summary: RunSummary, interval: Duration.Duration, now: number) => {
	if (summary.lastSuccess === null) return true
	if (summary.lastRun?.status === "failed") return true
	const age = now - Date.parse(summary.lastSuccess.startedAt)
	return age > 2 * Duration.toMillis(interval) + 5 * 60_000
}

/** The interval the collector last recorded for `id`, or the source's default before it ever started. */
const intervalOf = (schedules: ReadonlyArray<SourceSchedule>, id: SourceId) => {
	const schedule = schedules.find((s) => s.source === id)
	return schedule ? Duration.seconds(schedule.intervalSeconds) : Duration.fromInputUnsafe(SOURCES[id].defaultInterval)
}

const sourceStatus = Effect.fn("SourcesApi.sourceStatus")(function* (
	id: SourceId,
	schedules: ReadonlyArray<SourceSchedule>,
) {
	const store = yield* Store
	const summary = yield* store.runSummary(id)
	const interval = intervalOf(schedules, id)
	const now = yield* Clock.currentTimeMillis
	const info = SOURCES[id]
	return {
		id,
		name: info.name,
		kind: info.kind,
		currency: info.currency,
		intervalSeconds: Math.round(Duration.toSeconds(interval)),
		lastRun: summary.lastRun,
		lastSuccess: summary.lastSuccess,
		stale: isStale(summary, interval, now),
	} satisfies SourceStatus
})

const requireSource = (source: string) =>
	isSourceId(source) ? Effect.succeed(source) : Effect.fail(new SourceNotFound({ source }))

const SystemHandlers = HttpApiBuilder.group(
	FundStatsApi,
	"system",
	Effect.fn("SystemApi.handlers")(function* (handlers) {
		const store = yield* Store
		return handlers.handle("health", () =>
			store.schedules.pipe(
				Effect.map((schedules) => ({
					status: "ok" as const,
					database: "ok" as const,
					collectorEnabled: schedules.some((s) => s.enabled),
				})),
				Effect.catchTags({ EffectDrizzleQueryError: () => Effect.fail(new HttpApiError.ServiceUnavailable()) }),
			),
		)
	}),
)

const SourcesHandlers = HttpApiBuilder.group(
	FundStatsApi,
	"sources",
	Effect.fn("SourcesApi.handlers")(function* (handlers) {
		const store = yield* Store
		const dataEvents = yield* DataEvents
		const withStore = <A, E>(effect: Effect.Effect<A, E, Store>) => effect.pipe(Effect.provideService(Store, store))

		return handlers
			.handle("list", () =>
				store.schedules.pipe(
					Effect.flatMap((schedules) =>
						withStore(Effect.forEach(SOURCE_IDS, (id) => sourceStatus(id, schedules), { concurrency: "unbounded" })),
					),
					Effect.orDie,
				),
			)
			.handle("latest", ({ params }) =>
				Effect.gen(function* () {
					const id = yield* requireSource(params.source)
					const [source, rows] = yield* Effect.all(
						[
							store.schedules.pipe(Effect.flatMap((schedules) => withStore(sourceStatus(id, schedules)))),
							store.latest(id),
						],
						{ concurrency: 2 },
					).pipe(Effect.orDie)
					return { source, rows }
				}),
			)
			.handle("history", ({ params, query }) =>
				Effect.gen(function* () {
					const id = yield* requireSource(params.source)
					const result = yield* store
						.history(id, params.externalId, query.limit ?? DEFAULT_HISTORY_LIMIT)
						.pipe(Effect.orDie)
					if (result === null) {
						return yield* new InstrumentNotFound({ source: id, externalId: params.externalId })
					}
					return { source: id, externalId: params.externalId, name: result.name, points: result.points }
				}),
			)
			.handle("sparklines", ({ params, query }) =>
				Effect.gen(function* () {
					const id = yield* requireSource(params.source)
					const points = query.points ?? DEFAULT_SPARKLINE_POINTS
					const series = yield* store.sparklines(id, points).pipe(Effect.orDie)
					return { source: id, points, series }
				}),
			)
			.handle("search", ({ query }) =>
				store.search(query.q, query.limit ?? DEFAULT_SEARCH_LIMIT).pipe(
					Effect.map((hits) => ({
						query: query.q,
						hits: hits.flatMap((hit) => (isSourceId(hit.source) ? [{ ...hit, source: hit.source }] : [])),
					})),
					Effect.orDie,
				),
			)
			.handle("events", () =>
				Effect.succeed(
					dataEvents.changes.pipe(
						Stream.filter(isSourceId),
						Stream.map((source) => ({ source })),
					),
				),
			)
	}),
)

export const ApiHandlers = Layer.mergeAll(SystemHandlers, SourcesHandlers)
