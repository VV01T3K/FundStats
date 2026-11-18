import { RunStore } from "@fundstats/db/RunStore"
import { Store } from "@fundstats/db/Store"
import { SOURCE_IDS } from "@fundstats/shared/sources"
import * as Clock from "effect/Clock"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { Collector, describe } from "./Collector.ts"
import { CollectorConfig } from "./config.ts"

/** After a failed run, retry sooner than the normal interval, but not more often than this. */
const FAILURE_RETRY = Duration.minutes(10)

/**
 * Background fibers that run every source on its interval, started by `collector start` only when
 * COLLECTOR_ENABLED is true. It first records each source's schedule in the database for the web app.
 * The fibers live in the layer's scope, so disposing the runtime stops them.
 */
export const CollectorScheduler = Layer.effectDiscard(
	Effect.gen(function* () {
		const config = yield* CollectorConfig
		const store = yield* Store
		const runs = yield* RunStore
		const collector = yield* Collector
		yield* runs.publishSchedules(
			SOURCE_IDS.map((source) => ({
				source,
				intervalSeconds: Math.round(Duration.toSeconds(collector.interval(source))),
				enabled: config.collectorEnabled,
			})),
		)
		if (!config.collectorEnabled) {
			yield* Effect.logInfo("Collector disabled (COLLECTOR_ENABLED=false)")
			return
		}
		const closed = yield* runs.closeInterruptedRuns
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
					const due = DateTime.toEpochMillis(DateTime.makeUnsafe(lastRun.startedAt)) + Duration.toMillis(wait)
					const now = yield* Clock.currentTimeMillis
					delay = Duration.millis(Math.max(0, due - now))
				}
				yield* Effect.sleep(delay)
				yield* collector.runOnce(id, "schedule")
			}).pipe(
				// Another process (e.g. `bun run collect`) is collecting it right now;
				// its run row decides when this source is due next.
				Effect.catchTags({
					SourceBusy: (busy) =>
						Effect.logInfo(`Skipped ${id}: ${busy.message}`).pipe(Effect.andThen(Effect.sleep("1 minute"))),
				}),
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
				runs.pruneRawPayloads(config.rawPayloadRetentionDays).pipe(
					Effect.tap((n) => (n > 0 ? Effect.logInfo(`Pruned ${n} raw payload(s)`) : Effect.void)),
					Effect.catchCause((cause) => Effect.logWarning(`Raw payload pruning failed: ${describe(cause)}`)),
					Effect.andThen(
						runs.downsampleLiveSnapshots(config.liveSnapshotDetailDays).pipe(
							Effect.tap((n) => (n > 0 ? Effect.logInfo(`Downsampled ${n} live snapshot(s)`) : Effect.void)),
							Effect.catchCause((cause) => Effect.logWarning(`Live snapshot downsampling failed: ${describe(cause)}`)),
						),
					),
					Effect.andThen(Effect.sleep("1 day")),
				),
			),
		)
	}),
)
