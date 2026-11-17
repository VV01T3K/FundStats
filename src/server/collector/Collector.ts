import { Cause, Context, Duration, Effect, Layer, Option, Schema, Semaphore } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { SOURCE_IDS, type SourceId } from "#/shared/sources.ts"
import { AppConfig } from "../config.ts"
import type { DatabaseError } from "../db/Database.ts"
import { type PersistResult, Store } from "../db/Store.ts"
import { registry } from "../sources/registry.ts"
import { type AnySource, SourceError } from "../sources/Source.ts"

export class UnknownSource extends Schema.TaggedError<UnknownSource>()("UnknownSource", {
	source: Schema.String,
}) {}

export type RunTrigger = "schedule" | "cli" | "test"

/** After a failed run, retry sooner than the normal interval, but not more often than this. */
const FAILURE_RETRY = Duration.minutes(10)

/**
 * Runs sources: fetch from upstream → keep raw payload → normalize → persist.
 * Every run is recorded in `collection_runs`, including failures.
 */
export class Collector extends Context.Service<
	Collector,
	{
		readonly interval: (source: SourceId) => Duration.Duration
		readonly runOnce: (
			source: string,
			trigger: RunTrigger,
		) => Effect.Effect<PersistResult, UnknownSource | SourceError | DatabaseError>
	}
>()("fundstats/server/collector/Collector") {
	static readonly layerNoDeps = Layer.effect(
		Collector,
		Effect.gen(function* () {
			const config = yield* AppConfig
			const store = yield* Store
			const httpClient = yield* HttpClient.HttpClient
			// One run per source at a time inside this process.
			const locks = new Map(SOURCE_IDS.map((id) => [id, Semaphore.makeUnsafe(1)]))

			const interval = (id: SourceId) =>
				Option.getOrElse(config.intervalOverride(id), () => Duration.fromInputUnsafe(registry[id].defaultInterval))

			const runOnce = Effect.fn("Collector.runOnce")(
				function* (sourceId: string, trigger: RunTrigger) {
					if (!Object.hasOwn(registry, sourceId)) {
						return yield* new UnknownSource({ source: sourceId })
					}
					const id = sourceId as SourceId
					const source: AnySource = registry[id]
					const lock = locks.get(id) as Semaphore.Semaphore
					return yield* Semaphore.withPermits(
						lock,
						1,
					)(
						Effect.gen(function* () {
							const runId = yield* store.startRun(id, trigger)
							const capturedAt = new Date()
							return yield* Effect.gen(function* () {
								const fetched = yield* source.fetch
								yield* store.saveRawPayload(runId, id, fetched.raw)
								const rows = yield* Effect.try({
									try: () => source.normalize(fetched.payload),
									catch: (cause) =>
										new SourceError({
											source: id,
											reason: "decode",
											message: `normalize failed: ${String(cause)}`,
											cause,
										}),
								})
								if (rows.length === 0) {
									return yield* new SourceError({
										source: id,
										reason: "upstream",
										message: "Upstream returned no instruments",
									})
								}
								const result = yield* store.persist({
									source: id,
									kind: source.info.kind,
									runId,
									capturedAt,
									rows,
								})
								yield* Effect.logInfo(
									`Collected ${id}: ${result.instrumentCount} instruments, ${result.rowsWritten} rows written`,
								)
								return result
							}).pipe(Effect.onError((cause) => store.failRun(runId, describe(cause)).pipe(Effect.ignore)))
						}),
					)
				},
				Effect.provideService(HttpClient.HttpClient, httpClient),
				Effect.provideService(AppConfig, config),
			)

			return Collector.of({ interval, runOnce })
		}),
	)

	static readonly layer = Collector.layerNoDeps.pipe(Layer.provide(FetchHttpClient.layer))
}

const describe = (cause: Cause.Cause<unknown>): string => {
	const error = Cause.squash(cause)
	if (Cause.hasInterruptsOnly(cause)) return "Interrupted"
	if (Schema.is(SourceError)(error)) return `${error.reason}: ${error.message}`
	if (error instanceof Error) return error.message
	return Cause.pretty(cause)
}

/**
 * Background fibers that run every source on its interval. Built only by the
 * app runtime (never by the CLI or tests) and only when COLLECTOR_ENABLED is
 * true. The fibers live in the layer's scope, so disposing the runtime stops
 * them.
 */
export const CollectorScheduler = Layer.effectDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfig
		const store = yield* Store
		const collector = yield* Collector
		if (!config.collectorEnabled) {
			yield* Effect.logInfo("Collector disabled (COLLECTOR_ENABLED=false)")
			return
		}
		const closed = yield* store.closeInterruptedRuns
		if (closed > 0) yield* Effect.logWarning(`Closed ${closed} interrupted collection run(s)`)

		for (const id of SOURCE_IDS) {
			const every = collector.interval(id)
			// Wait until the source is due, judged by its last run in the database,
			// so restarts and redeploys do not hit upstreams again early.
			const tick = Effect.gen(function* () {
				const { lastRun } = yield* store.runSummary(id)
				let delay = Duration.zero
				if (lastRun) {
					const wait = lastRun.status === "failed" ? Duration.min(every, FAILURE_RETRY) : every
					const due = Date.parse(lastRun.startedAt) + Duration.toMillis(wait)
					delay = Duration.millis(Math.max(0, due - Date.now()))
				}
				yield* Effect.sleep(delay)
				yield* collector.runOnce(id, "schedule")
			}).pipe(
				Effect.catchCause((cause) =>
					Effect.logError(`Collector run for ${id} failed: ${describe(cause)}`).pipe(
						// Avoid a hot loop if the database itself is down.
						Effect.andThen(Effect.sleep("1 minute")),
					),
				),
			)
			yield* Effect.forkScoped(Effect.forever(tick))
			yield* Effect.logInfo(`Collector scheduled ${id} every ${Duration.format(every)}`)
		}

		yield* Effect.forkScoped(
			Effect.forever(
				store.pruneRawPayloads(config.rawPayloadRetentionDays).pipe(
					Effect.tap((n) => (n > 0 ? Effect.logInfo(`Pruned ${n} raw payload(s)`) : Effect.void)),
					Effect.catchCause((cause) => Effect.logWarning(`Raw payload pruning failed: ${describe(cause)}`)),
					Effect.andThen(Effect.sleep("1 day")),
				),
			),
		)
	}),
)
