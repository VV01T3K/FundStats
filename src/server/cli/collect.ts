/**
 * Runs one source once, outside the app: `bun run collect <source>`
 * (or `bun run collect all`). Uses the same config and database as the app;
 * applies pending migrations first unless RUN_MIGRATIONS=false.
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { SOURCE_IDS } from "#/shared/sources.ts"

import { Collector } from "../collector/Collector.ts"
import { ServicesLayer } from "../runtime.ts"

class CollectFailed extends Schema.TaggedError<CollectFailed>()("CollectFailed", {
	message: Schema.String,
}) {}

const arg = process.argv[2]

const program = Effect.gen(function* () {
	if (!arg || (arg !== "all" && !SOURCE_IDS.includes(arg as never))) {
		yield* Console.error(`Usage: bun run collect <${[...SOURCE_IDS, "all"].join("|")}>`)
		return yield* new CollectFailed({ message: "missing or unknown source" })
	}
	const collector = yield* Collector
	const ids = arg === "all" ? SOURCE_IDS : [arg]
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
})

program.pipe(Effect.provide(ServicesLayer), NodeRuntime.runMain)
