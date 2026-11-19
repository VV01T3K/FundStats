import { Database } from "@fundstats/db/Database"
import { DataEvents } from "@fundstats/db/DataEvents"
import { DbConfig } from "@fundstats/db/DbConfig"
import { Store } from "@fundstats/db/Store"
import { FundStatsApi } from "@fundstats/shared/api"
/**
 * The web server's composition: the read-only services and the HTTP API built on them. The collector
 * is a separate process (apps/collector); this app never writes.
 *
 * Nothing in here may be imported from browser code.
 */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api"
import * as Layer from "effect/Layer"

import { ApiHandlers } from "./api/handlers.ts"

/** Config, the read-only database pool, the store and the new-data listener. */
const ServicesLayer = Layer.merge(Store.layer, DataEvents.layer).pipe(
	Layer.provideMerge(Database.layerReadOnly),
	Layer.provideMerge(DbConfig.layer),
)

/** The HTTP API routes, including /api/openapi.json and /api/docs. */
export const ApiRoutesLayer = Layer.mergeAll(
	HttpApiBuilder.layer(FundStatsApi, { openapiPath: "/api/openapi.json" }).pipe(Layer.provide(ApiHandlers)),
	HttpApiScalar.layer(FundStatsApi, { path: "/api/docs" }),
)

/**
 * The API as a web handler that owns its services: it starts building them (config, the read-only
 * pool, the schema check) at once, `ready` settles when that build does, and `dispose` closes them.
 */
export const makeApi = () => {
	const ready = Promise.withResolvers<void>()
	const { handler, dispose } = HttpRouter.toWebHandler(
		ApiRoutesLayer.pipe(
			Layer.provide(ServicesLayer),
			Layer.provide(HttpServer.layerServices),
			Layer.tap(() => Effect.logInfo("FundStats server ready").pipe(Effect.andThen(Effect.sync(ready.resolve)))),
			Layer.tapCause((cause) => Effect.sync(() => ready.reject(Cause.squash(cause)))),
		),
		{ disableLogger: true },
	)
	return { handler, dispose, ready: ready.promise }
}

export type Api = ReturnType<typeof makeApi>
