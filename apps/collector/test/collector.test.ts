/**
 * Collection runs end to end against a real Postgres (see @fundstats/db/test/postgres.ts). Upstreams are
 * replaced by an HttpClient that answers with the saved fixtures; nothing here touches the network.
 */
import { assert, layer } from "@effect/vitest"
import { SourceLocks } from "@fundstats/db/SourceLocks"
import { Store } from "@fundstats/db/Store"
import {
	at,
	count,
	dbConfigOn,
	gate,
	queryElsewhere,
	replyLosingProxy,
	requestInterrupt,
	reset,
	SOURCE_LOCK_HOLDERS,
	storageOn,
	testDatabaseUrl,
	terminateLockHolders,
	waitForBlockedInsert,
	withInsertsBlocked,
	holdLockElsewhere,
	idleSessionTimeoutOf,
} from "@fundstats/db/test/support"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import { HttpClient, HttpClientResponse } from "effect/http"
import * as Layer from "effect/Layer"
import { TestClock } from "effect/testing"

import { Collector } from "#/Collector.ts"
import { CollectorConfig } from "#/config.ts"
import { CollectorScheduler } from "#/Scheduler.ts"

import { fixture } from "./fixtures.ts"

/** Returned by an upstream stub: send headers, then never finish the body. */
const STALL = Symbol("stall")
let requests = 0

const upstream = {
	"www.mbank.pl": (): unknown => fixture("mbank-funds.json"),
	"api.coingecko.com": (): unknown => fixture("coingecko-markets.json"),
	"api.coinpaprika.com": (): unknown => fixture("coinpaprika-tickers.json"),
	"api.coinmarketcap.com": (): unknown => fixture("coinmarketcap-web-listing.json"),
}

const isUpstreamHost = (hostname: string): hostname is keyof typeof upstream => Object.hasOwn(upstream, hostname)

const FixtureHttpClient = Layer.succeed(
	HttpClient.HttpClient,
	HttpClient.make((request, url) => {
		requests++
		const headers = { "content-type": "application/json" }
		const respond = (body: unknown) =>
			HttpClientResponse.fromWeb(
				request,
				body instanceof Response
					? body
					: body === undefined
						? new Response("not found", { status: 404 })
						: body === STALL
							? new Response(new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode("[")) }), {
									headers,
								})
							: new Response(JSON.stringify(body), { headers }),
			)
		const body = isUpstreamHost(url.hostname) ? upstream[url.hostname]() : undefined
		// A promise is an upstream that answers once the test resolves it.
		return body instanceof Promise
			? Effect.promise(() => body).pipe(Effect.map(respond))
			: Effect.succeed(respond(body))
	}),
)

const collectorConfig = (env: Record<string, string> = {}) =>
	CollectorConfig.layer.pipe(
		Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord({ COLLECTOR_ENABLED: "false", ...env }))),
	)

const collectorOn = (url: string, env: Record<string, string> = {}) =>
	Collector.layerNoDeps.pipe(
		Layer.provide(FixtureHttpClient),
		Layer.provideMerge(storageOn(dbConfigOn(url, env))),
		Layer.provideMerge(collectorConfig()),
	)

const TestServices = collectorOn(testDatabaseUrl)

/** The collector's services on `url` with a 1 second statement timeout, fresh so the shared ones are not reused. */
const servicesWithShortTimeout = (url: string) => Layer.fresh(collectorOn(url, { DB_STATEMENT_TIMEOUT: "1 second" }))

/** Each run's lock session idle_session_timeout in ms, read through the session itself. */
const lockIdleTimeouts: Array<number> = []

const RecordingSourceLocks = Layer.effect(
	SourceLocks,
	Effect.gen(function* () {
		const locks = yield* SourceLocks
		return SourceLocks.of({
			withSourceLock: (source, f, options) =>
				locks.withSourceLock(
					source,
					(lock) =>
						idleSessionTimeoutOf(lock).pipe(
							Effect.tap((ms) => Effect.sync(() => lockIdleTimeouts.push(ms))),
							Effect.andThen(f(lock)),
						),
					options,
				),
		})
	}),
)

