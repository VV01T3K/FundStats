/**
 * Collector, dedupe rule and HTTP API against a real Postgres (see
 * test/setup/postgres.ts). Upstreams are replaced by an HttpClient that
 * answers with the saved fixtures; nothing here touches the network.
 */
import { assert, layer } from "@effect/vitest"
import { sql } from "drizzle-orm"
import { ConfigProvider, Effect, Fiber, Layer } from "effect"
import { HttpClient, HttpClientResponse, HttpRouter, HttpServer } from "effect/http"
import { TestClock } from "effect/testing"
import pg from "pg"
import { inject } from "vitest"
import { Collector } from "#/server/collector/Collector.ts"
import { AppConfig } from "#/server/config.ts"
import { Database } from "#/server/db/Database.ts"
import { Store } from "#/server/db/Store.ts"
import { ApiRoutesLayer } from "#/server/runtime.ts"
import type { NormalizedRow } from "#/server/sources/Source.ts"
import { fixture } from "./fixtures.ts"

/** Returned by an upstream stub: send headers, then never finish the body. */
const STALL = Symbol("stall")
let requests = 0

const upstream: Record<string, () => unknown> = {
	"www.mbank.pl": () => fixture("mbank-funds.json"),
	"api.coingecko.com": () => fixture("coingecko-markets.json"),
	"api.coinpaprika.com": () => fixture("coinpaprika-tickers.json"),
	"api.coinmarketcap.com": () => fixture("coinmarketcap-web-listing.json"),
}

const FixtureHttpClient = Layer.succeed(
	HttpClient.HttpClient,
	HttpClient.make((request, url) => {
		requests++
		const headers = { "content-type": "application/json" }
		const respond = (body: unknown) =>
			HttpClientResponse.fromWeb(
				request,
				body === undefined
					? new Response("not found", { status: 404 })
					: body === STALL
						? new Response(new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode("[")) }), { headers })
						: new Response(JSON.stringify(body), { headers }),
			)
		const body = upstream[url.hostname]?.()
		// A promise is an upstream that answers once the test resolves it.
		return body instanceof Promise
			? Effect.promise(() => body).pipe(Effect.map(respond))
			: Effect.succeed(respond(body))
	}),
)

const ConfigLayer = AppConfig.layer.pipe(
	Layer.provide(
		ConfigProvider.layer(
			// One pooled connection: a collection must not need a second pool slot
			// while it holds its source lock, or it would deadlock.
			ConfigProvider.fromEnvRecord({
				DATABASE_URL: inject("databaseUrl"),
				COLLECTOR_ENABLED: "false",
				DB_POOL_MAX: "1",
			}),
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

/**
 * Holds `source`'s collection lock from a separate Postgres session, the way
 * a `bun run collect` in another process would.
 */
const holdLockElsewhere = (source: string) =>
	Effect.acquireRelease(
		Effect.promise(async () => {
			const client = new pg.Client({ connectionString: inject("databaseUrl") })
			await client.connect()
			await client.query("select pg_advisory_lock(727002, hashtext($1))", [source])
			return client
		}),
		(client) => Effect.promise(() => client.end()),
	)

/** Run writes on the pool, outside any source lock, for tests that set up runs by hand. */
const writer = Effect.gen(function* () {
	return (yield* Store).writer(yield* Database)
})

/** Real time; the tests run on TestClock, which Effect.sleep would wait for. */
const sleepReal = (ms: number) => Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))

/** Polls `check` in real time until it holds; fails the test after `ms`. */
const waitFor = <E, R>(what: string, check: Effect.Effect<boolean, E, R>, ms = 5_000) =>
	Effect.gen(function* () {
		for (let waited = 0; waited < ms; waited += 25) {
			if (yield* check) return
			yield* sleepReal(25)
		}
		assert.fail(`timed out waiting for ${what}`)
	})

/** One query on a fresh connection of its own, like another process would make. */
const queryElsewhere = <T extends pg.QueryResultRow>(text: string, values: ReadonlyArray<unknown> = []) =>
	Effect.promise(async () => {
		const client = new pg.Client({ connectionString: inject("databaseUrl") })
		await client.connect()
		try {
			return (await client.query<T>(text, [...values])).rows
		} finally {
			await client.end()
		}
	})

const SOURCE_LOCK_HOLDERS = "select pid from pg_locks where locktype = 'advisory' and classid = 727002 and granted"

/** Kills the Postgres sessions holding a collection lock and waits until they are gone. */
const terminateLockHolders = queryElsewhere<{ ok: boolean }>(
	`select pg_terminate_backend(pid, 5000) as ok from (${SOURCE_LOCK_HOLDERS}) holders`,
)

/** An upstream response the test releases by hand. */
const gate = () => {
	let open!: () => void
	const opened = new Promise<void>((resolve) => {
		open = resolve
	})
	return { open, after: <A>(value: () => A) => opened.then(value) }
}

const row = (externalId: string, asOf: string | null, value: number): NormalizedRow => ({
	externalId,
	name: externalId,
	symbol: null,
	category: null,
	currency: "PLN",
	metadata: {},
	asOf,
	value,
	metrics: {},
})

const runStatus = (id: number) =>
	Effect.gen(function* () {
		const { use } = yield* Database
		const result = yield* use("runStatus", (db) =>
			db.execute<{ status: string; error: string | null }>(
				sql`select status, error from collection_runs where id = ${id}`,
			),
		)
		return result.rows[0]
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
			// The response that failed to decode is kept for diagnosis and replay.
			const { use } = yield* Database
			const kept = yield* use("rawOfFailedRun", (db) =>
				db.execute<{ payload: unknown }>(sql`select payload from raw_payloads where run_id = ${summary.lastRun?.id}`),
			)
			assert.deepStrictEqual(kept.rows[0]?.payload, { error: "maintenance" })
			assert.strictEqual((yield* store.latest("coinpaprika")).length, 4, "last good data is still served")
		}),
	)
})

