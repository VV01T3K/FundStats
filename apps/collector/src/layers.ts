import { Database } from "@fundstats/db/Database"
import { DbConfig } from "@fundstats/db/DbConfig"
import { RunStore } from "@fundstats/db/RunStore"
import { SourceLocks } from "@fundstats/db/SourceLocks"
import { Store } from "@fundstats/db/Store"
import * as Layer from "effect/Layer"

import { Collector } from "./Collector.ts"
import { CollectorConfig } from "./config.ts"

const Config = Layer.mergeAll(CollectorConfig.layer, DbConfig.layer)

/** Config, database, stores and collector: everything the collector's commands need except background work. */
export const ServicesLayer = Collector.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(Store.layer, RunStore.layer)),
	Layer.provideMerge(SourceLocks.layer),
	Layer.provideMerge(Database.layer),
	Layer.provideMerge(Config),
)

export const ConfigLayer = Config
