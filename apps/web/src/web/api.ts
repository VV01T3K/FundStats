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
		staleTime: 60_000,
		// The collector updates crypto every 30 minutes; keep an open tab reasonably fresh.
		refetchInterval: 5 * 60_000,
	})
