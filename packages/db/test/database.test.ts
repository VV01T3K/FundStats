/**
 * Storage, collection locks and interruption against a real Postgres (see postgres.ts). The collector's
 * end-to-end runs are tested in apps/collector, the HTTP API in apps/web.
 */
import { assert, layer } from "@effect/vitest"
import { sql } from "drizzle-orm"
import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"

import { Database } from "../src/Database.ts"
import { RunStore } from "../src/RunStore.ts"
import { collectionRuns } from "../src/schema.ts"
import { SourceLocks } from "../src/SourceLocks.ts"
import { Store } from "../src/Store.ts"
import {
	at,
	capturedAt,
	count,
	errorText,
	dbConfigOn,
	holdLockElsewhere,
	keepAliveOfConnectionsTo,
	queryElsewhere,
	replyLosingProxy,
	reset,
	row,
	runStatus,
	SOURCE_LOCK_HOLDERS,
	startRun,
	storageOn,
	terminateLockHolders,
	testDatabaseUrl,
	TestStorage,
	waitForBlockedInsert,
	withInsertsBlocked,
	withSlowSnapshotWrites,
	writer,
} from "./support.ts"

/** Storage on `url` with a 1 second statement timeout. Fresh, so the shared test layer's instances are not reused. */
const storageWithShortTimeout = (url: string) =>
	Layer.fresh(storageOn(dbConfigOn(url, { DB_STATEMENT_TIMEOUT: "1 second" })))

layer(TestStorage)("runs and the latest view", (it) => {
	it.effect("an older run that finishes after a newer one does not empty the latest view", () =>
		Effect.gen(function* () {
			yield* reset
			const store = yield* Store
			const older = yield* startRun("coingecko", "test")
			const newer = yield* startRun("coingecko", "test")
			const rows = [row("a", null, 1), row("b", null, 2)]
			yield* (yield* writer).persist({
				source: "coingecko",
				kind: "crypto",
				runId: newer,
				capturedAt: capturedAt(),
				rows,
			})
			yield* (yield* writer).persist({
				source: "coingecko",
				kind: "crypto",
				runId: older,
				capturedAt: capturedAt(),
				rows,
			})
			assert.strictEqual((yield* store.latest("coingecko")).length, 2)
		}),
	)

	it.effect("latest shows the newest valuation date even when an older date was captured later", () =>
		Effect.gen(function* () {
			yield* reset
			const store = yield* Store
			const first = yield* startRun("mbank", "test")
			yield* (yield* writer).persist({
				source: "mbank",
				kind: "fund",
				runId: first,
				capturedAt: capturedAt("2026-11-16T12:00:00Z"),
				rows: [row("f", "2026-11-16", 10)],
			})
			const second = yield* startRun("mbank", "test")
			yield* (yield* writer).persist({
				source: "mbank",
				kind: "fund",
				runId: second,
				capturedAt: capturedAt("2026-11-17T12:00:00Z"),
				rows: [row("f", "2026-11-13", 9)],
			})
			const latest = at(yield* store.latest("mbank"), 0)
			assert.strictEqual(latest.asOf, "2026-11-16")
			assert.strictEqual(latest.value, 10)
		}),
	)

	it.effect("startup recovery closes only abandoned runs; a live run elsewhere is left alone", () =>
		Effect.gen(function* () {
			yield* reset
			const runs = yield* RunStore
			const abandoned = yield* startRun("mbank", "cli")
			const live = yield* startRun("coinpaprika", "cli")
			const closed = yield* Effect.scoped(
				Effect.gen(function* () {
					yield* holdLockElsewhere("coinpaprika")
					return yield* runs.closeInterruptedRuns
				}),
			)
			assert.strictEqual(closed, 1)
			assert.strictEqual((yield* runStatus(abandoned)).status, "failed")
			assert.strictEqual((yield* runStatus(live)).status, "running")
		}),
	)

	it.effect("a run's finish time is when its writes completed, however long they took", () =>
		Effect.gen(function* () {
			yield* reset
			const runId = yield* startRun("coingecko", "cli")
			const [finish] = yield* withSlowSnapshotWrites(
				Effect.gen(function* () {
					yield* (yield* writer).persist({
						source: "coingecko",
						kind: "crypto",
						runId,
						capturedAt: capturedAt(),
						rows: [row("a", null, 1)],
					})
					return yield* queryElsewhere<{ afterWrites: boolean }>(
						`select finished_at >= (select max(finished_at) from slow_snapshot_writes) as "afterWrites"
						 from collection_runs where id = $1`,
						[runId],
					)
				}),
			)
			assert.deepStrictEqual(finish, { afterWrites: true })
		}),
	)

	it.effect("a committed persist marks its run successful and clears an earlier failure", () =>
		Effect.gen(function* () {
			yield* reset
			const runs = yield* RunStore
			const runId = yield* startRun("coingecko", "cli")
			yield* runs.failRun(runId, "Interrupted (app stopped during the run)")
			yield* (yield* writer).persist({
				source: "coingecko",
				kind: "crypto",
				runId,
				capturedAt: capturedAt(),
				rows: [row("a", null, 1)],
			})
			assert.deepStrictEqual(yield* runStatus(runId), { status: "success", error: null })
		}),
	)

	it.effect("recording a failure after a run committed keeps the run successful", () =>
		Effect.gen(function* () {
			yield* reset
			const store = yield* Store
			const runId = yield* startRun("coingecko", "test")
			yield* (yield* writer).persist({
				source: "coingecko",
				kind: "crypto",
				runId,
				capturedAt: capturedAt(),
				rows: [row("a", null, 1)],
			})
			yield* (yield* RunStore).failRun(runId, "Interrupted")
			assert.deepStrictEqual(yield* runStatus(runId), { status: "success", error: null })
			assert.strictEqual((yield* store.latest("coingecko")).length, 1)
		}),
	)
})

