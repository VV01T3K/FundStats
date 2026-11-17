import * as Cause from "effect/Cause"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"

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
 * A data source; README "Add a source" lists the files to touch. The collector stores what `fetch`
 * returns as the raw payload before decoding it with `payload` and calling `normalize`, so a changed
 * upstream shape fails the run but keeps the response to inspect and replay.
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
	/** `payload`'s decoder, compiled once by `defineSource`. */
	readonly decode: (raw: unknown) => Effect.Effect<Payload, SourceError>
}

// `any`: the registry holds sources with different payload types.
export type AnySource = Source<any>

export const defineSource = <Payload>(definition: Omit<Source<Payload>, "decode">): Source<Payload> => {
	const decodeUnknown = Schema.decodeUnknownEffect(definition.payload)
	return {
		...definition,
		decode: (raw) =>
			decodeUnknown(raw).pipe(
				Effect.mapError(
					(cause) =>
						new SourceError({
							source: definition.info.id,
							reason: "decode",
							message: `Unexpected payload shape: ${cause.message}`,
							cause,
						}),
				),
			),
	}
}

/** Budget of one attempt: the request and reading the whole body. */
const REQUEST_TIMEOUT = "30 seconds"

/** Capped exponential backoff with jitter: 1s, 2s, 4s (+ jitter), at most 3 retries. */
const retrySchedule = Schedule.exponential("1 second").pipe(Schedule.jittered)
const RETRIES = 3

const USER_AGENT = "FundStats/2.0"

/**
 * Executes a request and returns its JSON body undecoded. Each attempt (request and whole body) gets
 * REQUEST_TIMEOUT, so a stalled upstream cannot hold a run; transient failures (network, timeout,
 * 429, 5xx) are retried with backoff, honoring Retry-After.
 */
export const fetchJson = Effect.fn("Source.fetchJson")(function* (
	sourceId: string,
	request: HttpClientRequest.HttpClientRequest,
) {
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
