import type { Metrics } from "@fundstats/shared/metrics"
import { sql } from "drizzle-orm"
import {
	bigserial,
	boolean,
	date,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	serial,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core"

/**
 * One row per collector run of one source. `status` is running → success |
 * failed. Rows left in `running` by a crash are closed as failed at boot.
 */
export const collectionRuns = pgTable(
	"collection_runs",
	{
		id: serial("id").primaryKey(),
		source: text("source").notNull(),
		trigger: text("trigger").notNull(),
		status: text("status", { enum: ["running", "success", "failed"] }).notNull(),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
		finishedAt: timestamp("finished_at", { withTimezone: true }),
		instrumentCount: integer("instrument_count").notNull().default(0),
		rowsWritten: integer("rows_written").notNull().default(0),
		error: text("error"),
	},
	(t) => [index("collection_runs_source_started_idx").on(t.source, t.startedAt.desc())],
)

/**
 * The upstream response of a run that rejected it (decode, normalize or validation failure), kept to
 * inspect and replay after a fix. Successful runs store none. Pruned after RAW_PAYLOAD_RETENTION_DAYS.
 */
export const rawPayloads = pgTable(
	"raw_payloads",
	{
		id: serial("id").primaryKey(),
		runId: integer("run_id")
			.notNull()
			.references(() => collectionRuns.id, { onDelete: "cascade" }),
		fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
		payload: jsonb("payload").notNull(),
	},
	(t) => [uniqueIndex("raw_payloads_run_idx").on(t.runId), index("raw_payloads_fetched_idx").on(t.fetchedAt)],
)

/** A fund or coin as one source identifies it. */
export const instruments = pgTable(
	"instruments",
	{
		id: serial("id").primaryKey(),
		source: text("source").notNull(),
		externalId: text("external_id").notNull(),
		name: text("name").notNull(),
		symbol: text("symbol"),
		category: text("category"),
		currency: text("currency"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
		/** The last successful run that reported this instrument; "latest" views list only these. */
		lastSeenRunId: integer("last_seen_run_id").references(() => collectionRuns.id, {
			onDelete: "set null",
		}),
	},
	(t) => [
		uniqueIndex("instruments_source_external_idx").on(t.source, t.externalId),
		index("instruments_source_last_seen_idx").on(t.source, t.lastSeenRunId),
	],
)

/**
 * Values of one instrument at one point in time. Dedupe rule: dated values (`as_of`, e.g. mBank's
 * valuation date) keep one row per instrument and date, rewritten only when a value changed;
 * live quotes without a date (crypto) get a row per collection that changed the quote, thinned to one
 * per UTC day after LIVE_SNAPSHOT_DETAIL_DAYS.
 */
export const snapshots = pgTable(
	"snapshots",
	{
		id: bigserial("id", { mode: "number" }).primaryKey(),
		instrumentId: integer("instrument_id")
			.notNull()
			.references(() => instruments.id, { onDelete: "cascade" }),
		runId: integer("run_id").references(() => collectionRuns.id, { onDelete: "set null" }),
		capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
		asOf: date("as_of", { mode: "string" }),
		value: numeric("value", { mode: "number" }),
		metrics: jsonb("metrics").$type<Metrics>().notNull().default({}),
	},
	(t) => [
		// Latest snapshot per instrument and per-instrument history.
		index("snapshots_instrument_captured_idx").on(t.instrumentId, t.capturedAt.desc()),
		uniqueIndex("snapshots_instrument_as_of_idx")
			.on(t.instrumentId, t.asOf)
			.where(sql`${t.asOf} is not null`),
	],
)

/**
 * Newest snapshot first, in snapshots_instrument_captured_idx order (Postgres sorts DESC as NULLS FIRST unless
 * told otherwise, and then cannot read the index in order). `id` breaks ties between equal capture times.
 */
export const newestSnapshotFirst = sql`captured_at desc nulls last, id desc`

/**
 * How the collector schedules each source, written by the collector when it starts so the web app can
 * report intervals and staleness without sharing its config.
 */
export const sourceSchedules = pgTable("source_schedules", {
	source: text("source").primaryKey(),
	intervalSeconds: integer("interval_seconds").notNull(),
	enabled: boolean("enabled").notNull(),
})
