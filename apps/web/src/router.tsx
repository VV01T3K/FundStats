import { QueryClient } from "@tanstack/react-query"
import { createRouter } from "@tanstack/react-router"
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query"

import { routeTree } from "./routeTree.gen"

export function getRouter() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { staleTime: 60_000 } },
	})
	const router = createRouter({
		routeTree,
		context: { queryClient },
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
