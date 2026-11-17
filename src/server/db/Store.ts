import { and, desc, eq, lt, sql } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { CollectionRun, SnapshotRow } from "#/shared/api.ts"
import type { Metrics } from "#/shared/metrics.ts"
import type { InstrumentKind } from "#/shared/sources.ts"
import type { NormalizedRow } from "../sources/Source.ts"
import { Database, type DatabaseError } from "./Database.ts"
import { collectionRuns, instruments, rawPayloads, snapshots } from "./schema.ts"

export interface PersistInput {
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

export interface RunSummary {
	readonly lastRun: CollectionRun | null
	readonly lastSuccess: CollectionRun | null
}

export interface HistoryResult {
	readonly name: string
	readonly points: ReadonlyArray<{
		readonly capturedAt: string
		readonly asOf: string | null
		readonly value: number | null
		readonly metrics: Metrics
	}>
}

type E<A> = Effect.Effect<A, DatabaseError>

/**
 * All reads and writes of collected data. The collector writes through it, the
 * API reads through it; nothing else touches the tables directly.
 */
export class Store extends Context.Service<
	Store,
	{
		readonly startRun: (source: string, trigger: string) => E<number>
		readonly failRun: (runId: number, error: string) => E<void>
		readonly saveRawPayload: (runId: number, source: string, payload: unknown) => E<void>
		/** Writes instruments and snapshots and marks the run successful, in one transaction. */
		readonly persist: (input: PersistInput) => E<PersistResult>
		/**
		 * Closes runs left `running` by a crash or restart. A run counts as
		 * abandoned only when its source's collection lock is free; a run that
		 * another live process is still doing keeps its lock and is left alone.
		 */
		readonly closeInterruptedRuns: E<number>
		readonly pruneRawPayloads: (olderThanDays: number) => E<number>
		readonly runSummary: (source: string) => E<RunSummary>
		readonly latest: (source: string) => E<ReadonlyArray<SnapshotRow>>
		readonly history: (source: string, externalId: string, limit: number) => E<HistoryResult | null>
	}
>()("fundstats/server/db/Store") {
	static readonly layer = Layer.effect(
		Store,
		Effect.gen(function* () {
			const database = yield* Database

			const startRun = (source: string, trigger: string) =>
				database
					.use("startRun", (db) =>
						db
							.insert(collectionRuns)
							.values({ source, trigger, status: "running" })
							.returning({ id: collectionRuns.id }),
					)
					.pipe(Effect.map(([row]) => row.id))

			const failRun = (runId: number, error: string) =>
				database
					.use("failRun", (db) =>
						db
							.update(collectionRuns)
							.set({ status: "failed", finishedAt: new Date(), error: error.slice(0, 4000) })
							.where(eq(collectionRuns.id, runId)),
					)
					.pipe(Effect.asVoid)

			const saveRawPayload = (runId: number, source: string, payload: unknown) =>
				database
					.use("saveRawPayload", (db) => db.insert(rawPayloads).values({ runId, source, payload }))
					.pipe(Effect.asVoid)

			const persist = (input: PersistInput) =>
				database.transaction("persist", async (tx) => {
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
							finishedAt: new Date(),
							instrumentCount: rows.length,
							rowsWritten,
							error: null,
						})
						.where(eq(collectionRuns.id, input.runId))
					return { instrumentCount: rows.length, rowsWritten }
				})

			const closeAbandonedRuns = (source: string) =>
				database
					.use("closeInterruptedRuns", (db) =>
						db
							.update(collectionRuns)
							.set({ status: "failed", finishedAt: new Date(), error: "Interrupted (app stopped during the run)" })
							.where(and(eq(collectionRuns.source, source), eq(collectionRuns.status, "running")))
							.returning({ id: collectionRuns.id }),
					)
					.pipe(Effect.map((rows) => rows.length))

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
							database.withSourceLock(source, closeAbandonedRuns(source)).pipe(
								// Held by a live collection elsewhere: that run is not abandoned.
								Effect.catchTag("SourceBusy", () => Effect.succeed(0)),
							),
						),
					),
					Effect.map((counts) => counts.reduce((a, b) => a + b, 0)),
				)

			const pruneRawPayloads = (olderThanDays: number) =>
				database
					.use("pruneRawPayloads", (db) =>
						db
							.delete(rawPayloads)
							.where(lt(rawPayloads.fetchedAt, new Date(Date.now() - olderThanDays * 86_400_000)))
							.returning({ id: rawPayloads.id }),
					)
					.pipe(Effect.map((rows) => rows.length))

			const toRun = (row: typeof collectionRuns.$inferSelect): CollectionRun => ({
				id: row.id,
				status: row.status,
				trigger: row.trigger,
				startedAt: row.startedAt.toISOString(),
				finishedAt: row.finishedAt?.toISOString() ?? null,
				instrumentCount: row.instrumentCount,
				rowsWritten: row.rowsWritten,
				error: row.error,
			})

			const runSummary = (source: string) =>
				database.use("runSummary", async (db) => {
					const [lastRun] = await db
						.select()
						.from(collectionRuns)
						.where(eq(collectionRuns.source, source))
						.orderBy(desc(collectionRuns.startedAt))
						.limit(1)
					const [lastSuccess] = await db
						.select()
						.from(collectionRuns)
						.where(and(eq(collectionRuns.source, source), eq(collectionRuns.status, "success")))
						.orderBy(desc(collectionRuns.startedAt))
						.limit(1)
					return {
						lastRun: lastRun ? toRun(lastRun) : null,
						lastSuccess: lastSuccess ? toRun(lastSuccess) : null,
					}
				})

			const latest = (source: string) =>
				database.use("latest", async (db) => {
					// Instruments reported by the last successful run, each with its newest snapshot.
					const result = await db.execute<{
						id: number
						external_id: string
						name: string
						symbol: string | null
						category: string | null
						currency: string | null
						metadata: Record<string, unknown>
						captured_at: Date
						as_of: string | null
						value: string | null
						metrics: Metrics
					}>(sql`
						select i.id, i.external_id, i.name, i.symbol, i.category, i.currency, i.metadata,
						       s.captured_at, s.as_of::text as as_of, s.value, s.metrics
						from ${instruments} i
						join lateral (
							-- Dated values (funds): the newest valuation date is current, even if
							-- an older date was captured later. Live quotes (crypto, no as_of):
							-- the newest capture. Each branch is one index probe.
							select captured_at, as_of, value, metrics from (
								(select 0 as priority, captured_at, as_of, value, metrics
								 from ${snapshots}
								 where instrument_id = i.id and as_of is not null
								 order by as_of desc
								 limit 1)
								union all
								(select 1 as priority, captured_at, as_of, value, metrics
								 from ${snapshots}
								 where instrument_id = i.id
								 order by captured_at desc
								 limit 1)
							) candidates
							order by priority
							limit 1
						) s on true
						where i.source = ${source}
						  -- Run ids grow in start order and persist never moves last_seen_run_id
						  -- backwards, so the highest successful id is the run instruments point at,
						  -- whatever order overlapping runs finished in.
						  and i.last_seen_run_id = (
							select id from ${collectionRuns}
							where source = ${source} and status = 'success'
							order by id desc
							limit 1
						  )
						order by (s.metrics->>'rank')::numeric asc nulls last, i.name asc
					`)
					return result.rows.map(
						(r): SnapshotRow => ({
							instrumentId: r.id,
							externalId: r.external_id,
							name: r.name,
							symbol: r.symbol,
							category: r.category,
							currency: r.currency,
							metadata: r.metadata,
							capturedAt: new Date(r.captured_at).toISOString(),
							asOf: r.as_of,
							value: r.value === null ? null : Number(r.value),
							metrics: r.metrics,
						}),
					)
				})

			const history = (source: string, externalId: string, limit: number) =>
				database.use("history", async (db) => {
					const [instrument] = await db
						.select({ id: instruments.id, name: instruments.name })
						.from(instruments)
						.where(and(eq(instruments.source, source), eq(instruments.externalId, externalId)))
						.limit(1)
					if (!instrument) return null
					const points = await db
						.select({
							capturedAt: snapshots.capturedAt,
							asOf: snapshots.asOf,
							value: snapshots.value,
							metrics: snapshots.metrics,
						})
						.from(snapshots)
						.where(eq(snapshots.instrumentId, instrument.id))
						.orderBy(desc(snapshots.capturedAt))
						.limit(limit)
					return {
						name: instrument.name,
						points: points.map((p) => ({ ...p, capturedAt: p.capturedAt.toISOString() })),
					}
				})

			return Store.of({
				startRun,
				failRun,
				saveRawPayload,
				persist,
				closeInterruptedRuns,
				pruneRawPayloads,
				runSummary,
				latest,
				history,
			})
		}),
	)
}
