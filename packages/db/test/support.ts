/**
 * Helpers for tests against the real test Postgres (see postgres.ts): database layers, setup and
 * inspection from other sessions, and ways to block, slow down or lose Postgres replies.
 */
import * as NodeNet from "node:net"

import { assert } from "@effect/vitest"
import { sql } from "drizzle-orm"
import * as ConfigProvider from "effect/ConfigProvider"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import type * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import pg from "pg"
import { expect, inject } from "vitest"

import { Database } from "../src/Database.ts"
import { DbConfig } from "../src/DbConfig.ts"
import { migrationsFolder, runMigrations } from "../src/Migrations.ts"
import { type NormalizedRow, RunStore } from "../src/RunStore.ts"
import { SourceLocks } from "../src/SourceLocks.ts"
import { Store } from "../src/Store.ts"
import { DATABASE_URL } from "./context.ts"

/** The URL of the test database the global setup started. */
export const testDatabaseUrl = inject(DATABASE_URL)

/** DbConfig for the test database, with one pooled connection unless `env` says otherwise. */
export const dbConfigOn = (url: string, env: Record<string, string> = {}) =>
	DbConfig.layer.pipe(
		// One pooled connection: a collection must not need a second pool slot
		// while it holds its source lock, or it would deadlock.
		Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord({ DATABASE_URL: url, DB_POOL_MAX: "1", ...env }))),
	)

const Migrated = Layer.effectDiscard(runMigrations(migrationsFolder))

/** Database, locks, Store and RunStore on a migrated database, built from a DbConfig layer. */
export const storageOn = <E, R>(config: Layer.Layer<DbConfig, E, R>) =>
	Layer.mergeAll(Store.layer, RunStore.layer).pipe(
		Layer.provideMerge(SourceLocks.layer),
		Layer.provideMerge(Database.layer),
		Layer.provideMerge(Migrated),
		Layer.provideMerge(config),
	)

/** Storage on the shared test database. */
export const TestStorage = storageOn(dbConfigOn(testDatabaseUrl))

/** The element at `index`; fails the test when it is missing. */
export const at = <A>(items: ReadonlyArray<A>, index: number): A => {
	const item = items[index]
	assert.isDefined(item)
	return item
}

/** A fixed capture time for writes set up by hand. */
export const capturedAt = (iso = "2026-11-16T12:00:00Z") => DateTime.toDateUtc(DateTime.makeUnsafe(iso))

