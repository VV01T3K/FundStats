import { type Duration, Effect, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import type { Metrics } from "#/shared/metrics.ts"
import type { SourceInfo } from "#/shared/sources.ts"
import type { AppConfig } from "../config.ts"

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

export class SourceError extends Schema.TaggedError<SourceError>()("SourceError", {
	source: Schema.String,
	reason: Schema.Literals(["http", "timeout", "decode", "upstream"]),
	message: Schema.String,
	cause: Schema.optional(Schema.Defect()),
}) {}

export interface Fetched<Payload> {
	/** Decoded payload handed to `normalize`. */
	readonly payload: Payload
	/** The upstream JSON as received (possibly trimmed), stored for re-normalizing. */
	readonly raw: unknown
}

/**
 * A data source. To add one: write `src/server/sources/<id>.ts` exporting a
 * `defineSource(...)`, add its metadata to `src/shared/sources.ts`, register it
 * in `src/server/sources/registry.ts`, and add a column config in
 * `src/web/tables/`.
 */
export interface Source<Payload = unknown> {
	readonly info: SourceInfo
	/** How often the collector runs it; override with COLLECTOR_INTERVAL_<ID>. */
	readonly defaultInterval: Duration.Input
	readonly fetch: Effect.Effect<Fetched<Payload>, SourceError, HttpClient.HttpClient | AppConfig>
	/** Pure: no I/O, no clock. Tested against saved fixture payloads. */
	readonly normalize: (payload: Payload) => ReadonlyArray<NormalizedRow>
}

// biome-ignore lint/suspicious/noExplicitAny: the registry holds sources with different payload types.
export type AnySource = Source<any>

export const defineSource = <Payload>(source: Source<Payload>): Source<Payload> => source

const REQUEST_TIMEOUT = "30 seconds"

/** Capped exponential backoff with jitter: 1s, 2s, 4s (+ jitter), at most 3 retries. */
const retrySchedule = Schedule.exponential("1 second").pipe(Schedule.jittered)

const USER_AGENT = "FundStats/2.0"

/**
 * Executes a request with a timeout and retries for transient failures
 * (network errors, 429, 5xx), checks the status, and decodes the JSON body
 * with `schema`. Returns both the decoded value and the raw JSON.
 */
export const fetchJson = <S extends Schema.Top>(
	sourceId: string,
	request: HttpClientRequest.HttpClientRequest,
	schema: S & Schema.Codec<S["Type"], S["Encoded"], never, never>,
) =>
	Effect.gen(function* () {
		const client = (yield* HttpClient.HttpClient).pipe(
			HttpClient.mapRequest(HttpClientRequest.setHeader("user-agent", USER_AGENT)),
			HttpClient.filterStatusOk,
			HttpClient.transformResponse(Effect.timeout(REQUEST_TIMEOUT)),
			HttpClient.retryTransient({ schedule: retrySchedule, times: 3 }),
		)
		const response = yield* client.execute(request).pipe(
			Effect.catchTag("TimeoutError", (cause) =>
				Effect.fail(
					new SourceError({
						source: sourceId,
						reason: "timeout",
						message: `Request timed out after ${REQUEST_TIMEOUT}`,
						cause,
					}),
				),
			),
			Effect.catchTag("HttpClientError", (cause) =>
				Effect.fail(new SourceError({ source: sourceId, reason: "http", message: cause.message, cause })),
			),
		)
		const raw = yield* response.json.pipe(
			Effect.mapError(
				(cause) =>
					new SourceError({
						source: sourceId,
						reason: "decode",
						message: `Response is not JSON: ${cause.message}`,
						cause,
					}),
			),
		)
		const payload = yield* Schema.decodeUnknownEffect(schema)(raw).pipe(
			Effect.mapError(
				(cause) =>
					new SourceError({
						source: sourceId,
						reason: "decode",
						message: `Unexpected payload shape: ${cause.message}`,
						cause,
					}),
			),
		)
		return { raw, payload: payload as S["Type"] }
	})
