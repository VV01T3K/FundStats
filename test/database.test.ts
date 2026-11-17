/**
 * Collector, dedupe rule and HTTP API against a real Postgres (see
 * test/setup/postgres.ts). Upstreams are replaced by an HttpClient that
 * answers with the saved fixtures; nothing here touches the network.
 */
import { assert, layer } from "@effect/vitest"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse, HttpRouter, HttpServer } from "effect/http"
import { inject } from "vitest"
import { Collector } from "#/server/collector/Collector.ts"
import { AppConfig } from "#/server/config.ts"
import { Database } from "#/server/db/Database.ts"
import { Store } from "#/server/db/Store.ts"
import { ApiRoutesLayer } from "#/server/runtime.ts"
import { fixture } from "./fixtures.ts"

const upstream: Record<string, () => unknown> = {
	"www.mbank.pl": () => fixture("mbank-funds.json"),
	"api.coingecko.com": () => fixture("coingecko-markets.json"),
	"api.coinpaprika.com": () => fixture("coinpaprika-tickers.json"),
	"api.coinmarketcap.com": () => fixture("coinmarketcap-web-listing.json"),
}

const FixtureHttpClient = Layer.succeed(
	HttpClient.HttpClient,
	HttpClient.make((request, url) => {
		const body = upstream[url.hostname]
		const response = body
			? new Response(JSON.stringify(body()), { headers: { "content-type": "application/json" } })
			: new Response("not found", { status: 404 })
		return Effect.succeed(HttpClientResponse.fromWeb(request, response))
	}),
)

const ConfigLayer = AppConfig.layer.pipe(
	Layer.provide(
		ConfigProvider.layer(
			ConfigProvider.fromEnvRecord({ DATABASE_URL: inject("databaseUrl"), COLLECTOR_ENABLED: "false" }),
		),
	),
)

const TestServices = Collector.layerNoDeps.pipe(
	Layer.provide(FixtureHttpClient),
	Layer.provideMerge(Store.layer),
	Layer.provideMerge(Database.layer),
	Layer.provideMerge(ConfigLayer),
)

const count = (table: string) =>
	Effect.gen(function* () {
		const { use } = yield* Database
		const result = yield* use("count", (db) =>
			db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table}`)),
		)
		return result.rows[0].n
	})

const reset = Effect.gen(function* () {
	const { use } = yield* Database
	yield* use("reset", (db) =>
		db.execute(sql`truncate snapshots, raw_payloads, instruments, collection_runs restart identity cascade`),
	)
})

layer(TestServices)("collector and storage", (it) => {
	it.effect("stores instruments, snapshots, the raw payload and a run record", () =>
		Effect.gen(function* () {
			yield* reset
			const collector = yield* Collector
			const result = yield* collector.runOnce("mbank", "test")
			assert.deepStrictEqual(result, { instrumentCount: 8, rowsWritten: 8 })
			assert.strictEqual(yield* count("instruments"), 8)
			assert.strictEqual(yield* count("snapshots"), 8)
			assert.strictEqual(yield* count("raw_payloads"), 1)
			const store = yield* Store
			const summary = yield* store.runSummary("mbank")
			assert.strictEqual(summary.lastSuccess?.status, "success")
			assert.strictEqual(summary.lastSuccess?.trigger, "test")
		}),
	)

	it.effect("dedupe: re-collecting the same as_of date does not add rows; a changed value updates in place", () =>
		Effect.gen(function* () {
			yield* reset
			const collector = yield* Collector
			yield* collector.runOnce("mbank", "test")
			const again = yield* collector.runOnce("mbank", "test")
			assert.strictEqual(again.rowsWritten, 0)
			assert.strictEqual(yield* count("snapshots"), 8)

			const original = upstream["www.mbank.pl"]
			upstream["www.mbank.pl"] = () => {
				const funds = fixture("mbank-funds.json") as Array<{ yield1m: number }>
				funds[0].yield1m += 1
				return funds
			}
			try {
				const revised = yield* collector.runOnce("mbank", "test")
				assert.strictEqual(revised.rowsWritten, 1)
				assert.strictEqual(yield* count("snapshots"), 8)
			} finally {
				upstream["www.mbank.pl"] = original
			}
		}),
	)

	it.effect("crypto quotes have no as_of date and get one row per collection", () =>
		Effect.gen(function* () {
			yield* reset
			const collector = yield* Collector
			yield* collector.runOnce("coingecko", "test")
			yield* collector.runOnce("coingecko", "test")
			assert.strictEqual(yield* count("instruments"), 5)
			assert.strictEqual(yield* count("snapshots"), 10)
		}),
	)

	it.effect("a failing source records a failed run and does not touch stored data", () =>
		Effect.gen(function* () {
			yield* reset
			const collector = yield* Collector
			yield* collector.runOnce("coinpaprika", "test")
			const original = upstream["api.coinpaprika.com"]
			upstream["api.coinpaprika.com"] = () => ({ error: "maintenance" })
			try {
				const error = yield* collector.runOnce("coinpaprika", "test").pipe(Effect.flip)
				assert.strictEqual(error._tag, "SourceError")
			} finally {
				upstream["api.coinpaprika.com"] = original
			}
			const store = yield* Store
			const summary = yield* store.runSummary("coinpaprika")
			assert.strictEqual(summary.lastRun?.status, "failed")
			assert.match(summary.lastRun?.error ?? "", /decode/)
			assert.strictEqual((yield* store.latest("coinpaprika")).length, 4, "last good data is still served")
		}),
	)
})

const ApiTest = Layer.mergeAll(TestServices, HttpServer.layerServices)

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
			const collector = yield* Collector
			yield* collector.runOnce("mbank", "test")
			yield* collector.runOnce("coinmarketcap", "test")

			const latest = yield* call("/api/v1/sources/mbank/latest")
			assert.strictEqual(latest.status, 200)
			assert.strictEqual(latest.json.rows.length, 8)
			assert.strictEqual(latest.json.source.id, "mbank")
			assert.isFalse(latest.json.source.stale)
			assert.strictEqual(latest.json.source.lastSuccess.instrumentCount, 8)
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

			assert.strictEqual((yield* call("/api/v1/sources/nope/latest")).status, 404)
			assert.strictEqual((yield* call("/api/v1/sources/mbank/instruments/nope/history")).status, 404)

			const health = yield* call("/api/health")
			assert.deepStrictEqual(health.json, { status: "ok", database: "ok", collectorEnabled: false })

			const openapi = yield* call("/api/openapi.json")
			assert.strictEqual(openapi.status, 200)
			assert.property(openapi.json.paths, "/api/v1/sources/{source}/latest")
		}),
	)
})