layer(TestServices)("concurrent and stalled collections", (it) => {
	it.effect("a collection skips with SourceBusy while another process holds the source lock", () =>
		Effect.gen(function* () {
			yield* reset
			const collector = yield* Collector
			const error = yield* Effect.scoped(
				Effect.gen(function* () {
					yield* holdLockElsewhere("mbank")
					return yield* collector.runOnce("mbank", "test").pipe(Effect.flip)
				}),
			)
			assert.strictEqual(error._tag, "SourceBusy")
			assert.strictEqual(yield* count("collection_runs"), 0, "a skipped run records nothing")
			// Other sources are not blocked, and the lock is free again afterwards.
			yield* collector.runOnce("coingecko", "test")
			assert.strictEqual((yield* collector.runOnce("mbank", "test")).instrumentCount, 8)
		}),
	)

	it.effect("an older run that finishes after a newer one does not empty the latest view", () =>
		Effect.gen(function* () {
			yield* reset
			const store = yield* Store
			const older = yield* (yield* writer).startRun("coingecko", "test")
			const newer = yield* (yield* writer).startRun("coingecko", "test")
			const rows = [row("a", null, 1), row("b", null, 2)]
			yield* (yield* writer).persist({
				source: "coingecko",
				kind: "crypto",
				runId: newer,
				capturedAt: new Date(),
				rows,
			})
			yield* (yield* writer).persist({
				source: "coingecko",
				kind: "crypto",
				runId: older,
				capturedAt: new Date(),
				rows,
			})
			assert.strictEqual((yield* store.latest("coingecko")).length, 2)
		}),
	)

	it.effect("latest shows the newest valuation date even when an older date was captured later", () =>
		Effect.gen(function* () {
			yield* reset
			const store = yield* Store
			const first = yield* (yield* writer).startRun("mbank", "test")
			yield* (yield* writer).persist({
				source: "mbank",
				kind: "fund",
				runId: first,
				capturedAt: new Date("2026-11-16T12:00:00Z"),
				rows: [row("f", "2026-11-16", 10)],
			})
			const second = yield* (yield* writer).startRun("mbank", "test")
			yield* (yield* writer).persist({
				source: "mbank",
				kind: "fund",
				runId: second,
				capturedAt: new Date("2026-11-17T12:00:00Z"),
				rows: [row("f", "2026-11-13", 9)],
			})
			const [latest] = yield* store.latest("mbank")
			assert.strictEqual(latest.asOf, "2026-11-16")
			assert.strictEqual(latest.value, 10)
		}),
	)

	it.effect("a body that stalls after the headers times out, is retried, and fails the run", () =>
		Effect.gen(function* () {
			yield* reset
			const collector = yield* Collector
			const original = upstream["api.coingecko.com"]
			upstream["api.coingecko.com"] = () => STALL
			requests = 0
			const fiber = yield* collector.runOnce("coingecko", "test").pipe(Effect.flip, Effect.forkChild)
			try {
				// Database calls take real time, so advance the test clock in steps.
				for (let i = 0; i < 100 && fiber.pollUnsafe() === undefined; i++) {
					yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 20)))
					yield* TestClock.adjust("30 seconds")
				}
				assert.isDefined(fiber.pollUnsafe(), "the run must end instead of hanging")
				const error = yield* Fiber.join(fiber)
				assert.strictEqual(error._tag, "SourceError")
				assert.strictEqual((error as { reason?: string }).reason, "timeout")
				assert.strictEqual(requests, 4, "one attempt plus three retries")
				const store = yield* Store
				assert.strictEqual((yield* store.runSummary("coingecko")).lastRun?.status, "failed")
			} finally {
				upstream["api.coingecko.com"] = original
				yield* Fiber.interrupt(fiber)
			}
		}),
	)

	it.effect("startup recovery closes only abandoned runs; a live run elsewhere is left alone", () =>
		Effect.gen(function* () {
			yield* reset
			const store = yield* Store
			const abandoned = yield* (yield* writer).startRun("mbank", "cli")
			const live = yield* (yield* writer).startRun("coinpaprika", "cli")
			const closed = yield* Effect.scoped(
				Effect.gen(function* () {
					yield* holdLockElsewhere("coinpaprika")
					return yield* store.closeInterruptedRuns
				}),
			)
			assert.strictEqual(closed, 1)
			assert.strictEqual((yield* runStatus(abandoned)).status, "failed")
			assert.strictEqual((yield* runStatus(live)).status, "running")
		}),
	)

	it.effect("a run that succeeds clears an earlier error", () =>
		Effect.gen(function* () {
			yield* reset
			const store = yield* Store
			const runId = yield* (yield* writer).startRun("coingecko", "cli")
			yield* store.failRun(runId, "Interrupted (app stopped during the run)")
			yield* (yield* writer).persist({
				source: "coingecko",
				kind: "crypto",
				runId,
				capturedAt: new Date(),
				rows: [row("a", null, 1)],
			})
			assert.deepStrictEqual(yield* runStatus(runId), { status: "success", error: null })
		}),
	)
})

