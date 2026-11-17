import type { Metrics } from "@fundstats/shared/metrics"
import type { InstrumentKind } from "@fundstats/shared/sources"
import { and, eq, lt, sql } from "drizzle-orm"
import * as Context from "effect/Context"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { Database, type DatabaseError, type Executor } from "./Database.ts"
import { collectionRuns, instruments, rawPayloads, snapshots, sourceSchedules } from "./schema.ts"
import { SourceLocks } from "./SourceLocks.ts"
import type { SourceSchedule } from "./Store.ts"

/** The common storage shape every source normalizes into. */
export interface NormalizedRow {
	readonly externalId: string
	readonly name: string
	readonly symbol: string | null
	readonly category: string | null
	readonly currency: string | null
	readonly metadata: Record<string, unknown>
	/** Date (YYYY-MM-DD) the upstream says the values are for; null for live quotes. */
	readonly asOf: string | null
	readonly value: number | null
	readonly metrics: Metrics
}

interface PersistInput {
	readonly source: string
	readonly kind: InstrumentKind
	readonly runId: number
	readonly capturedAt: Date
	readonly rows: ReadonlyArray<NormalizedRow>
}

export interface PersistResult {
	readonly instrumentCount: number
	readonly rowsWritten: number
}

type E<A> = Effect.Effect<A, DatabaseError>

/** The writes of one collection run. */
export interface RunWriter {
	/**
	 * Reserves the id of a new run. The caller binds it before `startRun`
	 * inserts the row, so the run can be closed even if the insert's reply is lost.
	 */
	readonly reserveRunId: E<number>
	readonly startRun: (runId: number, source: string, trigger: string) => E<void>
	readonly saveRawPayload: (runId: number, source: string, payload: unknown) => E<void>
	/** Writes instruments and snapshots and marks the run successful, in one transaction. */
	readonly persist: (input: PersistInput) => E<PersistResult>
}

/** Every write of collected data. Only the collector builds it; the web app reads through Store. */
export class RunStore extends Context.Service<
	RunStore,
	{
		/**
		 * The writes of a collection run, through `lock`: the connection holding
		 * the source's collection lock (SourceLocks.withSourceLock), so they fail
		 * once the lock is lost.
		 */
		readonly writer: (lock: Executor) => RunWriter
		/**
		 * Marks a run failed if it is still running. A run that committed
		 * (success) or was already closed keeps its status, so recording a late
		 * failure never hides committed data.
		 */
		readonly failRun: (runId: number, error: string) => E<void>
		/**
		 * Closes runs left `running` by a crash or restart. A run counts as
		 * abandoned only when its source's collection lock is free; a run that
		 * another live process is still doing keeps its lock and is left alone.
		 */
		readonly closeInterruptedRuns: E<number>
		readonly pruneRawPayloads: (olderThanDays: number) => E<number>
		/** Records how the collector schedules each source, for the web app to report. */
		readonly publishSchedules: (schedules: ReadonlyArray<SourceSchedule>) => E<void>
	}
