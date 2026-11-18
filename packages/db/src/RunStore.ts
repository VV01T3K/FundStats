import type { Metrics } from "@fundstats/shared/metrics"
import { and, eq, lt, sql } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { Database, type DatabaseError, type Db } from "./Database.ts"
import { collectionRuns, instruments, newestSnapshotFirst, rawPayloads, snapshots, sourceSchedules } from "./schema.ts"
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

const encodePayload = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))

/** Rows one downsampling statement deletes at most, so each finishes well inside DB_STATEMENT_TIMEOUT. */
const DOWNSAMPLE_BATCH = 10_000

/** The writes of one collection run. */
export interface RunWriter {
	/**
	 * Reserves the id of a new run. The caller binds it before `startRun`
	 * inserts the row, so the run can be closed even if the insert's reply is lost.
	 */
	readonly reserveRunId: E<number>
	readonly startRun: (runId: number, source: string, trigger: string) => E<void>
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
		 * Marks a run failed if it is still running. A run that committed (success) or was already closed
		 * keeps its status, so recording a late failure never hides committed data. Uses the pool, so it
		 * works after the run's lock session is lost.
		 */
		readonly failRun: (runId: number, error: string) => E<void>
		/**
		 * Stores the upstream response a failed run rejected, as JSON text, through the pool. Fails with a
		 * SchemaError for a value that has no JSON text (e.g. nested past the encoder's depth).
		 */
		readonly archiveRejectedPayload: (
			runId: number,
			payload: unknown,
		) => Effect.Effect<void, DatabaseError | Schema.SchemaError>
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
					.set({ status: "failed", finishedAt: sql`clock_timestamp()`, error: storableText(error).slice(0, 4000) })
					.where(and(eq(collectionRuns.id, runId), eq(collectionRuns.status, "running")))
					.pipe(Effect.asVoid)

			const archiveRejectedPayload = Effect.fn("RunStore.archiveRejectedPayload")(function* (
				runId: number,
				payload: unknown,
			) {
				const json = yield* encodePayload(payload)
				yield* database.insert(rawPayloads).values({ runId, payload: json })
			})

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
											order by ${newestSnapshotFirst}
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

			// An old live quote goes when a newer one of its instrument and UTC day exists, so each instrument's
			// newest per day stays. Each statement takes the next chunk of an instrument's old live quotes in
			// index order, below the previous chunk, and commits on its own: a backlog shrinks by whole chunks.
			const downsampleChunk = (instrumentId: number, below: { readonly at: string; readonly id: string }) =>
				database.execute<{ deleted: number; scanned: number; last_at: string; last_id: string }>(sql`
					with chunk as materialized (
						select id, captured_at from ${snapshots}
						where instrument_id = ${instrumentId} and as_of is null
						  and captured_at <= ${below.at}::timestamptz
						  and (captured_at, id) < (${below.at}::timestamptz, ${below.id}::bigint)
						order by ${newestSnapshotFirst}
						limit ${DOWNSAMPLE_BATCH}
					), gone as (
						delete from ${snapshots} where id = any(array(
							select c.id from chunk c
							where exists (
								select 1 from ${snapshots} n
								where n.instrument_id = ${instrumentId} and n.as_of is null
								  and n.captured_at >= c.captured_at
								  and n.captured_at < date_trunc('day', c.captured_at, 'UTC') + interval '24 hours'
								  and (n.captured_at, n.id) > (c.captured_at, c.id)
							)
						))
						returning 1
					)
					select (select count(*)::int from gone) as deleted, (select count(*)::int from chunk) as scanned,
					       oldest.captured_at::text as last_at, oldest.id::text as last_id
					from (select captured_at, id from chunk order by captured_at, id limit 1) oldest
				`)

			const downsampleLiveSnapshots = Effect.fn("RunStore.downsampleLiveSnapshots")(function* (detailDays: number) {
				const cutoff = yield* database.execute<{ at: string }>(
					sql`select (now() - make_interval(days => ${detailDays}))::text as at`,
				)
				const instrumentIds = yield* database.select({ id: instruments.id }).from(instruments)
				let deleted = 0
				for (const { id } of instrumentIds) {
					// Ids are positive, so (cutoff, 0) bounds the first chunk to captured_at < cutoff.
					let below = { at: cutoff.rows[0]!.at, id: "0" }
					let more = true
					while (more) {
						// No row back: the chunk was empty, nothing older is left.
						const [chunk] = (yield* downsampleChunk(id, below)).rows
						if (chunk === undefined) break
						deleted += chunk.deleted
						more = chunk.scanned === DOWNSAMPLE_BATCH
						below = { at: chunk.last_at, id: chunk.last_id }
					}
				}
				return deleted
			})

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
				archiveRejectedPayload,
				closeInterruptedRuns,
				pruneRawPayloads,
				downsampleLiveSnapshots,
				publishSchedules,
			})
		}),
	)
}

/**
 * A run's error can quote upstream data, and Postgres text cannot hold the NUL character
 * (https://www.postgresql.org/docs/current/datatype-character.html), so NUL is written as its JSON escape.
 */
const storableText = (text: string) => text.replaceAll("\u0000", "\\u0000")
