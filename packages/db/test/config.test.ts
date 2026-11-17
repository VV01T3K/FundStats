import { assert, describe, it } from "@effect/vitest"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { DbConfig } from "../src/DbConfig.ts"

const load = (env: Record<string, string>) =>
	Effect.service(DbConfig).pipe(
		Effect.provide(
			DbConfig.layer.pipe(
				Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord({ DATABASE_URL: "postgres://x", ...env }))),
			),
		),
	)

describe("database config validation", () => {
	it.effect("reads DB_STATEMENT_TIMEOUT, 30 seconds by default", () =>
		Effect.gen(function* () {
			assert.strictEqual(Duration.toMillis((yield* load({})).dbStatementTimeout), 30_000)
			assert.strictEqual(
				Duration.toMillis((yield* load({ DB_STATEMENT_TIMEOUT: "5 seconds" })).dbStatementTimeout),
				5_000,
			)
		}),
	)

	it.effect.each([
		["DB_POOL_MAX", "0"],
		["DB_POOL_MAX", "-3"],
		["DB_STATEMENT_TIMEOUT", "0 seconds"],
		["DB_STATEMENT_TIMEOUT", "500 millis"],
		["DB_STATEMENT_TIMEOUT", "-5 seconds"],
		["DB_STATEMENT_TIMEOUT", "Infinity"],
	] as const)("rejects %s=%s", ([name, value]) =>
		Effect.gen(function* () {
			const error = yield* load({ [name]: value }).pipe(Effect.flip)
			assert.strictEqual(error._tag, "ConfigError")
		}),
	)
})
