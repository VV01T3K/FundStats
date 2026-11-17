import { Cause, type Duration, Effect, Schedule, Schema } from "effect"
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

/**
 * A data source. To add one: write `src/server/sources/<id>.ts` exporting a
 * `defineSource(...)`, add its metadata to `src/shared/sources.ts`, register it
 * in `src/server/sources/registry.ts`, and add a column config in
 * `src/web/tables/`.
 *
 * The collector runs `fetch`, stores what it returns as the run's raw payload,
 * and only then decodes it with `payload` and calls `normalize`. A changed
 * upstream shape therefore fails the run but keeps the response to inspect
 * and replay.
 */
export interface Source<Payload = unknown> {
	readonly info: SourceInfo
	/** How often the collector runs it; override with COLLECTOR_INTERVAL_<ID>. */
	readonly defaultInterval: Duration.Input
	/** Calls the upstream and returns its JSON as received (possibly trimmed), undecoded. */
	readonly fetch: Effect.Effect<unknown, SourceError, HttpClient.HttpClient | AppConfig>
	/** Decodes what `fetch` returned. */
	readonly payload: Schema.Codec<Payload, unknown, never, never>
	/** Pure: no I/O, no clock. Tested against saved fixture payloads. */
	readonly normalize: (payload: Payload) => ReadonlyArray<NormalizedRow>
}

// biome-ignore lint/suspicious/noExplicitAny: the registry holds sources with different payload types.
export type AnySource = Source<any>

export const defineSource = <Payload>(source: Source<Payload>): Source<Payload> => source

/** Budget of one attempt: the request and reading the whole body. */
export const REQUEST_TIMEOUT = "30 seconds"

/** Capped exponential backoff with jitter: 1s, 2s, 4s (+ jitter), at most 3 retries. */
const retrySchedule = Schedule.exponential("1 second").pipe(Schedule.jittered)
const RETRIES = 3

const USER_AGENT = "FundStats/2.0"

/**
 * Executes a request and reads its JSON body. Each attempt, request and whole
 * body, gets REQUEST_TIMEOUT, so an upstream that sends headers and then
 * stalls cannot hold a run forever. Transient failures (network errors,
 * timeouts, 429, 5xx) are retried with backoff, honoring Retry-After.
 * Returns the JSON undecoded.
 */
export const fetchJson = (sourceId: string, request: HttpClientRequest.HttpClientRequest) =>
	Effect.gen(function* () {
		const client = (yield* HttpClient.HttpClient).pipe(
			HttpClient.mapRequest(HttpClientRequest.setHeader("user-agent", USER_AGENT)),
			HttpClient.filterStatusOk,
			// Read the body inside the attempt; the response caches it for `json` below.
			HttpClient.transformResponse(Effect.tap((response) => response.arrayBuffer)),
			// Applied before retryTransient, so every attempt gets its own budget.
			HttpClient.timeout(REQUEST_TIMEOUT),
			HttpClient.retryTransient({ schedule: retrySchedule, times: RETRIES }),
		)
		return yield* client.execute(request).pipe(
			Effect.flatMap((response) => response.json),
			Effect.mapError((cause) => {
				const reason = cause.reason
				if (reason._tag === "TransportError" && Cause.isTimeoutError(reason.cause)) {
					return new SourceError({
						source: sourceId,
						reason: "timeout",
						message: `Request timed out after ${REQUEST_TIMEOUT} (${RETRIES + 1} attempts)`,
						cause,
					})
				}
				return new SourceError({
					source: sourceId,
					reason: reason._tag === "DecodeError" ? "decode" : "http",
					message: reason._tag === "DecodeError" ? `Response is not JSON: ${cause.message}` : cause.message,
					cause,
				})
			}),
		)
	})

/** Decodes a fetched payload with the source's schema. */
export const decodePayload = <Payload>(source: Source<Payload>, raw: unknown) =>
	Schema.decodeUnknownEffect(source.payload)(raw).pipe(
		Effect.mapError(
			(cause) =>
				new SourceError({
					source: source.info.id,
					reason: "decode",
					message: `Unexpected payload shape: ${cause.message}`,
					cause,
				}),
		),
	)
