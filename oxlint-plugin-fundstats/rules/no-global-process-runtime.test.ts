import { assert, describe } from "@effect/vitest"

import { createOxlintRuleHarness } from "../test/utils.ts"

const rule = createOxlintRuleHarness("fundstats/no-global-process-runtime")

describe("fundstats/no-global-process-runtime", () => {
	rule.valid(
		"allows a platform read from Config",
		`
      import * as Config from "effect/Config";
      import * as Effect from "effect/Effect";

      export const isWindows = Effect.map(Config.string("PLATFORM"), (platform) => platform === "win32");
    `,
	)

	rule.valid(
		"allows unrelated process members",
		`
      process.exitCode = 1;
      const nodeEnv = process.env.NODE_ENV;
    `,
	)

	rule.valid(
		"allows unrelated node os imports",
		`
      import { tmpdir } from "node:os";

      export const tempDirectory = tmpdir();
    `,
	)

	rule.invalid(
		"reports direct platform reads",
		`
      export const isWindows = process.platform === "win32";
    `,
		(output) => {
			assert.match(output, /Do not read process\.platform/)
		},
	)

	rule.invalid(
		"reports direct architecture reads",
		`
      export const isArm = process.arch === "arm64";
    `,
		(output) => {
			assert.match(output, /Do not read process\.arch/)
		},
	)

	rule.invalid(
		"reports globalThis process platform reads",
		`
      export const terminalName = globalThis.process.platform === "win32" ? "xterm-color" : "xterm-256color";
    `,
	)

	rule.invalid(
		"reports node os namespace platform reads",
		`
      import * as NodeOS from "node:os";

      export const isWindows = NodeOS.platform() === "win32";
    `,
		(output) => {
			assert.match(output, /Do not read process\.platform/)
		},
	)

	rule.invalid(
		"reports renamed node os architecture imports",
		`
      import { arch as hostArch } from "node:os";

      export const isArm = hostArch() === "arm64";
    `,
		(output) => {
			assert.match(output, /Do not read process\.arch/)
		},
	)

	rule.invalid(
		"reports default node os platform reads",
		`
      import os from "node:os";

      export const isWindows = os.platform() === "win32";
    `,
	)
})