export const count = (table: string) =>
	Effect.gen(function* () {
		const { use } = yield* Database
		const result = yield* use("count", (db) =>
			db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table}`)),
		)
		return at(result.rows, 0).n
	})

export const reset = Effect.gen(function* () {
	const { use } = yield* Database
	yield* use("reset", (db) =>
		db.execute(
			sql`truncate snapshots, raw_payloads, instruments, collection_runs, source_schedules restart identity cascade`,
		),
	)
})

/**
 * Holds `source`'s collection lock from a separate Postgres session, the way
 * a `bun run collect` in another process would.
 */
export const holdLockElsewhere = (source: string) =>
	Effect.acquireRelease(
		Effect.promise(async () => {
			const client = new pg.Client({ connectionString: testDatabaseUrl })
			await client.connect()
			await client.query("select pg_advisory_lock(727002, hashtext($1))", [source])
			return client
		}),
		(client) => Effect.promise(() => client.end()),
	)

/** Run writes on the pool, outside any source lock, for tests that set up runs by hand. */
export const writer = Effect.gen(function* () {
	return (yield* RunStore).writer(yield* Database)
})

/** Creates a run row the way the collector does: reserve the id, then insert. */
export const startRun = (source: string, trigger: string) =>
	Effect.gen(function* () {
		const w = yield* writer
		const runId = yield* w.reserveRunId
		yield* w.startRun(runId, source, trigger)
		return runId
	})

/**
 * Requests interruption of a fiber suspended on database I/O. Its cleanup (the abort) starts
 * before this returns; await the fiber to see the interruption finish.
 */
export const requestInterrupt = <A, E>(fiber: Fiber.Fiber<A, E>) => Effect.sync(() => fiber.interruptUnsafe())

/** One query on a fresh connection of its own, like another process would make. */
const queryOnNewConnection = async <T extends pg.QueryResultRow>(text: string, values: ReadonlyArray<unknown>) => {
	const client = new pg.Client({ connectionString: testDatabaseUrl })
	await client.connect()
	try {
		return (await client.query<T>(text, [...values])).rows
	} finally {
		await client.end()
	}
}

export const queryElsewhere = <T extends pg.QueryResultRow>(text: string, values: ReadonlyArray<unknown> = []) =>
	Effect.promise(() => queryOnNewConnection<T>(text, values))

export const SOURCE_LOCK_HOLDERS =
	"select pid from pg_locks where locktype = 'advisory' and classid = 727002 and granted"

/** Kills the Postgres sessions holding a collection lock and waits until they are gone. */
export const terminateLockHolders = queryElsewhere<{ ok: boolean }>(
	`select pg_terminate_backend(pid, 5000) as ok from (${SOURCE_LOCK_HOLDERS}) holders`,
)

/** Runs `effect` while another session blocks inserts into `table`, then lifts the block. */
export const withInsertsBlocked = <A, E, R>(table: string, effect: Effect.Effect<A, E, R>) =>
	Effect.acquireUseRelease(
		Effect.promise(async () => {
			const blocker = new pg.Client({ connectionString: testDatabaseUrl })
			await blocker.connect()
			await blocker.query("begin")
			await blocker.query(`lock table ${table} in share mode`)
			return blocker
		}),
		(blocker) => effect.pipe(Effect.tap(() => Effect.promise(() => blocker.query("commit")))),
		(blocker) => Effect.promise(() => blocker.end()),
	)

/** Waits until Postgres reports an insert into `table` waiting on a lock; nothing signals that. */
export const waitForBlockedInsert = (table: string) =>
	Effect.promise(() =>
		expect
			.poll(async () => {
				const waiting = await queryOnNewConnection(
					"select 1 from pg_stat_activity where wait_event_type = 'Lock' and query ilike $1",
					[`insert into "${table}"%`],
				)
				return waiting.length
			})
			.toBeGreaterThan(0),
	)

/** Runs `effect` with every snapshot insert held 0.5 s in Postgres, logging when each one finished. */
export const withSlowSnapshotWrites = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.acquireUseRelease(
		queryElsewhere(`
			create table slow_snapshot_writes (finished_at timestamptz not null);
			create function slow_snapshot_write() returns trigger language plpgsql as $$
			begin
				perform pg_sleep(0.5);
				insert into slow_snapshot_writes values (clock_timestamp());
				return null;
			end $$;
			create trigger slow_snapshot_write after insert on snapshots
				for each statement execute function slow_snapshot_write();
		`),
		() => effect,
		() =>
			queryElsewhere(`
				drop trigger slow_snapshot_write on snapshots;
				drop function slow_snapshot_write();
				drop table slow_snapshot_writes;
			`),
	)

/** An upstream response the test releases by hand. */
export const gate = () => {
	let open!: () => void
	const opened = new Promise<void>((resolve) => {
		open = resolve
	})
	return { open, after: <A>(value: () => A) => opened.then(value) }
}

export const row = (externalId: string, asOf: string | null, value: number): NormalizedRow => ({
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

export const runStatus = (id: number) =>
	Effect.gen(function* () {
		const { use } = yield* Database
		const result = yield* use("runStatus", (db) =>
			db.execute<{ status: string; error: string | null }>(
				sql`select status, error from collection_runs where id = ${id}`,
			),
		)
		return at(result.rows, 0)
	})

/**
 * A TCP proxy in front of the test Postgres that can lose replies: once a
 * client sends a query containing `pattern`, Postgres still gets it, but its
 * replies on that connection never reach the client ("withhold"), and with
 * "drop" the connection is then cut.
 */
/** The Postgres ReadyForQuery message for an idle session: `Z`, length 5, status `I`. */
const READY_FOR_QUERY = "Z\0\0\0\x05I"

export const replyLosingProxy = Effect.acquireRelease(
	Effect.promise(
		() =>
			new Promise<{
				url: string
				loseRepliesAfter: (pattern: string, action: "withhold" | "drop") => void
				triggered: () => boolean
				reached: Promise<void>
				close: () => Promise<void>
			}>((resolve) => {
				const target = new URL(testDatabaseUrl)
				let rule: { pattern: string; action: "withhold" | "drop" } | undefined
				let fired = false
				let markReached!: () => void
				const reached = new Promise<void>((done) => {
					markReached = done
				})
				const sockets = new Set<NodeNet.Socket>()
				const server = NodeNet.createServer((client) => {
					const upstream = NodeNet.connect(Number(target.port), target.hostname)
					sockets.add(client).add(upstream)
					let withheld = false
					let dropOnReply = false
					client.on("data", (chunk) => {
						if (rule && chunk.toString("latin1").includes(rule.pattern)) {
							const { action } = rule
							rule = undefined
							withheld = true
							fired = true
							markReached()
							dropOnReply = action === "drop"
						}
						upstream.write(chunk)
					})
					upstream.on("data", (chunk) => {
						if (!withheld) client.write(chunk)
						// Cut only once Postgres has finished (and committed) the withheld query.
						else if (dropOnReply && chunk.toString("latin1").includes(READY_FOR_QUERY)) client.destroy()
					})
					client.on("close", () => upstream.destroy())
					upstream.on("close", () => client.destroy())
					client.on("error", () => upstream.destroy())
					upstream.on("error", () => client.destroy())
				})
				server.listen(0, "127.0.0.1", () => {
					const url = new URL(target)
					url.hostname = "127.0.0.1"
					url.port = String((server.address() as NodeNet.AddressInfo).port)
					resolve({
						url: url.toString(),
						close: () =>
							new Promise<void>((done) => {
								for (const socket of sockets) socket.destroy()
								server.close(() => done())
							}),
						loseRepliesAfter: (pattern, action) => {
							rule = { pattern, action }
						},
						triggered: () => fired,
						reached,
					})
				})
			}),
	),
	(proxy) => Effect.promise(proxy.close),
)
