import type { DatabaseError } from "@fundstats/db/Database"
import { type PersistResult, RunStore } from "@fundstats/db/RunStore"
import { SourceBusy, SourceLocks } from "@fundstats/db/SourceLocks"
import { SOURCES, type SourceId } from "@fundstats/shared/sources"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

import { CollectorConfig } from "./config.ts"
import { registry } from "./sources/registry.ts"
import { type AnySource, SourceError } from "./sources/Source.ts"

export class UnknownSource extends Schema.TaggedError<UnknownSource>()("UnknownSource", {
	source: Schema.String,
}) {}

export type RunTrigger = "schedule" | "cli" | "test"

/** Slack between the end of the fetch phase and the next statement on the lock session. */
const LOCK_IDLE_SLACK = Duration.minutes(1)

/**
 * Runs sources: fetch → keep raw payload → decode → normalize → persist, recording every run.
 * A run holds its source's database lock for its whole lifetime, so two runs of one source (in this
 * process or another) never overlap; a run that finds the lock taken fails with SourceBusy and records nothing.
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
>()("@fundstats/collector/Collector") {
	static readonly layerNoDeps = Layer.effect(
		Collector,
		Effect.gen(function* () {
			const config = yield* CollectorConfig
			const store = yield* RunStore
			const sourceLocks = yield* SourceLocks
			const httpClient = yield* HttpClient.HttpClient

			// The lock session sits idle while the run fetches; Postgres must not end it (idle_session_timeout).
			const lockOptions = { idleSessionTimeout: Duration.sum(config.fetchTimeout, LOCK_IDLE_SLACK) }

			const interval = (id: SourceId) =>
				Option.getOrElse(config.intervalOverride(id), () => Duration.fromInputUnsafe(SOURCES[id].defaultInterval))

			const runOnce = Effect.fn("Collector.runOnce")(
				function* (sourceId: string, trigger: RunTrigger) {
					if (!Object.hasOwn(registry, sourceId)) {
						return yield* new UnknownSource({ source: sourceId })
					}
					const id = sourceId as SourceId
					const source: AnySource = registry[id]
					// The run row to close if the run fails. Failure is recorded outside
					// the lock, so it is also recorded when the lock connection is lost.
					let openRun: number | undefined
					return yield* sourceLocks
						.withSourceLock(
							id,
							(lock) =>
								Effect.gen(function* () {
									const writer = store.writer(lock)
									// The id is bound before the row is inserted, so a failure can close
									// the row however the insert ends (even with its reply lost).
									const runId = yield* writer.reserveRunId
									openRun = runId
									yield* writer.startRun(runId, id, trigger)
									const capturedAt = yield* DateTime.nowAsDate
									const raw = yield* source.fetch.pipe(
										Effect.timeoutOrElse({
											duration: config.fetchTimeout,
											orElse: () =>
												Effect.fail(
													new SourceError({
														source: id,
														reason: "timeout",
														message: `Fetch did not finish within FETCH_TIMEOUT (${Duration.format(config.fetchTimeout)})`,
													}),
												),
										}),
									)
									// Stored before decoding, so a changed upstream shape can be inspected and replayed.
									yield* writer.saveRawPayload(runId, raw)
									const payload = yield* source.decode(raw)
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
									const duplicate = firstDuplicateId(rows)
									if (duplicate !== undefined) {
										return yield* new SourceError({
											source: id,
											reason: "upstream",
											message: `Upstream listed instrument ${duplicate} more than once`,
										})
									}
									const result = yield* writer.persist({ source: id, runId, capturedAt, rows })
									yield* Effect.logInfo(
										`Collected ${id}: ${result.instrumentCount} instruments, ${result.rowsWritten} rows written`,
									)
									return result
								}),
							lockOptions,
						)
						.pipe(
							// failRun only touches a run that is still `running`, so a run whose
							// persist committed keeps its success even if the fiber was interrupted.
							Effect.onError((cause) =>
								openRun === undefined
									? Effect.void
									: store.failRun(openRun, describe(cause)).pipe(
											// The run's own error is what the caller gets; this one is only logged.
											Effect.catchCause((recording) =>
												Effect.logError(`Could not record run ${openRun} as failed: ${describe(recording)}`),
											),
										),
							),
						)
				},
				Effect.provideService(HttpClient.HttpClient, httpClient),
				Effect.provideService(CollectorConfig, config),
			)

			return Collector.of({ interval, runOnce })
		}),
	)

	static readonly layer = Collector.layerNoDeps.pipe(Layer.provide(FetchHttpClient.layer))
}

/** The first external id `rows` lists twice; one run stores each instrument once. */
const firstDuplicateId = (rows: ReadonlyArray<{ readonly externalId: string }>) => {
	const seen = new Set<string>()
	for (const { externalId } of rows) {
		if (seen.has(externalId)) return externalId
		seen.add(externalId)
	}
	return undefined
}

const isSourceError = Schema.is(SourceError)
const isSourceBusy = Schema.is(SourceBusy)

export const describe = (cause: Cause.Cause<unknown>): string => {
	const error = Cause.squash(cause)
	if (Cause.hasInterruptsOnly(cause)) return "Interrupted"
	if (isSourceError(error)) return `${error.reason}: ${error.message}`
	if (isSourceBusy(error)) return error.message
	if (error instanceof Error) return error.message
	return Cause.pretty(cause)
}
