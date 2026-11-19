import { FundStatsApi } from "@fundstats/shared/api"
import type { SourceId } from "@fundstats/shared/sources"
/**
 * Typed API client derived from the shared HttpApi definition, plus the React
 * Query options built on it. In the browser it calls /api over fetch; during
 * SSR Nitro's serverFetch answers it in-process, so the server never makes an
 * HTTP request to itself.
 */
import { queryOptions } from "@tanstack/react-query"
import { createIsomorphicFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import { FetchHttpClient } from "effect/http"
import { HttpApiClient } from "effect/http-api"

type ApiClient = HttpApiClient.ForApi<typeof FundStatsApi>

const transport = createIsomorphicFn()
	.server(() => ({
		baseUrl: "http://fundstats.internal",
		fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
			const { serverFetch } = await import("nitro")
			return serverFetch(new Request(input, init))
		}) as typeof globalThis.fetch,
	}))
	.client(() => ({ baseUrl: window.location.origin, fetch: globalThis.fetch.bind(globalThis) }))

/** Runs one typed API call and returns its result as a Promise. */
const callApi = <A, E>(call: (client: ApiClient) => Effect.Effect<A, E>): Promise<A> => {
	const { baseUrl, fetch } = transport()
	return Effect.runPromise(
		HttpApiClient.make(FundStatsApi, { baseUrl }).pipe(
			Effect.flatMap(call),
			Effect.provide(FetchHttpClient.layer),
			Effect.provideService(FetchHttpClient.Fetch, fetch),
		),
	)
}

export const latestQuery = (source: SourceId) =>
	queryOptions({
		queryKey: ["latest", source],
		queryFn: () => callApi((api) => api.sources.latest({ params: { source } })),
		staleTime: 30_000,
	})

/** Every source's freshness, for the sidebar's status dots. */
export const sourcesQuery = () =>
	queryOptions({
		queryKey: ["sources"],
		queryFn: () => callApi((api) => api.sources.list()),
		staleTime: 30_000,
	})

/** How many recent points each sparkline draws. */
const SPARKLINE_POINTS = 24

/** The last points of every instrument of a source, keyed by external id, in one request. */
export const sparklinesQuery = (source: SourceId) =>
	queryOptions({
		queryKey: ["sparklines", source],
		queryFn: () =>
			callApi((api) => api.sources.sparklines({ params: { source }, query: { points: SPARKLINE_POINTS } })),
		select: (data) => new Map(data.series.map((s) => [s.externalId, s.values])),
		staleTime: 30_000,
	})

/** Instruments in every source matching `q`, for the search box's suggestions. */
export const searchQuery = (q: string) =>
	queryOptions({
		queryKey: ["search", q],
		queryFn: () => callApi((api) => api.sources.search({ query: { q, limit: 24 } })),
		staleTime: 5 * 60_000,
	})

/** The API's maximum: years of daily points for any source (older crypto quotes are thinned to one a day). */
export const HISTORY_LIMIT = 5000

/** An instrument's stored history, newest first; null when the source never reported it. */
export const historyQuery = (source: SourceId, externalId: string) =>
	queryOptions({
		queryKey: ["history", source, externalId],
		queryFn: () =>
			callApi((api) =>
				api.sources
					.history({ params: { source, externalId }, query: { limit: HISTORY_LIMIT } })
					.pipe(Effect.catchTags({ InstrumentNotFound: () => Effect.succeed(null) })),
			),
		staleTime: 5 * 60_000,
	})

/** The API's health and how long the round trip took, for the footer. */
export const healthQuery = () =>
	queryOptions({
		queryKey: ["health"],
		queryFn: async () => {
			const started = performance.now()
			const health = await callApi((api) => api.health())
			return { ...health, ms: Math.round(performance.now() - started) }
		},
		staleTime: 30_000,
	})
