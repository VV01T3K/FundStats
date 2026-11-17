/**
 * The process's API, built when Nitro loads this module: served on /api/** (vite.config.ts), awaited
 * and closed by the boot plugin. Pages reach it in-process through Nitro's serverFetch.
 */
import { defineHandler } from "nitro"

import { type Api, makeApi } from "./runtime.ts"

// In dev, a server-code edit re-evaluates this module without closing the Nitro app; close the API
// it replaces, so there is one pool at a time. import.meta.hot is undefined in production builds.
const replaced: Api | undefined = import.meta.hot?.data.api
if (replaced) void replaced.dispose()

export const api = makeApi()
if (import.meta.hot) import.meta.hot.data.api = api

export default defineHandler((event) => api.handler(event.req))
