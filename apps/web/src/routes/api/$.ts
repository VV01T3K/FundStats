import { createFileRoute } from "@tanstack/react-router"

/**
 * Mounts the Effect HttpApi (src/shared/api.ts) under /api/*. The server
 * module is imported lazily so it never reaches the browser bundle.
 */
const handle = async ({ request }: { request: Request }) => {
	const { getServer } = await import("#/server/runtime.ts")
	const server = await getServer()
	return server.handleApi(request)
}

export const Route = createFileRoute("/api/$")({
	server: {
		handlers: { GET: handle, HEAD: handle, POST: handle, PUT: handle, PATCH: handle, DELETE: handle, OPTIONS: handle },
	},
})
