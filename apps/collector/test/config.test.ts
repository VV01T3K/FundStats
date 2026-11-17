import { assert, describe, it } from "@effect/vitest"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import { CollectorConfig } from "#/config.ts"

const load = (env: Record<string, string>) =>
	Effect.service(CollectorConfig).pipe(
		Effect.provide(CollectorConfig.layer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))))),
	)

describe("config validation", () => {
	it.effect.each(["0 seconds", "-5 minutes", "Infinity", "30 seconds"])(
		"rejects COLLECTOR_INTERVAL_MBANK=%s",
		(value) =>
			Effect.gen(function* () {
				const error = yield* load({ COLLECTOR_INTERVAL_MBANK: value }).pipe(Effect.flip)
				assert.strictEqual(error._tag, "ConfigError")
			}),
	)

	it.effect("accepts an interval of one minute or more", () =>
		Effect.gen(function* () {
			const config = yield* load({ COLLECTOR_INTERVAL_MBANK: "1 minute", COLLECTOR_INTERVAL_COINGECKO: "2 hours" })
			assert.strictEqual(
				Duration.toMillis(config.intervalOverride("mbank").pipe((o) => (o._tag === "Some" ? o.value : Duration.zero))),
				60_000,
			)
		}),
	)

	it.effect("treats an empty interval as unset, as compose.yaml passes it", () =>
		Effect.gen(function* () {
			const config = yield* load({ COLLECTOR_INTERVAL_MBANK: "" })
			assert.strictEqual(config.intervalOverride("mbank")._tag, "None")
		}),
	)

	it.effect.each([
		["RAW_PAYLOAD_RETENTION_DAYS", "0"],
		["RAW_PAYLOAD_RETENTION_DAYS", "-1"],
	] as const)("rejects %s=%s", ([name, value]) =>
		Effect.gen(function* () {
			const error = yield* load({ [name]: value }).pipe(Effect.flip)
			assert.strictEqual(error._tag, "ConfigError")
		}),
	)
})