>()("@fundstats/db/RunStore") {
	static readonly layer = Layer.effect(
		RunStore,
		Effect.gen(function* () {
			const database = yield* Database
			const locks = yield* SourceLocks

			const writer = (exec: Executor): RunWriter => ({
				reserveRunId: reserveRunId(exec),
				startRun: (runId, source, trigger) => startRun(exec, runId, source, trigger),
				saveRawPayload: (runId, source, payload) => saveRawPayload(exec, runId, source, payload),
				persist: (input) => persist(exec, input),
			})

			const reserveRunId = (exec: Executor) =>
				exec
					.use("reserveRunId", (db) =>
						db.execute<{ id: number }>(sql`select nextval(pg_get_serial_sequence('collection_runs', 'id'))::int as id`),
					)
					.pipe(Effect.map((result) => result.rows[0]!.id))

			const startRun = (exec: Executor, runId: number, source: string, trigger: string) =>
				exec
					.use("startRun", (db) => db.insert(collectionRuns).values({ id: runId, source, trigger, status: "running" }))
					.pipe(Effect.asVoid)

			const failRun = (runId: number, error: string) =>
				DateTime.nowAsDate.pipe(
					Effect.flatMap((finishedAt) =>
						database.use("failRun", (db) =>
							db
								.update(collectionRuns)
								.set({ status: "failed", finishedAt, error: error.slice(0, 4000) })
								.where(and(eq(collectionRuns.id, runId), eq(collectionRuns.status, "running"))),
						),
					),
					Effect.asVoid,
				)

			const saveRawPayload = (exec: Executor, runId: number, source: string, payload: unknown) =>
				exec
					.use("saveRawPayload", (db) => db.insert(rawPayloads).values({ runId, source, payload }))
					.pipe(Effect.asVoid)

			const persist = (exec: Executor, input: PersistInput) =>
				exec.transaction("persist", async (tx) => {
					// One row per external id; a duplicate in one upsert batch is a Postgres error.
					const rows = [...new Map(input.rows.map((row) => [row.externalId, row])).values()]
					let rowsWritten = 0
					if (rows.length > 0) {
						const ids = await tx
							.insert(instruments)
							.values(
								rows.map((row) => ({
									source: input.source,
									externalId: row.externalId,
									name: row.name,
									symbol: row.symbol,
									kind: input.kind,
									category: row.category,
									currency: row.currency,
									metadata: row.metadata,
									lastSeenRunId: input.runId,
								})),
							)
							.onConflictDoUpdate({
								target: [instruments.source, instruments.externalId],
								set: {
									name: sql`excluded.name`,
									symbol: sql`excluded.symbol`,
									category: sql`excluded.category`,
									currency: sql`excluded.currency`,
									metadata: sql`excluded.metadata`,
									// Run ids grow in start order, so an older run that finishes late
									// never moves an instrument back to its own (older) state.
									lastSeenRunId: sql`greatest(${instruments.lastSeenRunId}, excluded.last_seen_run_id)`,
									updatedAt: sql`now()`,
								},
							})
							.returning({ id: instruments.id, externalId: instruments.externalId })
						const idOf = new Map(ids.map((r) => [r.externalId, r.id]))
						const values = rows.map((row) => ({
							instrumentId: idOf.get(row.externalId) as number,
							runId: input.runId,
							capturedAt: input.capturedAt,
							asOf: row.asOf,
							value: row.value,
							metrics: row.metrics,
						}))
						const dated = values.filter((v) => v.asOf !== null)
						const live = values.filter((v) => v.asOf === null)
						if (dated.length > 0) {
							// Dedupe rule: one row per instrument and as_of date, rewritten only when a value changed.
							const written = await tx
								.insert(snapshots)
								.values(dated)
								.onConflictDoUpdate({
									target: [snapshots.instrumentId, snapshots.asOf],
									targetWhere: sql`${snapshots.asOf} is not null`,
									set: {
										value: sql`excluded.value`,
										metrics: sql`excluded.metrics`,
										capturedAt: sql`excluded.captured_at`,
										runId: sql`excluded.run_id`,
									},
									setWhere: sql`${snapshots.value} is distinct from excluded.value or ${snapshots.metrics} is distinct from excluded.metrics`,
								})
								.returning({ id: snapshots.id })
							rowsWritten += written.length
						}
						if (live.length > 0) {
							const written = await tx.insert(snapshots).values(live).returning({ id: snapshots.id })
							rowsWritten += written.length
						}
					}
					await tx
						.update(collectionRuns)
						.set({
							status: "success",
							// When this write ran, after the snapshot writes, not when the app started persisting.
							finishedAt: sql`clock_timestamp()`,
							instrumentCount: rows.length,
							rowsWritten,
							error: null,
						})
						.where(eq(collectionRuns.id, input.runId))
					return { instrumentCount: rows.length, rowsWritten }
				})

			const closeAbandonedRuns = (lock: Executor, source: string) =>
				DateTime.nowAsDate.pipe(
					Effect.flatMap((finishedAt) =>
						lock.use("closeInterruptedRuns", (db) =>
							db
								.update(collectionRuns)
								.set({
									status: "failed",
									finishedAt,
									error: "Interrupted: the process collecting it stopped or lost its database connection",
								})
								.where(and(eq(collectionRuns.source, source), eq(collectionRuns.status, "running")))
								.returning({ id: collectionRuns.id }),
						),
					),
					Effect.map((rows) => rows.length),
				)

			const closeInterruptedRuns = database
				.use("runningSources", (db) =>
					db
						.selectDistinct({ source: collectionRuns.source })
						.from(collectionRuns)
						.where(eq(collectionRuns.status, "running")),
				)
				.pipe(
					Effect.flatMap((rows) =>
						Effect.forEach(rows, ({ source }) =>
							locks
								.withSourceLock(source, (lock) => closeAbandonedRuns(lock, source))
								.pipe(
									// Held by a live collection elsewhere: that run is not abandoned.
									Effect.catchTags({ SourceBusy: () => Effect.succeed(0) }),
								),
						),
					),
					Effect.map((counts) => counts.reduce((a, b) => a + b, 0)),
				)

			const pruneRawPayloads = (olderThanDays: number) =>
				DateTime.now.pipe(
					Effect.map((now) => DateTime.toDateUtc(DateTime.subtractDuration(now, Duration.days(olderThanDays)))),
					Effect.flatMap((cutoff) =>
						database.use("pruneRawPayloads", (db) =>
							db.delete(rawPayloads).where(lt(rawPayloads.fetchedAt, cutoff)).returning({ id: rawPayloads.id }),
						),
					),
					Effect.map((rows) => rows.length),
				)

			const publishSchedules = (schedules: ReadonlyArray<SourceSchedule>) =>
				schedules.length === 0
					? Effect.void
					: database
							.use("publishSchedules", (db) =>
								db
									.insert(sourceSchedules)
									.values([...schedules])
									.onConflictDoUpdate({
										target: sourceSchedules.source,
										set: {
											intervalSeconds: sql`excluded.interval_seconds`,
											enabled: sql`excluded.enabled`,
											updatedAt: sql`now()`,
										},
									}),
							)
							.pipe(Effect.asVoid)

			return RunStore.of({ writer, failRun, closeInterruptedRuns, pruneRawPayloads, publishSchedules })
		}),
	)
}
