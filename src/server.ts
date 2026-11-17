/**
 * Custom server entry. It boots the Effect runtime (config validation,
 * database connection, migrations, collector) before serving any request, so
 * a misconfigured deployment fails at start instead of on first use.
 */
import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import { getServer } from "./server/runtime.ts"

await getServer()

export default createServerEntry({
	fetch(request) {
		return handler.fetch(request)
	},
})
