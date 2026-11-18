import type { Metrics } from "@fundstats/shared/metrics"
import { and, eq, lt, sql } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { Database, type DatabaseError, type Db } from "./Database.ts"
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
	readonly saveRawPayload: (runId: number, payload: unknown) => E<void>
	/**
	 * Writes instruments and snapshots and marks the run successful, in one transaction. The only status
	 * change not from `running`: committed rows are shown, so their run must read as successful.
	 */
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
		readonly writer: (lock: Db) => RunWriter
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
		/**
		 * Thins live quotes (no as_of) captured more than `detailDays` ago to the newest one per instrument
		 * and UTC day. Dated rows are never touched, and an instrument's newest snapshot is always kept.
		 */
		readonly downsampleLiveSnapshots: (detailDays: number) => E<number>
		/** Records how the collector schedules each source, for the web app to report. */
		readonly publishSchedules: (schedules: ReadonlyArray<SourceSchedule>) => E<void>
	}
>()("@fundstats/db/RunStore") {
	static readonly layer = Layer.effect(
		RunStore,
		Effect.gen(function* () {
			const database = yield* Database
			const locks = yield* SourceLocks

			const writer = (lock: Db): RunWriter => ({
				reserveRunId: reserveRunId(lock),
				startRun: (runId, source, trigger) => startRun(lock, runId, source, trigger),
				saveRawPayload: (runId, payload) => saveRawPayload(lock, runId, payload),
				persist: (input) => persist(lock, input),
			})

			const reserveRunId = (db: Db) =>
				db
					.execute<{ id: number }>(sql`select nextval(pg_get_serial_sequence('collection_runs', 'id'))::int as id`)
					.pipe(Effect.map((result) => result.rows[0]!.id))

			const startRun = (db: Db, runId: number, source: string, trigger: string) =>
				db.insert(collectionRuns).values({ id: runId, source, trigger, status: "running" }).pipe(Effect.asVoid)

			const failRun = (runId: number, error: string) =>
				database
					.update(collectionRuns)
					.set({ status: "failed", finishedAt: sql`clock_timestamp()`, error: error.slice(0, 4000) })
					.where(and(eq(collectionRuns.id, runId), eq(collectionRuns.status, "running")))
					.pipe(Effect.asVoid)

			const saveRawPayload = (db: Db, runId: number, payload: unknown) =>
				db.insert(rawPayloads).values({ runId, payload }).pipe(Effect.asVoid)

			const persist = (db: Db, input: PersistInput) =>
				db.transaction((tx) =>
					Effect.gen(function* () {
						const { rows } = input
						let rowsWritten = 0
						if (rows.length > 0) {
							const ids = yield* tx
								.insert(instruments)
								.values(
									rows.map((row) => ({
										source: input.source,
										externalId: row.externalId,
										name: row.name,
										symbol: row.symbol,
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
										lastSeenRunId: sql`excluded.last_seen_run_id`,
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
								const written = yield* tx
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
								// A live quote equal to the instrument's newest snapshot is one the source has not updated; skip it.
								const incoming = sql.join(
									live.map(
										(v) =>
											sql`(${v.instrumentId}::int, ${sql.param(v.value, snapshots.value)}::numeric, ${sql.param(v.metrics, snapshots.metrics)}::jsonb)`,
									),
									sql`, `,
								)
								const written =
									yield* tx.execute(sql`insert into ${snapshots} (instrument_id, run_id, captured_at, value, metrics)
									select r.instrument_id, ${input.runId}, ${sql.param(input.capturedAt, snapshots.capturedAt)}, r.value, r.metrics
									from (values ${incoming}) as r(instrument_id, value, metrics)
									where not exists (
										select 1 from (
											select value, metrics from ${snapshots}
											where instrument_id = r.instrument_id
											order by captured_at desc
											limit 1
										) newest
										where newest.value is not distinct from r.value and newest.metrics = r.metrics
									)
									returning id
								`)
								rowsWritten += written.rows.length
							}
						}
						yield* tx
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
					}),
				)

			const closeAbandonedRuns = (lock: Db, source: string) =>
				lock
					.update(collectionRuns)
					.set({
						status: "failed",
						finishedAt: sql`clock_timestamp()`,
						error: "Interrupted: the process collecting it stopped or lost its database connection",
					})
					.where(and(eq(collectionRuns.source, source), eq(collectionRuns.status, "running")))
					.returning({ id: collectionRuns.id })
					.pipe(Effect.map((rows) => rows.length))

			const closeInterruptedRuns = database
				.selectDistinct({ source: collectionRuns.source })
				.from(collectionRuns)
				.where(eq(collectionRuns.status, "running"))
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
				database
					.delete(rawPayloads)
					.where(lt(rawPayloads.fetchedAt, sql`now() - make_interval(days => ${olderThanDays})`))
					.returning({ id: rawPayloads.id })
					.pipe(Effect.map((rows) => rows.length))

			const downsampleLiveSnapshots = (detailDays: number) =>
				database
					.execute<{ id: number }>(sql`
						delete from ${snapshots} s
						using (
							select id, row_number() over (
								partition by instrument_id, (captured_at at time zone 'UTC')::date
								order by captured_at desc, id desc
							) as rank
							from ${snapshots}
							where as_of is null and captured_at < now() - make_interval(days => ${detailDays})
						) old
						where s.id = old.id and old.rank > 1
						returning s.id
					`)
					.pipe(Effect.map((result) => result.rows.length))

			const publishSchedules = (schedules: ReadonlyArray<SourceSchedule>) =>
				schedules.length === 0
					? Effect.void
					: database
							.insert(sourceSchedules)
							.values([...schedules])
							.onConflictDoUpdate({
								target: sourceSchedules.source,
								set: {
									intervalSeconds: sql`excluded.interval_seconds`,
									enabled: sql`excluded.enabled`,
								},
							})
							.pipe(Effect.asVoid)

			return RunStore.of({
				writer,
				failRun,
				closeInterruptedRuns,
				pruneRawPayloads,
				downsampleLiveSnapshots,
				publishSchedules,
			})
		}),
	)
}
