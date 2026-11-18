import { QueryClient } from "@tanstack/react-query"
import { createRouter } from "@tanstack/react-router"
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query"

import { routeTree } from "./routeTree.gen"

/**
 * Plain `key=value` search params (the router's default JSON-encodes values, turning `?risk=3`
 * into a number and `?pin=a,b` into `%5B…`); routes validate every value as a string.
 */
const parseSearch = (search: string): Record<string, unknown> =>
	Object.fromEntries(new URLSearchParams(search.startsWith("?") ? search.slice(1) : search))

const stringifySearch = (search: Record<string, unknown>) => {
	const params = new URLSearchParams()
	for (const [key, value] of Object.entries(search)) {
		if (value !== undefined && value !== null && value !== "") params.set(key, String(value))
	}
	const text = params.toString().replaceAll("%2C", ",")
	return text.length > 0 ? `?${text}` : ""
}

export function getRouter() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { staleTime: 60_000 } },
	})
	const router = createRouter({
		routeTree,
		context: { queryClient },
		parseSearch,
		stringifySearch,
		scrollRestoration: true,
		defaultPreload: "intent",
		// Loader data comes from React Query, which has its own staleness rules.
		defaultPreloadStaleTime: 0,
	})
	setupRouterSsrQueryIntegration({ router, queryClient })
	return router
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>
	}
}
