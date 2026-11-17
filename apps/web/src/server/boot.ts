/**
 * Nitro plugin: the process waits for the API's services at start and closes them with the server. A
 * failed start (bad config, Postgres unreachable or not migrated) exits with status 1 so the deploy
 * fails visibly instead of answering 500s.
 */
import * as Effect from "effect/Effect"
import { definePlugin } from "nitro"

import { api } from "./api.ts"

export default definePlugin(async (nitroApp) => {
	nitroApp.hooks.hook("close", () => api.dispose())
	try {
		await api.ready
	} catch (error) {
		await Effect.runPromise(Effect.logError("FundStats failed to start:", error))
		process.exit(1)
	}
})
