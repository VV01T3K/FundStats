/**
 * Helpers for tests against the real test Postgres (see postgres.ts): database layers, setup and
 * inspection from other sessions, and ways to block, slow down or lose Postgres replies.
 */
import * as NodeNet from "node:net"

import * as PgClient from "@effect/sql-pg/PgClient"
import { assert } from "@effect/vitest"
import { sql } from "drizzle-orm"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as ConfigProvider from "effect/ConfigProvider"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import type * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Reactivity from "effect/reactivity/Reactivity"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import { inject } from "vitest"

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
		// The driver's own timers (connect, idle, acquire) run on real time while tests move the TestClock.
		Layer.provide(Layer.succeed(Clock.Clock, Clock.Clock.defaultValue())),
	)

/** Storage on the shared test database. */
export const TestStorage = storageOn(dbConfigOn(testDatabaseUrl))

/** The element at `index`; fails the test when it is missing. */
export const at = <A>(items: ReadonlyArray<A>, index: number): A => {
	const item = items[index]
	assert.isDefined(item)
	return item
}

const isQueryError = Schema.is(EffectDrizzleQueryError)

/** A database error with the Postgres error it wraps, to match its reason. */
export const errorText = (error: unknown): string =>
	isQueryError(error) ? `${error.message}\n${Cause.pretty(error.cause as Cause.Cause<unknown>)}` : String(error)

/** A fixed capture time for writes set up by hand. */
export const capturedAt = (iso = "2026-11-16T12:00:00Z") => DateTime.toDateUtc(DateTime.makeUnsafe(iso))

export const count = (table: string) =>
	Effect.gen(function* () {
		const db = yield* Database
		const result = yield* db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table}`))
		return at(result.rows, 0).n
	})

export const reset = Effect.gen(function* () {
	const db = yield* Database
	yield* db.execute(
		sql`truncate snapshots, raw_payloads, instruments, collection_runs, source_schedules restart identity cascade`,
	)
})

/** A Postgres session of its own, like another process would open, ended when the scope closes. */
const otherSession = PgClient.makeClient({ url: Redacted.make(testDatabaseUrl) }).pipe(Effect.provide(Reactivity.layer))

/**
 * Holds `source`'s collection lock from a separate Postgres session, the way
 * a `bun run collect` in another process would, until the scope closes.
 */
export const holdLockElsewhere = (source: string) =>
	Effect.gen(function* () {
		const session = yield* otherSession
		yield* session`select pg_advisory_lock(727002, hashtext(${source}))`
	}).pipe(Effect.orDie)

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
 * Requests interruption of a fiber suspended on database I/O. Its cleanup starts
 * before this returns; await the fiber to see the interruption finish.
 */
export const requestInterrupt = <A, E>(fiber: Fiber.Fiber<A, E>) => Effect.sync(() => fiber.interruptUnsafe())

/** One query on a fresh session of its own, like another process would make. */
export const queryElsewhere = <T extends object>(text: string, values: ReadonlyArray<unknown> = []) =>
	Effect.gen(function* () {
		const session = yield* otherSession
		return (yield* session.unsafe<T>(text, values)) as ReadonlyArray<T>
	}).pipe(Effect.scoped, Effect.orDie)

export const SOURCE_LOCK_HOLDERS =
	"select pid from pg_locks where locktype = 'advisory' and classid = 727002 and granted"

/** Kills the Postgres sessions holding a collection lock and waits until they are gone. */
export const terminateLockHolders = queryElsewhere<{ ok: boolean }>(
	`select pg_terminate_backend(pid, 5000) as ok from (${SOURCE_LOCK_HOLDERS}) holders`,
)

/** Runs `effect` while another session blocks inserts into `table`, then lifts the block. */
export const withInsertsBlocked = <A, E, R>(table: string, effect: Effect.Effect<A, E, R>) =>
	Effect.gen(function* () {
		const blocker = yield* otherSession.pipe(Effect.orDie)
		yield* blocker.unsafe("begin").pipe(Effect.orDie)
		yield* blocker.unsafe(`lock table ${table} in share mode`).pipe(Effect.orDie)
		const result = yield* effect
		yield* blocker.unsafe("commit").pipe(Effect.orDie)
		return result
	}).pipe(Effect.scoped)

/**
 * Returns once Postgres reports an insert into `table` waiting on a lock. Nothing signals that to the
 * client, so Postgres itself waits for it, in one statement.
 */
export const waitForBlockedInsert = (table: string) =>
	queryElsewhere(`
		do $$ begin
			while not exists (
				select 1 from pg_stat_activity where wait_event_type = 'Lock' and query ilike 'insert into "${table}"%'
			) loop
				-- pg_stat_activity is a snapshot per transaction; take a fresh one each time.
				perform pg_stat_clear_snapshot();
				perform pg_sleep(0.01);
			end loop;
		end $$
	`)

/** Runs `effect` with every snapshot insert held 0.5 s in Postgres, logging when each one finished. */
export const withSlowSnapshotWrites = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.acquireUseRelease(
		Effect.forEach(
			[
				"create table slow_snapshot_writes (finished_at timestamptz not null)",
				`create function slow_snapshot_write() returns trigger language plpgsql as $$
				begin
					perform pg_sleep(0.5);
					insert into slow_snapshot_writes values (clock_timestamp());
					return null;
				end $$`,
				`create trigger slow_snapshot_write after insert on snapshots
					for each statement execute function slow_snapshot_write()`,
			],
			(statement) => queryElsewhere(statement),
		),
		() => effect,
		() =>
			Effect.forEach(
				[
					"drop trigger slow_snapshot_write on snapshots",
					"drop function slow_snapshot_write()",
					"drop table slow_snapshot_writes",
				],
				(statement) => queryElsewhere(statement),
			),
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
		const db = yield* Database
		const result = yield* db.execute<{ status: string; error: string | null }>(
			sql`select status, error from collection_runs where id = ${id}`,
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
