/** Applies pending database migrations: `bun run db:migrate`. */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { AppConfig } from "../config.ts"
import { Database } from "../db/Database.ts"

// Building the Database layer applies migrations (RUN_MIGRATIONS defaults to true).
Effect.logInfo("Database is up to date").pipe(
	Effect.provide(Database.layer.pipe(Layer.provide(AppConfig.layer))),
	NodeRuntime.runMain,
)
