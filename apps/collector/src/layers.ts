import { Database } from "@fundstats/db/Database"
import { DbConfig } from "@fundstats/db/DbConfig"
import { runMigrations } from "@fundstats/db/Migrations"
import { RunStore } from "@fundstats/db/RunStore"
import { SourceLocks } from "@fundstats/db/SourceLocks"
import { Store } from "@fundstats/db/Store"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { Collector } from "./Collector.ts"
import { CollectorConfig } from "./config.ts"

const Config = Layer.mergeAll(CollectorConfig.layer, DbConfig.layer)

/** Applies pending migrations (unless RUN_MIGRATIONS=false) before anything reads or writes. */
const Migrated = Layer.effectDiscard(
	Effect.gen(function* () {
		const config = yield* CollectorConfig
		if (config.runMigrations) yield* runMigrations(config.migrationsDir)
	}),
)

/** Config, database, stores and collector: everything the collector's commands need except background work. */
export const ServicesLayer = Collector.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(Store.layer, RunStore.layer)),
	Layer.provideMerge(SourceLocks.layer),
	Layer.provideMerge(Database.layer),
	Layer.provideMerge(Migrated),
	Layer.provideMerge(Config),
)

export const ConfigLayer = Config
