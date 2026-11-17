import { runMigrations } from "@fundstats/db/Migrations"
import { SOURCE_IDS } from "@fundstats/shared/sources"
import { Argument, Command } from "effect/cli"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import { Collector } from "./Collector.ts"
import { CollectorConfig } from "./config.ts"
import { ConfigLayer, ServicesLayer } from "./layers.ts"
import { CollectorScheduler } from "./Scheduler.ts"

class CollectFailed extends Schema.TaggedError<CollectFailed>()("CollectFailed", {
	message: Schema.String,
}) {}

const start = Command.make("start", {}, () =>
	Effect.logInfo("FundStats collector starting").pipe(
		Effect.andThen(Layer.launch(CollectorScheduler.pipe(Layer.provide(ServicesLayer)))),
	),
).pipe(
	Command.withDescription(
		"Apply migrations, record the schedule and collect every source on its interval until stopped",
	),
)

const collect = Command.make(
	"collect",
	{
		source: Argument.Literals("source", [...SOURCE_IDS, "all"]).pipe(
			Argument.withDescription("The source to collect once, or all of them"),
		),
	},
	Effect.fn("Cli.collect")(function* ({ source }) {
		const collector = yield* Collector
		const ids = source === "all" ? SOURCE_IDS : [source]
		let failed = 0
		for (const id of ids) {
			const result = yield* collector.runOnce(id, "cli").pipe(
				Effect.map((r) => `${id}: ok, ${r.instrumentCount} instruments, ${r.rowsWritten} rows written`),
				Effect.catch((error) => {
					failed++
					return Effect.succeed(
						error._tag === "SourceBusy"
							? `${id}: SKIPPED, ${error.message}; nothing was collected`
							: `${id}: FAILED, ${error._tag}: ${error.message}`,
					)
				}),
			)
			yield* Console.log(result)
		}
		if (failed > 0) return yield* new CollectFailed({ message: `${failed} source(s) failed or were skipped` })
	}, Effect.provide(ServicesLayer)),
).pipe(Command.withDescription("Run sources once, outside the schedule (applies pending migrations first)"))

const migrate = Command.make("migrate", {}, () =>
	Effect.gen(function* () {
		const config = yield* CollectorConfig
		yield* runMigrations(config.migrationsDir)
		yield* Effect.logInfo("Database is up to date")
	}).pipe(Effect.provide(ConfigLayer)),
).pipe(Command.withDescription("Apply pending database migrations"))

/** The collector's command line: `start`, `collect <source|all>`, `migrate`. */
export const cli = Command.make("collector").pipe(
	Command.withDescription("FundStats collector"),
	Command.withSubcommands([start, collect, migrate]),
	Command.run({ version: "2.0.0" }),
)
