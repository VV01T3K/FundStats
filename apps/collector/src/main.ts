/** Process entry point; the only file that picks a platform runtime. */
import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as BunServices from "@effect/platform-bun/BunServices"
import * as Effect from "effect/Effect"

import { cli } from "./cli.ts"

cli.pipe(Effect.provide(BunServices.layer), BunRuntime.runMain)
