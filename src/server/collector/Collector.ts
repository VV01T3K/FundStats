import { Cause, Context, Duration, Effect, Layer, Option, Schema, Semaphore } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { SOURCE_IDS, type SourceId } from "#/shared/sources.ts"
import { AppConfig } from "../config.ts"
import { Database, type DatabaseError, SourceBusy } from "../db/Database.ts"
import { type PersistResult, Store } from "../db/Store.ts"
import { registry } from "../sources/registry.ts"
import { type AnySource, decodePayload, SourceError } from "../sources/Source.ts"

export class UnknownSource extends Schema.TaggedError<UnknownSource>()("UnknownSource", {
	source: Schema.String,
}) {}

export type RunTrigger = "schedule" | "cli" | "test"

/** After a failed run, retry sooner than the normal interval, but not more often than this. */
const FAILURE_RETRY = Duration.minutes(10)

/**
 * Runs sources: fetch from upstream → keep raw payload → decode → normalize →
 * persist. Every run is recorded in `collection_runs`, including failures.
 *
 * A run holds its source's database lock from before the run row is created
 * until persistence ends, so two processes (app and CLI, or two replicas)
 * never collect the same source at once. A run that finds the lock taken
 * fails with SourceBusy and records nothing.
 */
export class Collector extends Context.Service<
	Collector,
	{
		readonly interval: (source: SourceId) => Duration.Duration
		readonly runOnce: (
			source: string,
			trigger: RunTrigger,
		) => Effect.Effect<PersistResult, UnknownSource | SourceBusy | SourceError | DatabaseError>
	}
>()("fundstats/server/collector/Collector") {
	static readonly layerNoDeps = Layer.effect(
		Collector,
		Effect.gen(function* () {
			const config = yield* AppConfig
			const store = yield* Store
			const database = yield* Database
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
					// The run row to close if the run fails. Failure is recorded outside
					// the lock, so it is also recorded when the lock connection is lost.
					let openRun: number | undefined
					const run = database
						.withSourceLock(id, (lock) =>
							Effect.gen(function* () {
								const writer = store.writer(lock)
								// Creating the row and binding its id is one uninterruptible step;
								// an interruption in between would leave a row nobody closes.
								const runId = yield* writer.startRun(id, trigger).pipe(
									Effect.tap((created) =>
										Effect.sync(() => {
											openRun = created
										}),
									),
									Effect.uninterruptible,
								)
								const capturedAt = new Date()
								const raw = yield* source.fetch
								// Stored before decoding, so a changed upstream shape can be inspected and replayed.
								yield* writer.saveRawPayload(runId, id, raw)
								const payload = yield* decodePayload(source, raw)
								const rows = yield* Effect.try({
									try: () => source.normalize(payload),
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
								const result = yield* writer.persist({
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
							}),
						)
						.pipe(
							// failRun only touches a run that is still `running`, so a run whose
							// persist committed keeps its success even if the fiber was interrupted.
							Effect.onError((cause) =>
								openRun === undefined ? Effect.void : store.failRun(openRun, describe(cause)).pipe(Effect.ignore),
							),
						)
					// In-process runs of one source wait for each other; other processes get SourceBusy.
					return yield* Semaphore.withPermits(lock, 1)(run)
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
	if (Schema.is(SourceBusy)(error)) return error.message
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
				// Another process (e.g. `bun run collect`) is collecting it right now;
				// its run row decides when this source is due next.
				Effect.catchTag("SourceBusy", (busy) =>
					Effect.logInfo(`Skipped ${id}: ${busy.message}`).pipe(Effect.andThen(Effect.sleep("1 minute"))),
				),
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
