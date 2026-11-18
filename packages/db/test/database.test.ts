/**
 * Storage, collection locks and interruption against a real Postgres (see postgres.ts). The collector's
 * end-to-end runs are tested in apps/collector, the HTTP API in apps/web.
 */
import { assert, layer } from "@effect/vitest"
import { sql } from "drizzle-orm"
import * as Clock from "effect/Clock"
import * as DateTime from "effect/DateTime"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"

import { Database } from "../src/Database.ts"
import { RunStore } from "../src/RunStore.ts"
import { collectionRuns, newestSnapshotFirst, snapshots } from "../src/schema.ts"
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

const persistAt = (source: string, when: Date, rows: ReadonlyArray<ReturnType<typeof row>>) =>
	Effect.gen(function* () {
		const runId = yield* startRun(source, "test")
		return yield* (yield* writer).persist({ source, runId, capturedAt: when, rows })
	})

layer(TestStorage)("runs and the latest view", (it) => {
	it.effect("latest shows the newest valuation date even when an older date was captured later", () =>
		Effect.gen(function* () {
			yield* reset
			const store = yield* Store
			const first = yield* startRun("mbank", "test")
			yield* (yield* writer).persist({
				source: "mbank",
				runId: first,
				capturedAt: capturedAt("2026-11-16T12:00:00Z"),
				rows: [row("f", "2026-11-16", 10)],
			})
			const second = yield* startRun("mbank", "test")
			yield* (yield* writer).persist({
				source: "mbank",
				runId: second,
				capturedAt: capturedAt("2026-11-17T12:00:00Z"),
				rows: [row("f", "2026-11-13", 9)],
			})
			const latest = at(yield* store.latest("mbank"), 0)
			assert.strictEqual(latest.asOf, "2026-11-16")
			assert.strictEqual(latest.value, 10)
		}),
	)

	it.effect(
		"history lists dated values by valuation date, newest first, even when an older date was written later",
		() =>
			Effect.gen(function* () {
				yield* reset
				const first = yield* startRun("mbank", "test")
				yield* (yield* writer).persist({
					source: "mbank",
					runId: first,
					capturedAt: capturedAt("2026-11-16T12:00:00Z"),
					rows: [row("f", "2026-11-16", 10)],
				})
				const second = yield* startRun("mbank", "test")
				yield* (yield* writer).persist({
					source: "mbank",
					runId: second,
					capturedAt: capturedAt("2026-11-17T12:00:00Z"),
					rows: [row("f", "2026-11-13", 9)],
				})
				const history = yield* (yield* Store).history("mbank", "f", 10)
				assert.deepStrictEqual(
					history?.points.map((p) => p.asOf),
					["2026-11-16", "2026-11-13"],
				)
			}),
	)

	it.effect("a live quote equal to the instrument's newest snapshot is not stored again", () =>
		Effect.gen(function* () {
			yield* reset
			const store = yield* Store
			const first = yield* startRun("coingecko", "test")
			yield* (yield* writer).persist({
				source: "coingecko",
				runId: first,
				capturedAt: capturedAt("2026-11-16T12:00:00Z"),
				rows: [row("a", null, 1), row("b", null, 2), { ...row("c", null, 3), metrics: { rank: 3 } }],
			})
			const second = yield* startRun("coingecko", "test")
			const result = yield* (yield* writer).persist({
				source: "coingecko",
				runId: second,
				capturedAt: capturedAt("2026-11-16T18:00:00Z"),
				rows: [row("a", null, 1), row("b", null, 2.5), { ...row("c", null, 3), metrics: { rank: 4 } }],
			})
			assert.deepStrictEqual(result, { instrumentCount: 3, rowsWritten: 2 })
			assert.strictEqual(yield* count("snapshots"), 5)
			const [run] = yield* queryElsewhere<{ rows_written: number }>(
				"select rows_written from collection_runs where id = $1",
				[second],
			)
			assert.strictEqual(run?.rows_written, 2)
			// The unchanged instrument is still listed, with the snapshot it last changed in.
			const latest = yield* store.latest("coingecko")
			assert.deepStrictEqual(
				latest.map((r) => [r.externalId, r.value, r.capturedAt]),
				[
					["c", 3, "2026-11-16T18:00:00.000Z"],
					["a", 1, "2026-11-16T12:00:00.000Z"],
					["b", 2.5, "2026-11-16T18:00:00.000Z"],
				],
			)
		}),
	)

	it.effect("downsampling keeps old live quotes only as each instrument's newest per UTC day", () =>
		Effect.gen(function* () {
			yield* reset
			const { ms } = at(
				yield* queryElsewhere<{ ms: number }>("select extract(epoch from now())::float8 * 1000 as ms"),
				0,
			)
			const hoursAgo = (hours: number) => DateTime.toDateUtc(DateTime.makeUnsafe(ms - hours * 3_600_000))
			// Old points: two UTC days around midnight, then recent ones inside the detail window.
			const old = [
				["2020-01-01T08:00:00Z", 1],
				["2020-01-01T23:30:00Z", 2],
				["2020-01-02T00:30:00Z", 3],
				["2020-01-02T12:00:00Z", 4],
			] as const
			for (const [iso, value] of old) {
				yield* persistAt("coingecko", capturedAt(iso), [row("a", null, value), row("gone", null, value)])
			}
			yield* persistAt("coingecko", hoursAgo(30), [row("a", null, 5)])
			yield* persistAt("coingecko", hoursAgo(2), [row("a", null, 6)])
			yield* persistAt("coingecko", hoursAgo(1), [row("a", null, 7)])
			// Dated rows captured on one old day are never thinned.
			yield* persistAt("mbank", capturedAt("2020-01-01T08:00:00Z"), [row("f", "2019-12-30", 1)])
			yield* persistAt("mbank", capturedAt("2020-01-01T09:00:00Z"), [row("f", "2019-12-31", 2)])

			const deleted = yield* (yield* RunStore).downsampleLiveSnapshots(7)
			assert.strictEqual(deleted, 4)
			const kept = yield* queryElsewhere<{ external_id: string; value: string }>(
				`select i.external_id, s.value::text as value from snapshots s join instruments i on i.id = s.instrument_id
				 order by i.external_id, s.captured_at`,
			)
			assert.deepStrictEqual(
				kept.map((k) => `${k.external_id}=${k.value}`),
				// "gone" is no longer reported; its newest snapshot (4) is kept with one point per day.
				["a=2", "a=4", "a=5", "a=6", "a=7", "f=1", "f=2", "gone=2", "gone=4"],
			)
			assert.strictEqual(yield* (yield* RunStore).downsampleLiveSnapshots(7), 0, "a second pass deletes nothing")
		}),
	)

	it.effect("downsampling works through a backlog larger than one batch", () =>
		Effect.gen(function* () {
			yield* reset
			yield* persistAt("coingecko", capturedAt("2020-01-01T00:00:00Z"), [row("a", null, 0)])
			// One quote a minute from 2020-01-01 00:01 to 2020-01-18 08:40 UTC: 18 UTC days.
			yield* queryElsewhere(
				`insert into snapshots (instrument_id, captured_at, value, metrics)
				 select i.id, timestamptz '2020-01-01 00:00:00+00' + g * interval '1 minute', g, '{}'
				 from instruments i, generate_series(1, 25000) g where i.external_id = 'a'`,
			)
			assert.strictEqual(yield* (yield* RunStore).downsampleLiveSnapshots(7), 25_001 - 18)
			const days = yield* queryElsewhere<{ day: string; value: string }>(
				`select (captured_at at time zone 'UTC')::date::text as day, value::text as value
				 from snapshots order by captured_at`,
			)
			assert.strictEqual(days.length, 18)
			assert.deepStrictEqual(at(days, 0), { day: "2020-01-01", value: "1439" })
			assert.deepStrictEqual(at(days, 17), { day: "2020-01-18", value: "25000" })
		}),
	)

	it.effect("live quotes with the same capture time: the higher id is the newest everywhere", () =>
		Effect.gen(function* () {
			yield* reset
			const when = capturedAt("2020-01-01T08:00:00Z")
			yield* persistAt("coingecko", when, [row("a", null, 1)])
			yield* persistAt("coingecko", when, [row("a", null, 2)])
			assert.strictEqual(at(yield* (yield* Store).latest("coingecko"), 0).value, 2)
			// Equal to the newest (2), not to the older tie (1): not stored again.
			const runId = yield* startRun("coingecko", "test")
			const again = yield* (yield* writer).persist({
				source: "coingecko",
				runId,
				capturedAt: when,
				rows: [row("a", null, 2)],
			})
			assert.strictEqual(again.rowsWritten, 0)
			assert.strictEqual(yield* (yield* RunStore).downsampleLiveSnapshots(7), 1)
			const kept = yield* queryElsewhere<{ value: string }>("select value::text as value from snapshots")
			assert.deepStrictEqual(kept, [{ value: "2" }])
		}),
	)

	it.effect("the newest-snapshot lookup reads the index in order instead of sorting an instrument's history", () =>
		Effect.gen(function* () {
			yield* reset
			yield* persistAt("coingecko", capturedAt("2020-01-01T00:00:00Z"), [row("a", null, 0)])
			yield* queryElsewhere(
				`insert into snapshots (instrument_id, captured_at, value, metrics)
				 select i.id, timestamptz '2020-01-01 00:00:00+00' + g * interval '1 hour', g, '{}'
				 from instruments i, generate_series(1, 5000) g where i.external_id = 'a'`,
			)
			yield* queryElsewhere("analyze snapshots")
			const db = yield* Database
			const plan = yield* db.execute<{ "QUERY PLAN": string }>(
				sql`explain select value, metrics from ${snapshots} where instrument_id = 1 order by ${newestSnapshotFirst} limit 1`,
			)
			const lines = plan.rows.map((r) => r["QUERY PLAN"])
			assert.isTrue(
				lines.some((l) => l.includes("Index Scan using snapshots_instrument_captured_idx")),
				lines.join("\n"),
			)
			// An Incremental Sort only orders the rows that tie on captured_at; a full Sort would order them all.
			assert.isFalse(
				lines.some((l) => /^\s*(->\s+)?Sort\s+\(cost/.test(l)),
				lines.join("\n"),
			)
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
			yield* runs.failRun(runId, "Interrupted (app stopped during the run)", Option.none())
			yield* (yield* writer).persist({
				source: "coingecko",
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
				runId,
				capturedAt: capturedAt(),
				rows: [row("a", null, 1)],
			})
			yield* (yield* RunStore).failRun(runId, "Interrupted", Option.none())
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

	it.effect("the pool does not start on a database without this schema", () =>
		Effect.gen(function* () {
			yield* queryElsewhere("drop database if exists unmigrated")
			yield* queryElsewhere("create database unmigrated")
			const url = new URL(testDatabaseUrl)
			url.pathname = "/unmigrated"
			const error = yield* Layer.build(
				Layer.fresh(Database.layerReadOnly.pipe(Layer.provide(dbConfigOn(url.href)))),
			).pipe(Effect.scoped, Effect.flip)
			assert.match(errorText(error), /relation "collection_runs" does not exist/)
		}),
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
