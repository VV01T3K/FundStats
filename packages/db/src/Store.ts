import type { CollectionRun, SnapshotRow } from "@fundstats/shared/api"
import type { Metrics } from "@fundstats/shared/metrics"
import { and, eq, sql } from "drizzle-orm"
import * as Context from "effect/Context"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { Database, type QueryError } from "./Database.ts"
import { collectionRuns, instruments, newestSnapshotFirst, snapshots, sourceSchedules } from "./schema.ts"

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

export interface SparklineResult {
	readonly externalId: string
	readonly values: ReadonlyArray<number>
}

/** How the collector last said it schedules a source. */
export interface SourceSchedule {
	readonly source: string
	readonly intervalSeconds: number
	readonly enabled: boolean
}

type E<A> = Effect.Effect<A, QueryError>

/** In collection_runs_source_started_idx order: a bare DESC means NULLS FIRST and would sort instead. */
const newestRunFirst = sql`${collectionRuns.startedAt} desc nulls last`

/** Reads of collected data: everything the API serves. It never writes; RunStore does. */
export class Store extends Context.Service<
	Store,
	{
		readonly runSummary: (source: string) => E<RunSummary>
		readonly latest: (source: string) => E<ReadonlyArray<SnapshotRow>>
		readonly history: (source: string, externalId: string, limit: number) => E<HistoryResult | null>
		/** The last `points` values of every instrument `latest` lists, oldest first. */
		readonly sparklines: (source: string, points: number) => E<ReadonlyArray<SparklineResult>>
		readonly schedules: E<ReadonlyArray<SourceSchedule>>
	}
>()("@fundstats/db/Store") {
	static readonly layer = Layer.effect(
		Store,
		Effect.gen(function* () {
			const database = yield* Database

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

			const runSummary = Effect.fn("Store.runSummary")(function* (source: string) {
				const [lastRun] = yield* database
					.select()
					.from(collectionRuns)
					.where(eq(collectionRuns.source, source))
					.orderBy(newestRunFirst)
					.limit(1)
				const [lastSuccess] = yield* database
					.select()
					.from(collectionRuns)
					.where(and(eq(collectionRuns.source, source), eq(collectionRuns.status, "success")))
					.orderBy(newestRunFirst)
					.limit(1)
				return {
					lastRun: lastRun ? toRun(lastRun) : null,
					lastSuccess: lastSuccess ? toRun(lastSuccess) : null,
				}
			})

			const latest = Effect.fn("Store.latest")(function* (source: string) {
				// Instruments reported by the last successful run, each with its newest snapshot.
				const result = yield* database.execute<{
					id: number
					external_id: string
					name: string
					symbol: string | null
					category: string | null
					currency: string | null
					metadata: Record<string, unknown>
					captured_at: string | Date
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
								 order by ${newestSnapshotFirst}
								 limit 1)
							) candidates
							order by priority
							limit 1
						) s on true
						where i.source = ${source}
						  -- A source's runs never overlap (its source lock), so its newest successful run is the last persist.
						  and i.last_seen_run_id = (
							select id from ${collectionRuns}
							where source = ${source} and status = 'success'
							order by id desc
							limit 1
						  )
						order by (s.metrics->>'rank')::numeric asc nulls last, i.name asc
					`)
				return result.rows.map((r): SnapshotRow => ({
					instrumentId: r.id,
					externalId: r.external_id,
					name: r.name,
					symbol: r.symbol,
					category: r.category,
					currency: r.currency,
					metadata: r.metadata,
					capturedAt: DateTime.formatIso(DateTime.makeUnsafe(r.captured_at)),
					asOf: r.as_of,
					value: r.value === null ? null : Number(r.value),
					metrics: r.metrics,
				}))
			})

			const history = Effect.fn("Store.history")(function* (source: string, externalId: string, limit: number) {
				const [instrument] = yield* database
					.select({ id: instruments.id, name: instruments.name })
					.from(instruments)
					.where(and(eq(instruments.source, source), eq(instruments.externalId, externalId)))
					.limit(1)
				if (!instrument) return null
				const points = yield* database
					.select({
						capturedAt: snapshots.capturedAt,
						asOf: snapshots.asOf,
						value: snapshots.value,
						metrics: snapshots.metrics,
					})
					.from(snapshots)
					.where(eq(snapshots.instrumentId, instrument.id))
					// Funds by valuation date (an older date can be rewritten later), live quotes by capture time.
					.orderBy(sql`${snapshots.asOf} desc nulls last, ${newestSnapshotFirst}`)
					.limit(limit)
				return {
					name: instrument.name,
					points: points.map((p) => ({ ...p, capturedAt: p.capturedAt.toISOString() })),
				}
			})

			const sparklines = Effect.fn("Store.sparklines")(function* (source: string, points: number) {
				const result = yield* database.execute<{ external_id: string; values: ReadonlyArray<number> }>(sql`
					select i.external_id, array(
						select value from (
							-- The newest points in history order, then turned oldest first.
							select value::float8 as value, as_of, captured_at, id
							from ${snapshots}
							where instrument_id = i.id and value is not null
							order by as_of desc nulls last, ${newestSnapshotFirst}
							limit ${points}
						) recent
						order by as_of asc nulls first, captured_at asc, id asc
					) as values
					from ${instruments} i
					where i.source = ${source}
					  and i.last_seen_run_id = (
						select id from ${collectionRuns}
						where source = ${source} and status = 'success'
						order by id desc
						limit 1
					  )
					order by i.id
				`)
				return result.rows.map((r): SparklineResult => ({ externalId: r.external_id, values: r.values }))
			})

			const schedules = database
				.select({
					source: sourceSchedules.source,
					intervalSeconds: sourceSchedules.intervalSeconds,
					enabled: sourceSchedules.enabled,
				})
				.from(sourceSchedules)

			return Store.of({ runSummary, latest, history, sparklines, schedules })
		}),
	)
}
