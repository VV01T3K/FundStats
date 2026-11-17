/** The HTTP API against a real Postgres (see @fundstats/db/test/postgres.ts), on data written by hand. */
import { assert, layer } from "@effect/vitest"
import type { NormalizedRow } from "@fundstats/db/RunStore"
import { RunStore } from "@fundstats/db/RunStore"
import { Store } from "@fundstats/db/Store"
import { capturedAt, reset, startRun, TestStorage, writer } from "@fundstats/db/test/support"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import { HttpRouter, HttpServer } from "effect/http"
import * as Layer from "effect/Layer"
import { TestClock } from "effect/testing"

import { ApiRoutesLayer } from "#/server/runtime.ts"

const ApiTest = Layer.mergeAll(TestStorage, HttpServer.layerServices)

const instrument = (externalId: string, asOf: string | null, metrics: Record<string, number>): NormalizedRow => ({
	externalId,
	name: externalId,
	symbol: null,
	category: null,
	currency: "PLN",
	metadata: {},
	asOf,
	value: 1,
	metrics,
})

/** Records one successful run of `source` with `rows`, the way the collector does. */
const collected = (source: string, rows: ReadonlyArray<NormalizedRow>) =>
	Effect.gen(function* () {
		const runId = yield* startRun(source, "test")
		yield* (yield* writer).persist({ source, runId, capturedAt: capturedAt(), rows })
	})

layer(ApiTest)("HTTP API", (it) => {
	const call = (path: string) =>
		Effect.gen(function* () {
			const { handler, dispose } = HttpRouter.toWebHandler(ApiRoutesLayer.pipe(Layer.provide(ApiTest)), {
				disableLogger: true,
			})
			const response = yield* Effect.promise(() => handler(new Request(`http://test${path}`)))
			const body = yield* Effect.promise(() => response.text())
			yield* Effect.promise(dispose)
			return { status: response.status, json: body ? JSON.parse(body) : null }
		})

	it.effect("serves the latest snapshot, source list, history and health from the database", () =>
		Effect.gen(function* () {
			yield* reset
			yield* collected("mbank", [
				instrument("a", "2026-11-16", { change_1m: 1.5 }),
				instrument("b", "2026-11-16", { change_1m: -2 }),
				instrument("c", "2026-11-16", { change_1m: 0.5 }),
			])
			yield* collected("coinmarketcap", [
				instrument("x", null, { rank: 3 }),
				instrument("y", null, { rank: 1 }),
				instrument("z", null, { rank: 4 }),
				instrument("w", null, { rank: 2 }),
			])
			// The clock reads the moment mbank was collected, so it is fresh.
			const { lastSuccess } = yield* (yield* Store).runSummary("mbank")
			assert.isNotNull(lastSuccess)
			yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(lastSuccess.startedAt)))

			const latest = yield* call("/api/v1/sources/mbank/latest")
			assert.strictEqual(latest.status, 200)
			assert.strictEqual(latest.json.rows.length, 3)
			assert.strictEqual(latest.json.source.id, "mbank")
			assert.isFalse(latest.json.source.stale)
			assert.strictEqual(latest.json.source.lastSuccess.instrumentCount, 3)
			assert.isNumber(latest.json.rows[0].metrics.change_1m)

			const cmc = yield* call("/api/v1/sources/coinmarketcap/latest")
			assert.deepStrictEqual(
				cmc.json.rows.map((r: { metrics: { rank: number } }) => r.metrics.rank),
				[1, 2, 3, 4],
				"ordered by rank",
			)

			const list = yield* call("/api/v1/sources")
			assert.strictEqual(list.status, 200)
			assert.deepStrictEqual(
				list.json.map((s: { id: string }) => s.id),
				["mbank", "coingecko", "coinpaprika", "coinmarketcap"],
			)
			const never = list.json.find((s: { id: string }) => s.id === "coingecko")
			assert.isNull(never.lastSuccess)
			assert.isTrue(never.stale)

			const externalId = latest.json.rows[0].externalId
			const history = yield* call(`/api/v1/sources/mbank/instruments/${externalId}/history?limit=10`)
			assert.strictEqual(history.status, 200)
			assert.strictEqual(history.json.points.length, 1)
			for (const limit of ["0", "5001", "ten"]) {
				const rejected = yield* call(`/api/v1/sources/mbank/instruments/${externalId}/history?limit=${limit}`)
				assert.strictEqual(rejected.status, 400, `limit=${limit}`)
			}

			assert.strictEqual((yield* call("/api/v1/sources/nope/latest")).status, 404)
			assert.strictEqual((yield* call("/api/v1/sources/mbank/instruments/nope/history")).status, 404)

			const health = yield* call("/api/health")
			assert.deepStrictEqual(health.json, { status: "ok", database: "ok", collectorEnabled: false })

			const openapi = yield* call("/api/openapi.json")
			assert.strictEqual(openapi.status, 200)
			assert.property(openapi.json.paths, "/api/v1/sources/{source}/latest")
		}),
	)

	it.effect("reports the intervals and collector state the collector recorded, defaults before that", () =>
		Effect.gen(function* () {
			yield* reset
			const intervals = (json: ReadonlyArray<{ id: string; intervalSeconds: number }>) =>
				Object.fromEntries(json.map((s) => [s.id, s.intervalSeconds]))
			assert.deepStrictEqual(intervals((yield* call("/api/v1/sources")).json), {
				mbank: 6 * 3600,
				coingecko: 1800,
				coinpaprika: 1800,
				coinmarketcap: 1800,
			})
			yield* (yield* RunStore).publishSchedules([
				{ source: "mbank", intervalSeconds: 3600, enabled: true },
				{ source: "coingecko", intervalSeconds: 600, enabled: true },
			])
			assert.deepStrictEqual(intervals((yield* call("/api/v1/sources")).json), {
				mbank: 3600,
				coingecko: 600,
				coinpaprika: 1800,
				coinmarketcap: 1800,
			})
			assert.isTrue((yield* call("/api/health")).json.collectorEnabled)
		}),
	)
})
