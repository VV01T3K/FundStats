/**
 * Nitro runtime plugin: boots the Effect runtime (config validation, database
 * connection, migrations, collector) when the server process starts, not on
 * the first request. Nitro holds incoming requests until this finishes. If
 * boot fails, for example because DATABASE_URL is missing, the process exits
 * with status 1 so the container restarts or the deploy fails visibly,
 * instead of answering every request with a 500.
 *
 * Registered in vite.config.ts (`nitro({ plugins })`). getServer() keeps one
 * instance per process, so a re-run of this plugin (dev reloads) never starts
 * a second collector.
 */
import { definePlugin } from "nitro"
import { getServer } from "./runtime.ts"

export default definePlugin(async () => {
	try {
		await getServer()
	} catch (error) {
		console.error("FundStats failed to start:", error)
		process.exit(1)
	}
})
