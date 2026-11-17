/**
 * Nitro plugin that boots the backend when the process starts (requests wait for it). A failed boot
 * exits with status 1 so the deploy fails visibly instead of answering 500s. getServer() keeps one
 * instance per process, so dev reloads never start a second collector.
 */
import * as Effect from "effect/Effect"
import { definePlugin } from "nitro"

import { getServer } from "./runtime.ts"

export default definePlugin(async () => {
	try {
		await getServer()
	} catch (error) {
		await Effect.runPromise(Effect.logError("FundStats failed to start:", error))
		process.exit(1)
	}
})
