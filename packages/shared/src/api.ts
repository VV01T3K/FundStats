import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/http-api"
/**
 * The HTTP API contract. Imported by the server (handlers) and by the web
 * client (typed HttpApiClient), so it must not import server-only code.
 */
import * as Schema from "effect/Schema"

import { SOURCE_IDS } from "./sources.ts"

const SourceIdSchema = Schema.Literals(SOURCE_IDS)

const RunStatus = Schema.Literals(["running", "success", "failed"])
type RunStatus = typeof RunStatus.Type

/** ISO 8601 timestamps travel as strings so responses stay plain JSON. */
const Timestamp = Schema.String

export const CollectionRun = Schema.Struct({
	id: Schema.Int,
	status: RunStatus,
	trigger: Schema.String,
	startedAt: Timestamp,
	finishedAt: Schema.NullOr(Timestamp),
	instrumentCount: Schema.Int,
	rowsWritten: Schema.Int,
	error: Schema.NullOr(Schema.String),
})
export type CollectionRun = typeof CollectionRun.Type

export const SourceStatus = Schema.Struct({
	id: SourceIdSchema,
	name: Schema.String,
	kind: Schema.Literals(["fund", "crypto"]),
	currency: Schema.String,
	/** How often the collector runs this source, in seconds. */
	intervalSeconds: Schema.Int,
	lastRun: Schema.NullOr(CollectionRun),
	lastSuccess: Schema.NullOr(CollectionRun),
	/** True when the last run failed or the last success is overdue. */
	stale: Schema.Boolean,
})
export type SourceStatus = typeof SourceStatus.Type

const MetricValues = Schema.Record(Schema.String, Schema.Number)

export const SnapshotRow = Schema.Struct({
	instrumentId: Schema.Int,
	externalId: Schema.String,
	name: Schema.String,
	symbol: Schema.NullOr(Schema.String),
	category: Schema.NullOr(Schema.String),
	currency: Schema.NullOr(Schema.String),
	metadata: Schema.Record(Schema.String, Schema.Unknown),
	capturedAt: Timestamp,
	/** The date the upstream says the values are for (funds); null for live crypto quotes. */
	asOf: Schema.NullOr(Schema.String),
	value: Schema.NullOr(Schema.Number),
	metrics: MetricValues,
})
export type SnapshotRow = typeof SnapshotRow.Type

const LatestSnapshot = Schema.Struct({
	source: SourceStatus,
	rows: Schema.Array(SnapshotRow),
})
type LatestSnapshot = typeof LatestSnapshot.Type

const HistoryPoint = Schema.Struct({
	capturedAt: Timestamp,
	asOf: Schema.NullOr(Schema.String),
	value: Schema.NullOr(Schema.Number),
	metrics: MetricValues,
})

/** How many history points one request may ask for. */
const HistoryLimit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5000 }))

const InstrumentHistory = Schema.Struct({
	source: SourceIdSchema,
	externalId: Schema.String,
	name: Schema.String,
	points: Schema.Array(HistoryPoint),
})
type InstrumentHistory = typeof InstrumentHistory.Type

/** How many recent points per instrument one sparkline request may ask for. */
const SparklinePoints = Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 200 }))

const Sparkline = Schema.Struct({
	externalId: Schema.String,
	/** The instrument's last values, oldest first, ordered like its history. */
	values: Schema.Array(Schema.Number),
})

const SourceSparklines = Schema.Struct({
	source: SourceIdSchema,
	points: Schema.Int,
	series: Schema.Array(Sparkline),
})
type SourceSparklines = typeof SourceSparklines.Type

const Health = Schema.Struct({
	status: Schema.Literal("ok"),
	database: Schema.Literal("ok"),
	collectorEnabled: Schema.Boolean,
})

export class SourceNotFound extends Schema.TaggedError<SourceNotFound>()(
	"SourceNotFound",
	{ source: Schema.String },
	{ httpApiStatus: 404 },
) {}

export class InstrumentNotFound extends Schema.TaggedError<InstrumentNotFound>()(
	"InstrumentNotFound",
	{ source: Schema.String, externalId: Schema.String },
	{ httpApiStatus: 404 },
) {}

class SystemApi extends HttpApiGroup.make("system", { topLevel: true }).add(
	HttpApiEndpoint.get("health", "/health", {
		success: Health,
		error: HttpApiError.ServiceUnavailable,
	}),
) {}

class SourcesApi extends HttpApiGroup.make("sources")
	.add(
		HttpApiEndpoint.get("list", "/sources", {
			success: Schema.Array(SourceStatus),
		}),
		HttpApiEndpoint.get("latest", "/sources/:source/latest", {
			params: { source: Schema.String },
			success: LatestSnapshot,
			error: SourceNotFound,
		}),
		HttpApiEndpoint.get("history", "/sources/:source/instruments/:externalId/history", {
			params: { source: Schema.String, externalId: Schema.String },
			query: { limit: Schema.optional(HistoryLimit) },
			success: InstrumentHistory,
			error: [SourceNotFound, InstrumentNotFound],
		}),
		HttpApiEndpoint.get("sparklines", "/sources/:source/sparklines", {
			params: { source: Schema.String },
			query: { points: Schema.optional(SparklinePoints) },
			success: SourceSparklines,
			error: SourceNotFound,
		}),
	)
	.prefix("/v1")
	.annotateMerge(
		OpenApi.annotations({
			title: "Sources",
			description: "Collected data, served from the FundStats database.",
		}),
	) {}

export class FundStatsApi extends HttpApi.make("fundstats")
	.add(SystemApi)
	.add(SourcesApi)
	.prefix("/api")
	.annotateMerge(
		OpenApi.annotations({
			title: "FundStats API",
			version: "1.0.0",
			description:
				"Read-only access to fund and crypto returns collected by FundStats. Data comes from the FundStats database, never live from upstream providers.",
		}),
	) {}