layer(TestServices)("collector and storage", (it) => {
	it.effect("stores instruments, snapshots and a run record, and no raw payload for a successful run", () =>
		Effect.gen(function* () {
			yield* reset
			const collector = yield* Collector
			const result = yield* collector.runOnce("mbank", "test")
			assert.deepStrictEqual(result, { instrumentCount: 8, rowsWritten: 8 })
			assert.strictEqual(yield* count("instruments"), 8)
			assert.strictEqual(yield* count("snapshots"), 8)
			assert.strictEqual(yield* count("raw_payloads"), 0)
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
				at(funds, 0).yield1m += 1
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

	it.effect("crypto quotes have no as_of date and get a row per collection that changed the quote", () =>
		Effect.gen(function* () {
			yield* reset
			const collector = yield* Collector
			yield* collector.runOnce("coingecko", "test")
			const unchanged = yield* collector.runOnce("coingecko", "test")
			assert.strictEqual(unchanged.rowsWritten, 0)
			assert.strictEqual(yield* count("instruments"), 5)
			assert.strictEqual(yield* count("snapshots"), 5)

			const original = upstream["api.coingecko.com"]
			upstream["api.coingecko.com"] = () => {
				const coins = fixture("coingecko-markets.json") as Array<{ current_price: number }>
				at(coins, 0).current_price += 1
				return coins
			}
			try {
				const moved = yield* collector.runOnce("coingecko", "test")
				assert.strictEqual(moved.rowsWritten, 1)
				assert.strictEqual(yield* count("snapshots"), 6)
			} finally {
				upstream["api.coingecko.com"] = original
			}
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
			const kept = yield* queryElsewhere<{ payload: unknown }>("select payload from raw_payloads where run_id = $1", [
				summary.lastRun?.id,
			])
			assert.deepStrictEqual(kept[0]?.payload, { error: "maintenance" })
			assert.strictEqual((yield* store.latest("coinpaprika")).length, 4, "last good data is still served")
		}),
	)

	it.effect("an upstream that lists an instrument twice fails the run and keeps its response", () =>
		Effect.gen(function* () {
			yield* reset
			const collector = yield* Collector
			const original = upstream["api.coingecko.com"]
			upstream["api.coingecko.com"] = () => {
				const coins = fixture("coingecko-markets.json") as Array<unknown>
				return [...coins, at(coins, 0)]
			}
			try {
				const error = yield* collector.runOnce("coingecko", "test").pipe(Effect.flip)
				assert.strictEqual(error._tag, "SourceError")
				assert.match(error.message, /listed instrument bitcoin more than once/)
			} finally {
				upstream["api.coingecko.com"] = original
			}
			assert.strictEqual((yield* (yield* Store).runSummary("coingecko")).lastRun?.status, "failed")
			assert.strictEqual(yield* count("raw_payloads"), 1)
			assert.strictEqual(yield* count("instruments"), 0)
		}),
	)

	it.effect("on start it records each source's schedule for the web app, even when disabled", () =>
		Effect.gen(function* () {
			yield* reset
			yield* Layer.build(CollectorScheduler).pipe(Effect.scoped)
			const schedules = yield* (yield* Store).schedules
			assert.deepStrictEqual(
				schedules.map((s) => [s.source, s.intervalSeconds, s.enabled]),
				[
					["mbank", 6 * 3600, false],
					["coingecko", 6 * 3600, false],
					["coinpaprika", 6 * 3600, false],
					["coinmarketcap", 6 * 3600, false],
				],
			)
			assert.strictEqual(yield* count("collection_runs"), 0, "a disabled collector collects nothing")
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

	it.effect("a body that stalls after the headers times out, is retried, and fails the run", () =>
		Effect.gen(function* () {
			yield* reset
			const collector = yield* Collector
			const original = upstream["api.coingecko.com"]
			const requested = yield* Deferred.make<void>()
			upstream["api.coingecko.com"] = () => {
				Deferred.doneUnsafe(requested, Exit.void)
				return STALL
			}
			requests = 0
			const fiber = yield* collector.runOnce("coingecko", "test").pipe(Effect.flip, Effect.forkChild)
			try {
				// The run's database work is done once it asks its upstream; from then on only the clock drives it.
				yield* Deferred.await(requested)
				// Four 30 second attempts and the backoff between them.
				yield* TestClock.adjust("5 minutes")
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

	it.effect("a fetch still waiting at FETCH_TIMEOUT (Retry-After included) fails the run as a timeout", () =>
		Effect.gen(function* () {
			yield* reset
			const collector = yield* Collector
			const original = upstream["api.coingecko.com"]
			const requested = yield* Deferred.make<void>()
			upstream["api.coingecko.com"] = () => {
				Deferred.doneUnsafe(requested, Exit.void)
				return new Response("slow down", { status: 429, headers: { "retry-after": "3600" } })
			}
			const fiber = yield* collector.runOnce("coingecko", "test").pipe(Effect.flip, Effect.forkChild)
			try {
				yield* Deferred.await(requested)
				yield* TestClock.adjust("5 minutes")
				const error = yield* Fiber.join(fiber)
				assert.strictEqual(error._tag, "SourceError")
				assert.strictEqual((error as { reason?: string }).reason, "timeout")
				assert.match(error.message, /FETCH_TIMEOUT \(5m\)/)
				const store = yield* Store
				assert.strictEqual((yield* store.runSummary("coingecko")).lastRun?.status, "failed")
			} finally {
				upstream["api.coingecko.com"] = original
				yield* Fiber.interrupt(fiber)
			}
		}),
	)

	it.effect("Postgres keeps a run's idle lock session for longer than its whole fetch phase", () =>
		Effect.gen(function* () {
			yield* reset
			lockIdleTimeouts.length = 0
			yield* Effect.gen(function* () {
				yield* (yield* Collector).runOnce("coingecko", "test")
			}).pipe(
				Effect.provide(
					Layer.fresh(
						Collector.layerNoDeps.pipe(
							Layer.provide(RecordingSourceLocks),
							Layer.provide(FixtureHttpClient),
							Layer.provideMerge(storageOn(dbConfigOn(testDatabaseUrl))),
							Layer.provideMerge(collectorConfig({ FETCH_TIMEOUT: "10 minutes" })),
						),
					),
				),
			)
			assert.lengthOf(lockIdleTimeouts, 1)
			assert.isAbove(at(lockIdleTimeouts, 0), Duration.toMillis(Duration.minutes(10)))
		}),
	)
})

layer(TestServices)("losing the lock or the fiber mid-run", (it) => {
	it.effect(
		"losing the lock connection fails the run at its next write: nothing more is written, it is recorded failed",
		() =>
			Effect.gen(function* () {
				yield* reset
				const collector = yield* Collector
				const original = upstream["api.coingecko.com"]
				const upstreamGate = gate()
				const requested = yield* Deferred.make<void>()
				upstream["api.coingecko.com"] = () => {
					Deferred.doneUnsafe(requested, Exit.void)
					return upstreamGate.after(() => fixture("coingecko-markets.json"))
				}
				try {
					const fiber = yield* collector.runOnce("coingecko", "test").pipe(Effect.flip, Effect.forkChild)
					// A run asks its upstream only once it holds its lock and has created its run row.
					yield* Deferred.await(requested)
					assert.lengthOf(yield* queryElsewhere(SOURCE_LOCK_HOLDERS), 1)
					const error = yield* Effect.scoped(
						Effect.gen(function* () {
							// The run waits on its upstream; its lock connection is killed meanwhile, and
							// another session takes the freed lock, as a second collector would.
							yield* terminateLockHolders
							yield* holdLockElsewhere("coingecko")
							upstreamGate.open()
							return yield* Fiber.join(fiber)
						}),
					)
					// Its next write is persist's BEGIN on the lost session.
					assert.strictEqual(error._tag, "SqlError")
					const runs = yield* queryElsewhere<{ status: string }>("select status from collection_runs")
					assert.deepStrictEqual(runs, [{ status: "failed" }])
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

	it.effect("interrupting a run during persist leaves the last good data served and the run status true", () =>
		Effect.gen(function* () {
			yield* reset
			const collector = yield* Collector
			const store = yield* Store
			yield* collector.runOnce("coingecko", "test")
			assert.strictEqual((yield* store.latest("coingecko")).length, 5)

			// Another session blocks snapshot inserts, so the next persist hangs mid-transaction.
			yield* withInsertsBlocked(
				"snapshots",
				Effect.gen(function* () {
					const fiber = yield* collector.runOnce("coingecko", "test").pipe(Effect.forkChild)
					yield* waitForBlockedInsert("snapshots")
					yield* requestInterrupt(fiber)
					return fiber
				}),
			).pipe(Effect.flatMap(Fiber.await))

			const runs = yield* queryElsewhere<{ id: number; status: string; snapshots: number }>(
				"select r.id, r.status, (select count(*)::int from snapshots s where s.run_id = r.id) as snapshots from collection_runs r order by r.id",
			)
			assert.strictEqual(runs.length, 2)
			// Interrupted before its commit: rolled back and recorded as failed, so
			// the status matches what was committed (nothing).
			assert.deepStrictEqual(at(runs, 1), { id: at(runs, 1).id, status: "failed", snapshots: 0 })
			assert.strictEqual((yield* store.latest("coingecko")).length, 5, "latest must keep serving data")
		}),
	)

	it.effect("interrupting a run while its row is being created leaves no running row", () =>
		Effect.gen(function* () {
			yield* reset
			const collector = yield* Collector
			yield* withInsertsBlocked(
				"collection_runs",
				Effect.gen(function* () {
					const fiber = yield* collector.runOnce("coingecko", "test").pipe(Effect.forkChild)
					yield* waitForBlockedInsert("collection_runs")
					yield* requestInterrupt(fiber)
					return fiber
				}),
			).pipe(Effect.flatMap(Fiber.await))
			const runs = yield* queryElsewhere<{ status: string; error: string | null }>(
				"select status, error from collection_runs",
			)
			// The insert is either cancelled in Postgres (no row) or lands just before the cancel and is closed.
			assert.isAtMost(runs.length, 1)
			for (const run of runs) assert.deepStrictEqual(run, { status: "failed", error: "Interrupted" })
		}),
	)
})

// Real clock: these tests wait on real timeouts.
layer(TestServices, { excludeTestServices: true })("lost replies", (it) => {
	it.effect("a run whose insert reply is lost is still closed as failed", () =>
		Effect.scoped(
			Effect.gen(function* () {
				yield* reset
				const proxy = yield* replyLosingProxy
				const error = yield* Effect.gen(function* () {
					const collector = yield* Collector
					// Postgres commits the run row; the reply is lost and the connection cut.
					proxy.loseRepliesAfter('insert into "collection_runs"', "drop")
					return yield* collector.runOnce("coingecko", "test").pipe(Effect.flip)
				}).pipe(Effect.provide(servicesWithShortTimeout(proxy.url)))
				assert.strictEqual(error._tag, "EffectDrizzleQueryError")
				assert.isTrue(proxy.triggered())
				const runs = yield* queryElsewhere<{ status: string }>("select status from collection_runs")
				assert.deepStrictEqual(runs, [{ status: "failed" }])
			}),
		),
	)
})
