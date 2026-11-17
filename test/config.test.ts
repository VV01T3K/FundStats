import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Duration, Effect, Layer } from "effect"
import { AppConfig } from "#/server/config.ts"

const load = (env: Record<string, string>) =>
	Effect.gen(function* () {
		return yield* AppConfig
	}).pipe(
		Effect.provide(
			AppConfig.layer.pipe(
				Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord({ DATABASE_URL: "postgres://x", ...env }))),
			),
		),
	)

describe("config validation", () => {
	for (const value of ["0 seconds", "-5 minutes", "Infinity", "30 seconds"]) {
		it.effect(`rejects COLLECTOR_INTERVAL_MBANK=${value}`, () =>
			Effect.gen(function* () {
				const error = yield* load({ COLLECTOR_INTERVAL_MBANK: value }).pipe(Effect.flip)
				assert.strictEqual(error._tag, "ConfigError")
			}),
		)
	}

	it.effect("accepts an interval of one minute or more", () =>
		Effect.gen(function* () {
			const config = yield* load({ COLLECTOR_INTERVAL_MBANK: "1 minute", COLLECTOR_INTERVAL_COINGECKO: "2 hours" })
			assert.strictEqual(
				Duration.toMillis(config.intervalOverride("mbank").pipe((o) => (o._tag === "Some" ? o.value : Duration.zero))),
				60_000,
			)
		}),
	)

	it.effect("reads DB_STATEMENT_TIMEOUT, 30 seconds by default", () =>
		Effect.gen(function* () {
			assert.strictEqual(Duration.toMillis((yield* load({})).dbStatementTimeout), 30_000)
			assert.strictEqual(
				Duration.toMillis((yield* load({ DB_STATEMENT_TIMEOUT: "5 seconds" })).dbStatementTimeout),
				5_000,
			)
		}),
	)

	it.effect("treats an empty interval as unset, as compose.yaml passes it", () =>
		Effect.gen(function* () {
			const config = yield* load({ COLLECTOR_INTERVAL_MBANK: "" })
			assert.strictEqual(config.intervalOverride("mbank")._tag, "None")
		}),
	)

	for (const [name, value] of [
		["DB_POOL_MAX", "0"],
		["DB_POOL_MAX", "-3"],
		["RAW_PAYLOAD_RETENTION_DAYS", "0"],
		["RAW_PAYLOAD_RETENTION_DAYS", "-1"],
		["DB_STATEMENT_TIMEOUT", "0 seconds"],
		["DB_STATEMENT_TIMEOUT", "500 millis"],
		["DB_STATEMENT_TIMEOUT", "-5 seconds"],
		["DB_STATEMENT_TIMEOUT", "Infinity"],
	] as const) {
		it.effect(`rejects ${name}=${value}`, () =>
			Effect.gen(function* () {
				const error = yield* load({ [name]: value }).pipe(Effect.flip)
				assert.strictEqual(error._tag, "ConfigError")
			}),
		)
	}
})
