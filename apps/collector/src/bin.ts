/** Process entry point; the only file that picks a platform runtime. */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"

import { cli } from "./cli.ts"

cli.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain)
