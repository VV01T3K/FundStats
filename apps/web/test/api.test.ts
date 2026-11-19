/** The HTTP API against a real Postgres (see @fundstats/db/test/postgres.ts), on data written by hand. */
import { assert, layer } from "@effect/vitest"
import { DataEvents } from "@fundstats/db/DataEvents"
import type { NormalizedRow } from "@fundstats/db/RunStore"
import { RunStore } from "@fundstats/db/RunStore"
import { Store } from "@fundstats/db/Store"
import {
	capturedAt,
	dbConfigOn,
	reset,
	startRun,
	testDatabaseUrl,
	TestStorage,
	writer,
} from "@fundstats/db/test/support"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import { HttpRouter, HttpServer } from "effect/http"
import * as Layer from "effect/Layer"
import { TestClock } from "effect/testing"

import { ApiRoutesLayer } from "#/server/runtime.ts"

const ApiTest = Layer.mergeAll(
	TestStorage,
	DataEvents.layer.pipe(Layer.provide(dbConfigOn(testDatabaseUrl))),
	HttpServer.layerServices,
)

const instrument = (
	externalId: string,
	asOf: string | null,
	metrics: Record<string, number>,
	value: number | null = 1,
): NormalizedRow => ({
	externalId,
	name: externalId,
	symbol: null,
	category: null,
	currency: "PLN",
	metadata: {},
	asOf,
	value,
	metrics,
})

/** Records one successful run of `source` with `rows`, the way the collector does. */
const collected = (source: string, rows: ReadonlyArray<NormalizedRow>, at?: string) =>
	Effect.gen(function* () {
		const runId = yield* startRun(source, "test")
		yield* (yield* writer).persist({ source, runId, capturedAt: capturedAt(at), rows })
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
				coingecko: 6 * 3600,
				coinpaprika: 6 * 3600,
				coinmarketcap: 6 * 3600,
			})
			yield* (yield* RunStore).publishSchedules([
				{ source: "mbank", intervalSeconds: 3600, enabled: true },
				{ source: "coingecko", intervalSeconds: 600, enabled: true },
			])
			assert.deepStrictEqual(intervals((yield* call("/api/v1/sources")).json), {
				mbank: 3600,
				coingecko: 600,
				coinpaprika: 6 * 3600,
				coinmarketcap: 6 * 3600,
			})
			assert.isTrue((yield* call("/api/health")).json.collectorEnabled)
		}),
	)

	it.effect("serves the last points of every listed instrument in one sparkline response", () =>
		Effect.gen(function* () {
			yield* reset
			// Funds by valuation date: a date captured later but older stays in date order.
			yield* collected("mbank", [instrument("f", "2026-11-12", {}, 10), instrument("gone", "2026-11-12", {}, 5)])
			yield* collected("mbank", [instrument("f", "2026-11-14", {}, 12)], "2026-11-16T13:00:00Z")
			yield* collected("mbank", [instrument("f", "2026-11-13", {}, 11)], "2026-11-16T14:00:00Z")
			// Live quotes by capture time; a missing value is no point.
			for (const [hour, value] of [
				[0, 100],
				[6, null],
				[12, 102],
				[18, 103],
			] as const) {
				yield* collected(
					"coingecko",
					[instrument("btc", null, {}, value)],
					`2026-11-16T${String(hour).padStart(2, "0")}:00:00Z`,
				)
			}

			const funds = yield* call("/api/v1/sources/mbank/sparklines")
			assert.strictEqual(funds.status, 200)
			assert.deepStrictEqual(funds.json, {
				source: "mbank",
				points: 24,
				// "gone" left the ranking with the last run, so it has no sparkline either.
				series: [{ externalId: "f", values: [10, 11, 12] }],
			})

			const coins = yield* call("/api/v1/sources/coingecko/sparklines?points=2")
			assert.deepStrictEqual(coins.json.series, [{ externalId: "btc", values: [102, 103] }])

			for (const points of ["1", "201", "x"]) {
				assert.strictEqual((yield* call(`/api/v1/sources/mbank/sparklines?points=${points}`)).status, 400, points)
			}
			assert.strictEqual((yield* call("/api/v1/sources/nope/sparklines")).status, 404)
			assert.deepStrictEqual((yield* call("/api/v1/sources/coinpaprika/sparklines")).json.series, [])
		}),
	)

	it.effect("streams an event naming the source each time a run is stored", () =>
		Effect.gen(function* () {
			yield* reset
			const { handler, dispose } = HttpRouter.toWebHandler(ApiRoutesLayer.pipe(Layer.provide(ApiTest)), {
				disableLogger: true,
			})
			const response = yield* Effect.promise(() => handler(new Request("http://test/api/v1/events")))
			assert.strictEqual(response.status, 200)
			assert.include(response.headers.get("content-type"), "text/event-stream")
			const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()

			yield* collected("coingecko", [instrument("btc", null, {}, 1)])

			let text = ""
			while (!text.includes("\n\n")) {
				const { value, done } = yield* Effect.promise(() => reader.read())
				if (done) break
				text += value
			}
			assert.include(text, 'data: {"source":"coingecko"}')
			// Cancelling the body closes the stream, which unsubscribes it.
			yield* Effect.promise(() => reader.cancel())
			yield* Effect.promise(dispose)
		}),
	)
	it("searches every source's listed instruments by name or ticker, exact tickers first", () =>
		Effect.gen(function* () {
			yield* reset
			const named = (externalId: string, name: string, symbol: string | null) => ({
				...instrument(externalId, null, {}),
				name,
				symbol,
			})
			yield* collected("coingecko", [named("cbbtc", "Coinbase Wrapped BTC", "CBBTC"), named("btc", "Bitcoin", "BTC")])
			yield* collected("mbank", [named("1", "Złoty Obligacji 50%", "0001")])
			yield* collected("coinpaprika", [named("gone", "Old BTC", "OBTC")])
			yield* collected("coinpaprika", [named("eth", "Ethereum", "ETH")])

			const btc = yield* call("/api/v1/search?q=btc")
			assert.strictEqual(btc.status, 200)
			// Exact ticker first; an instrument the source no longer lists is not found.
			assert.deepStrictEqual(
				btc.json.hits.map((hit: { externalId: string }) => hit.externalId),
				["btc", "cbbtc"],
			)
			// Every word must match, Polish letters fold, and % is a literal character.
			const zloty = yield* call("/api/v1/search?q=zloty%20obligacji")
			assert.deepStrictEqual(
				zloty.json.hits.map((hit: { source: string }) => hit.source),
				["mbank"],
			)
			assert.strictEqual((yield* call("/api/v1/search?q=50%25")).json.hits.length, 1)
			assert.strictEqual((yield* call("/api/v1/search?q=5_%25")).json.hits.length, 0)
			assert.strictEqual((yield* call("/api/v1/search?q=")).status, 400)
		}))
})
