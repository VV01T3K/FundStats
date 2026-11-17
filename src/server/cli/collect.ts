/**
 * Runs one source once, outside the app: `bun run collect <source>`
 * (or `bun run collect all`). Uses the same config and database as the app;
 * applies pending migrations first unless RUN_MIGRATIONS=false.
 */
import { NodeRuntime } from "@effect/platform-node"
import { Console, Effect } from "effect"
import { SOURCE_IDS } from "#/shared/sources.ts"
import { Collector } from "../collector/Collector.ts"
import { ServicesLayer } from "../runtime.ts"

const arg = process.argv[2]

const program = Effect.gen(function* () {
	if (!arg || (arg !== "all" && !SOURCE_IDS.includes(arg as never))) {
		yield* Console.error(`Usage: bun run collect <${[...SOURCE_IDS, "all"].join("|")}>`)
		return yield* Effect.fail(new Error("missing or unknown source"))
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
	if (failed > 0) return yield* Effect.fail(new Error(`${failed} source(s) failed or were skipped`))
})

program.pipe(Effect.provide(ServicesLayer), NodeRuntime.runMain)