layer(TestServices)("losing the lock or the fiber mid-run", (it) => {
	it.effect("losing the lock connection stops the run, records it failed, and writes nothing more", () =>
		Effect.gen(function* () {
			yield* reset
			const collector = yield* Collector
			const original = upstream["api.coingecko.com"]
			const upstreamGate = gate()
			upstream["api.coingecko.com"] = () => upstreamGate.after(() => fixture("coingecko-markets.json"))
			try {
				const fiber = yield* collector.runOnce("coingecko", "test").pipe(Effect.flip, Effect.forkChild)
				yield* waitFor(
					"the run to hold its lock",
					queryElsewhere(SOURCE_LOCK_HOLDERS).pipe(Effect.map((rows) => rows.length === 1)),
				)
				// The run waits on its upstream; its lock connection is killed meanwhile.
				yield* terminateLockHolders
				yield* waitFor(
					"the run to stop",
					Effect.sync(() => fiber.pollUnsafe() !== undefined),
				)
				const error = yield* Fiber.join(fiber)
				assert.match(error.message, /Lost the collection lock of coingecko/)
				const [run] = yield* queryElsewhere<{ id: number; status: string; error: string }>(
					"select id, status, error from collection_runs",
				)
				assert.strictEqual(run.status, "failed")
				assert.match(run.error, /Lost the collection lock/)
				// Had the run kept going after its upstream answered, it would write now.
				upstreamGate.open()
				yield* sleepReal(200)
				assert.strictEqual(yield* count("raw_payloads"), 0)
				assert.strictEqual(yield* count("snapshots"), 0)
				// The next run takes the freed lock and serves its data.
				upstream["api.coingecko.com"] = original
				yield* collector.runOnce("coingecko", "test")
				assert.strictEqual((yield* (yield* Store).latest("coingecko")).length, 5)
			} finally {
				upstream["api.coingecko.com"] = original
			}
		}),
	)

	it.effect("a run writes through the session that holds its lock", () =>
		Effect.gen(function* () {
			const database = yield* Database
			const { writer: writerPid, holders } = yield* database.withSourceLock("coingecko", (lock) =>
				Effect.gen(function* () {
					const result = yield* lock.use("pid", (db) =>
						db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`),
					)
					return { writer: result.rows[0].pid, holders: yield* queryElsewhere<{ pid: number }>(SOURCE_LOCK_HOLDERS) }
				}),
			)
			// So when Postgres frees the lock (that session ended), the run's writes cannot land either.
			assert.deepStrictEqual(
				holders.map((h) => h.pid),
				[writerPid],
			)
		}),
	)

	it.effect("once the lock connection is gone, writes through it fail even before the run notices", () =>
		Effect.gen(function* () {
			yield* reset
			const database = yield* Database
			const error = yield* Effect.scoped(
				database.withSourceLock("coingecko", (lock) =>
					Effect.gen(function* () {
						yield* terminateLockHolders
						// Postgres has freed the lock: another session takes it right away.
						yield* holdLockElsewhere("coingecko")
						yield* lock.use("write", (db) =>
							db.execute(
								sql`insert into collection_runs (source, trigger, status) values ('coingecko', 'test', 'running')`,
							),
						)
					}),
				),
			).pipe(Effect.flip)
			assert.strictEqual(error._tag, "DatabaseError")
			assert.strictEqual(yield* count("collection_runs"), 0, "no write may land while another session holds the lock")
		}),
	)

	it.effect("an interrupted transaction is rolled back, and the interruption waits for it", () =>
		Effect.gen(function* () {
			yield* reset
			const database = yield* Database
			const statements = gate()
			let finished = false
			const fiber = yield* database
				.transaction("slow", async (tx) => {
					await tx.execute(
						sql`insert into collection_runs (source, trigger, status) values ('mbank', 'test', 'running')`,
					)
					await statements.after(() => undefined)
				})
				.pipe(Effect.forkChild)
			yield* sleepReal(100)
			const interrupter = yield* Fiber.interrupt(fiber).pipe(
				Effect.tap(() => Effect.sync(() => (finished = true))),
				Effect.forkChild,
			)
			yield* sleepReal(100)
			assert.isFalse(finished, "the interruption must wait for the transaction")
			statements.open()
			yield* Fiber.join(interrupter)
			assert.strictEqual(yield* count("collection_runs"), 0)
		}),
	)

	it.effect("interrupting a run during persist leaves the last good data served and the run status true", () =>
		Effect.gen(function* () {
			yield* reset
			const collector = yield* Collector
			const store = yield* Store
			yield* collector.runOnce("coingecko", "test")
			assert.strictEqual((yield* store.latest("coingecko")).length, 5)

			// Another session blocks snapshot inserts, so the next persist hangs mid-transaction.
			const blocker = new pg.Client({ connectionString: inject("databaseUrl") })
			yield* Effect.promise(async () => {
				await blocker.connect()
				await blocker.query("begin")
				await blocker.query("lock table snapshots in share mode")
			})
			try {
				const fiber = yield* collector.runOnce("coingecko", "test").pipe(Effect.forkChild)
				yield* waitFor(
					"persist to wait on the snapshot lock",
					queryElsewhere(
						"select 1 from pg_stat_activity where wait_event_type = 'Lock' and query ilike 'insert into \"snapshots\"%'",
					).pipe(Effect.map((rows) => rows.length > 0)),
				)
				const interrupter = yield* Fiber.interrupt(fiber).pipe(Effect.forkChild)
				yield* sleepReal(100)
				yield* Effect.promise(() => blocker.query("commit"))
				yield* Fiber.join(interrupter)
			} finally {
				yield* Effect.promise(() => blocker.end())
			}

			const runs = yield* queryElsewhere<{ id: number; status: string; snapshots: number }>(
				"select r.id, r.status, (select count(*)::int from snapshots s where s.run_id = r.id) as snapshots from collection_runs r order by r.id",
			)
			assert.strictEqual(runs.length, 2)
			// Interrupted before its commit: rolled back and recorded as failed, so
			// the status matches what was committed (nothing).
			assert.deepStrictEqual(runs[1], { id: runs[1].id, status: "failed", snapshots: 0 })
			assert.strictEqual((yield* store.latest("coingecko")).length, 5, "latest must keep serving data")
		}),
	)

	it.effect("recording a failure after a run committed keeps the run successful", () =>
		Effect.gen(function* () {
			yield* reset
			const store = yield* Store
			const runId = yield* (yield* writer).startRun("coingecko", "test")
			yield* (yield* writer).persist({
				source: "coingecko",
				kind: "crypto",
				runId,
				capturedAt: new Date(),
				rows: [row("a", null, 1)],
			})
			yield* store.failRun(runId, "Interrupted")
			assert.deepStrictEqual(yield* runStatus(runId), { status: "success", error: null })
			assert.strictEqual((yield* store.latest("coingecko")).length, 1)
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
