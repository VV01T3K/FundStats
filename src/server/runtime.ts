/**
 * The single composition root for the server. The API web handler, the
 * collector scheduler and any server function share one set of services (one
 * config, one connection pool) through a shared layer memo map.
 *
 * Nothing in here may be imported from browser code.
 */
import * as Effect from "effect/Effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"

import { FundStatsApi } from "#/shared/api.ts"

import { ApiHandlers } from "./api/handlers.ts"
import { Collector, CollectorScheduler } from "./collector/Collector.ts"
import { AppConfig } from "./config.ts"
import { Database } from "./db/Database.ts"
import { Store } from "./db/Store.ts"

/** Config, database, store and collector: everything except background work. */
export const ServicesLayer = Collector.layer.pipe(
	Layer.provideMerge(Store.layer),
	Layer.provideMerge(Database.layer),
	Layer.provideMerge(AppConfig.layer),
)

/** The HTTP API routes, including /api/openapi.json and /api/docs. */
export const ApiRoutesLayer = Layer.mergeAll(
	HttpApiBuilder.layer(FundStatsApi, { openapiPath: "/api/openapi.json" }).pipe(Layer.provide(ApiHandlers)),
	HttpApiScalar.layer(FundStatsApi, { path: "/api/docs" }),
)

const makeServer = () => {
	const memoMap = Layer.makeMemoMapUnsafe()
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(ServicesLayer, CollectorScheduler.pipe(Layer.provide(ServicesLayer))),
		{ memoMap },
	)
	const api = HttpRouter.toWebHandler(
		ApiRoutesLayer.pipe(Layer.provide(ServicesLayer), Layer.provide(HttpServer.layerServices)),
		{ memoMap, disableLogger: true },
	)
	return {
		runtime,
		handleApi: (request: Request) => api.handler(request),
		dispose: async () => {
			await api.dispose()
			await runtime.dispose()
		},
	}
}

export type Server = ReturnType<typeof makeServer>

// One instance per process. Vite's dev server re-evaluates modules on change,
// and several entry points import this file, so the instance lives on
// globalThis to guarantee one pool and one collector. Server code changes in
// dev therefore need a dev-server restart to reach the running collector.
const globalKey = Symbol.for("fundstats.server")
type Global = typeof globalThis & { [globalKey]?: { server: Server; booted: Promise<void> } }

/**
 * Returns the process-wide server, building it on first call: reads and
 * validates config, connects to Postgres, runs migrations and starts the
 * collector. Rejects (and should crash the process) if any of that fails.
 */
export const getServer = (): Promise<Server> => {
	const g = globalThis as Global
	if (!g[globalKey]) {
		const server = makeServer()
		const booted = server.runtime.runPromise(Effect.logInfo("FundStats server ready"))
		g[globalKey] = { server, booted }
		const shutdown = (signal: string) => {
			void server.runtime
				.runPromise(Effect.logInfo(`${signal} received, shutting down`))
				.finally(() => server.dispose())
				.finally(() => process.exit(0))
		}
		process.once("SIGTERM", () => shutdown("SIGTERM"))
		process.once("SIGINT", () => shutdown("SIGINT"))
	}
	const { server, booted } = g[globalKey]
	return booted.then(() => server)
}
