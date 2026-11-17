/**
 * Storage, collection locks and interruption against a real Postgres (see postgres.ts). The collector's
 * end-to-end runs are tested in apps/collector, the HTTP API in apps/web.
 */
import { assert, layer } from "@effect/vitest"
import { sql } from "drizzle-orm"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import pg from "pg"

import { Database } from "../src/Database.ts"
import { RunStore } from "../src/RunStore.ts"
import { collectionRuns } from "../src/schema.ts"
import { SourceLocks } from "../src/SourceLocks.ts"
import { Store } from "../src/Store.ts"
import {
	at,
	capturedAt,
	count,
	dbConfigOn,
	gate,
	holdLockElsewhere,
	queryElsewhere,
	replyLosingProxy,
	requestInterrupt,
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

	it.effect("a run that succeeds clears an earlier error", () =>
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
					const result = yield* lock.use("pid", (db) =>
						db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`),
					)
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
			const inserted = gate()
			const statements = gate()
			const fiber = yield* database
				.transaction("slow", async (tx) => {
					await tx.execute(
						sql`insert into collection_runs (source, trigger, status) values ('mbank', 'test', 'running')`,
					)
					inserted.open()
					await statements.after(() => undefined)
				})
				.pipe(Effect.forkChild)
			yield* Effect.promise(() => inserted.after(() => undefined))
			yield* requestInterrupt(fiber)
			assert.isUndefined(fiber.pollUnsafe(), "the interruption must wait for the transaction")
			statements.open()
			yield* Fiber.await(fiber)
			assert.strictEqual(yield* count("collection_runs"), 0)
		}),
	)

	it.effect("an interrupted query still runs exactly once", () =>
		Effect.gen(function* () {
			yield* reset
			const database = yield* Database
			yield* withInsertsBlocked(
				"collection_runs",
				Effect.gen(function* () {
					const fiber = yield* database
						.use("insert", (db) =>
							db.insert(collectionRuns).values({ source: "mbank", trigger: "test", status: "running" }),
						)
						.pipe(Effect.forkChild)
					yield* waitForBlockedInsert("collection_runs")
					yield* requestInterrupt(fiber)
					return fiber
				}),
			).pipe(Effect.flatMap(Fiber.await))
			assert.strictEqual(yield* count("collection_runs"), 1)
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
				const shown = yield* database.use("show", (db) =>
					db.execute<{ statement_timeout: string }>(sql`show statement_timeout`),
				)
				assert.strictEqual(at(shown.rows, 0).statement_timeout, "1s")
				const blocker = new pg.Client({ connectionString: testDatabaseUrl })
				yield* Effect.promise(async () => {
					await blocker.connect()
					await blocker.query("begin")
					await blocker.query("lock table collection_runs in share mode")
				})
				const started = yield* Clock.currentTimeMillis
				const error = yield* database
					.use("insert", (db) =>
						db.insert(collectionRuns).values({ source: "mbank", trigger: "test", status: "running" }),
					)
					.pipe(Effect.flip, Effect.ensuring(Effect.promise(() => blocker.end())))
				return { error, waited: (yield* Clock.currentTimeMillis) - started }
			}).pipe(Effect.provide(storageWithShortTimeout(testDatabaseUrl)))
			// Drizzle wraps the Postgres error; its message names the reason.
			assert.match(String((result.error.cause as { cause?: unknown }).cause), /statement timeout/)
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
					const fiber = yield* database
						.use("withheld", (db) => db.execute(sql`select 'withheld reply' as marker`))
						.pipe(Effect.forkChild)
					yield* Effect.promise(() => proxy.reached)
					const started = yield* Clock.currentTimeMillis
					// Statement timeout (1 s) plus the reply grace (5 s), with room to spare.
					yield* Fiber.interrupt(fiber).pipe(Effect.timeout("10 seconds"))
					const waited = (yield* Clock.currentTimeMillis) - started
					assert.isAtLeast(waited, 5_000, "it waited for the reply first")
				}).pipe(
					// Cut the frozen connection before the pool closes, or closing it would wait for that query.
					Effect.ensuring(Effect.promise(proxy.close)),
					Effect.provide(storageWithShortTimeout(proxy.url)),
				)
			}),
		),
	)

	it.effect("the read-only pool cannot write", () =>
		Effect.gen(function* () {
			yield* reset
			const error = yield* Effect.gen(function* () {
				const database = yield* Database
				// Reads work as usual.
				yield* database.use("read", (db) => db.execute(sql`select count(*) from collection_runs`))
				return yield* database
					.use("write", (db) =>
						db.insert(collectionRuns).values({ source: "mbank", trigger: "test", status: "running" }),
					)
					.pipe(Effect.flip)
			}).pipe(Effect.provide(Layer.fresh(Database.layerReadOnly.pipe(Layer.provide(dbConfigOn(testDatabaseUrl))))))
			assert.match(String((error.cause as { cause?: unknown }).cause), /read-only transaction/)
			assert.strictEqual(yield* count("collection_runs"), 0)
		}),
	)
})