layer(TestStorage)("source locks and interruption", (it) => {
	it.effect("a run writes through the session that holds its lock", () =>
		Effect.gen(function* () {
			const locks = yield* SourceLocks
			const { writer: writerPid, holders } = yield* locks.withSourceLock("coingecko", (lock) =>
				Effect.gen(function* () {
					const result = yield* lock.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)
					return {
						writer: at(result.rows, 0).pid,
						holders: yield* queryElsewhere<{ pid: number }>(SOURCE_LOCK_HOLDERS),
					}
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
			const locks = yield* SourceLocks
			const error = yield* Effect.scoped(
				locks.withSourceLock("coingecko", (lock) =>
					Effect.gen(function* () {
						yield* terminateLockHolders
						// Postgres has freed the lock: another session takes it right away.
						yield* holdLockElsewhere("coingecko")
						yield* lock.insert(collectionRuns).values({ source: "coingecko", trigger: "test", status: "running" })
					}),
				),
			).pipe(Effect.flip)
			assert.strictEqual(error._tag, "EffectDrizzleQueryError")
			assert.strictEqual(yield* count("collection_runs"), 0, "no write may land while another session holds the lock")
		}),
	)

	it.effect("an interrupted transaction is rolled back before the interruption completes", () =>
		Effect.gen(function* () {
			yield* reset
			const database = yield* Database
			const session = yield* Deferred.make<number>()
			const fiber = yield* database
				.transaction((tx) =>
					Effect.gen(function* () {
						yield* tx.insert(collectionRuns).values({ source: "mbank", trigger: "test", status: "running" })
						const { rows } = yield* tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)
						yield* Deferred.succeed(session, at(rows, 0).pid)
						return yield* Effect.never
					}),
				)
				.pipe(Effect.forkChild)
			const pid = yield* Deferred.await(session)
			yield* Fiber.interrupt(fiber)
			// Once the interruption returns, the transaction is over: its session holds no transaction lock.
			const open = yield* queryElsewhere("select 1 from pg_locks where pid = $1 and locktype = 'transactionid'", [pid])
			assert.lengthOf(open, 0)
			assert.strictEqual(yield* count("collection_runs"), 0)
		}),
	)

	it.effect("an interrupted query is cancelled in Postgres, never run again or left running", () =>
		Effect.gen(function* () {
			yield* reset
			const database = yield* Database
			yield* withInsertsBlocked(
				"collection_runs",
				Effect.gen(function* () {
					const fiber = yield* database
						.insert(collectionRuns)
						.values({ source: "mbank", trigger: "test", status: "running" })
						.pipe(Effect.forkChild)
					yield* waitForBlockedInsert("collection_runs")
					yield* Fiber.interrupt(fiber)
				}),
			)
			// The block is lifted now; an insert still pending in Postgres would land.
			assert.strictEqual(yield* count("collection_runs"), 0)
		}),
	)
})

// Real clock: these tests wait on real timeouts.
layer(TestStorage, { excludeTestServices: true })("bounded waits and lost replies", (it) => {
	it.effect("a statement blocked past DB_STATEMENT_TIMEOUT fails instead of waiting forever", () =>
		Effect.gen(function* () {
			yield* reset
			const result = yield* Effect.gen(function* () {
				const database = yield* Database
				const shown = yield* database.execute<{ statement_timeout: string }>(sql`show statement_timeout`)
				assert.strictEqual(at(shown.rows, 0).statement_timeout, "1s")
				return yield* withInsertsBlocked(
					"collection_runs",
					Effect.gen(function* () {
						const started = yield* Clock.currentTimeMillis
						const error = yield* database
							.insert(collectionRuns)
							.values({ source: "mbank", trigger: "test", status: "running" })
							.pipe(Effect.flip)
						return { error, waited: (yield* Clock.currentTimeMillis) - started }
					}),
				)
			}).pipe(Effect.provide(storageWithShortTimeout(testDatabaseUrl)))
			assert.match(errorText(result.error), /statement timeout/)
			assert.isBelow(result.waited, 5_000)
			assert.strictEqual(yield* count("collection_runs"), 0)
		}),
	)

	it.effect("interrupting a query whose reply never arrives finishes in bounded time", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const proxy = yield* replyLosingProxy
				yield* Effect.gen(function* () {
					const database = yield* Database
					proxy.loseRepliesAfter("withheld reply", "withhold")
					const fiber = yield* database.execute(sql`select 'withheld reply' as marker`).pipe(Effect.forkChild)
					yield* Effect.promise(() => proxy.reached)
					// The driver cancels the query, then gives up on the session after 5 s without a reply.
					yield* Fiber.interrupt(fiber).pipe(Effect.timeout("10 seconds"))
				}).pipe(
					// Cut the frozen connection before the pool closes, or closing it would wait for that query.
					Effect.ensuring(Effect.promise(proxy.close)),
					Effect.provide(storageWithShortTimeout(proxy.url)),
				)
			}),
		),
	)

	it.effect("a COMMIT whose reply never arrives ends once Postgres closes the idle session", () =>
		Effect.scoped(
			Effect.gen(function* () {
				yield* reset
				const proxy = yield* replyLosingProxy
				yield* Effect.gen(function* () {
					const locks = yield* SourceLocks
					proxy.loseRepliesAfter("COMMIT", "withhold")
					const fiber = yield* locks
						.withSourceLock(
							"mbank",
							(lock) =>
								lock.transaction((tx) =>
									tx.insert(collectionRuns).values({ source: "mbank", trigger: "test", status: "running" }),
								),
							{ idleSessionTimeout: Duration.seconds(1) },
						)
						.pipe(Effect.forkChild)
					yield* Effect.promise(() => proxy.reached)
					// COMMIT is uninterruptible: only the session closing (idle_session_timeout) ends the wait.
					yield* Fiber.interrupt(fiber).pipe(Effect.timeout("10 seconds"))
				}).pipe(Effect.ensuring(Effect.promise(proxy.close)), Effect.provide(storageWithShortTimeout(proxy.url)))
				assert.strictEqual(yield* count("collection_runs"), 1, "Postgres committed before the reply was lost")
			}),
		),
	)

	it.effect("the pool replaces a connection Postgres closed while it sat idle", () =>
		Effect.gen(function* () {
			const [before, after] = yield* Effect.gen(function* () {
				const database = yield* Database
				const pid = database
					.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)
					.pipe(Effect.map(({ rows }) => at(rows, 0).pid))
				const first = yield* pid
				// Returns once the session is gone, as after idle_session_timeout.
				yield* queryElsewhere("select pg_terminate_backend($1, 5000)", [first])
				return [first, yield* pid] as const
			}).pipe(Effect.provide(storageWithShortTimeout(testDatabaseUrl)))
			assert.notStrictEqual(after, before)
		}),
	)

	it.effect("pooled and lock sessions probe their peer, so a vanished server fails a pending COMMIT", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const proxy = yield* replyLosingProxy
				// Every connection to the proxy's port is one this storage opened.
				const port = Number(new URL(proxy.url).port)
				const probed = yield* Effect.gen(function* () {
					yield* (yield* Database).execute(sql`select 1`)
					return yield* (yield* SourceLocks).withSourceLock("coingecko", () => keepAliveOfConnectionsTo(port))
				}).pipe(Effect.provide(storageWithShortTimeout(proxy.url)))
				// The pool's connection and the lock's own session.
				assert.deepStrictEqual(probed, [true, true])
			}),
		),
	)

	it.effect("the read-only pool cannot write", () =>
		Effect.gen(function* () {
			yield* reset
			const error = yield* Effect.gen(function* () {
				const database = yield* Database
				// Reads work as usual.
				yield* database.execute(sql`select count(*) from collection_runs`)
				return yield* database
					.insert(collectionRuns)
					.values({ source: "mbank", trigger: "test", status: "running" })
					.pipe(Effect.flip)
			}).pipe(Effect.provide(Layer.fresh(Database.layerReadOnly.pipe(Layer.provide(dbConfigOn(testDatabaseUrl))))))
			assert.match(errorText(error), /read-only transaction/)
			assert.strictEqual(yield* count("collection_runs"), 0)
		}),
	)
})
