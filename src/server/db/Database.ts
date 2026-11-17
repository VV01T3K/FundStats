import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import pg from "pg"

import { AppConfig } from "../config.ts"
import * as schema from "./schema.ts"

type Db = NodePgDatabase<typeof schema>
/** A transaction handle; it has the same query API as `Db`. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

export class DatabaseError extends Schema.TaggedError<DatabaseError>()("DatabaseError", {
	operation: Schema.String,
	message: Schema.String,
	cause: Schema.Defect(),
}) {}

/** Another process (or fiber) is already collecting this source. */
export class SourceBusy extends Schema.TaggedError<SourceBusy>()("SourceBusy", {
	source: Schema.String,
	message: Schema.String,
}) {}

const toDatabaseError = (operation: string) => (cause: unknown) =>
	new DatabaseError({
		operation,
		message: cause instanceof Error ? cause.message : String(cause),
		cause,
	})

/** Runs Drizzle queries on the pool or on one connection, mapping failures to DatabaseError. */
export interface Executor {
	readonly use: <A>(operation: string, f: (db: Db) => Promise<A>) => Effect.Effect<A, DatabaseError>
	/**
	 * Runs `f` in a transaction. If the fiber is interrupted, the transaction
	 * is rolled back when `f` returns, and the interruption waits for that, so
	 * an interrupted caller never races a commit it does not know about.
	 */
	readonly transaction: <A>(operation: string, f: (tx: Tx) => Promise<A>) => Effect.Effect<A, DatabaseError>
}

/**
 * Runs an uncancellable promise; interruption aborts `signal` and waits (at most `maxWait`, past
 * the statement timeout) for it to settle, so its database work has finished before the fiber ends.
 * Drizzle queries are lazy thenables that run on every `then`, so `run` is adopted into one promise.
 */
const settled = <A>(
	operation: string,
	maxWait: Duration.Duration,
	run: (signal: AbortSignal) => PromiseLike<A>,
): Effect.Effect<A, DatabaseError> =>
	Effect.callback<A, DatabaseError>((resume) => {
		const controller = new AbortController()
		const promise = new Promise<A>((resolve) => resolve(run(controller.signal)))
		promise.then(
			(value) => resume(Effect.succeed(value)),
			(error) => resume(Effect.fail(toDatabaseError(operation)(error))),
		)
		return Effect.promise(() => {
			controller.abort()
			return promise.then(
				() => undefined,
				() => undefined,
			)
		}).pipe(Effect.timeoutOption(maxWait), Effect.asVoid)
	})

class RolledBack extends Schema.TaggedError<RolledBack>()("RolledBack", {
	message: Schema.String,
}) {}

/** How long an interruption waits past the statement timeout for a reply. */
const REPLY_GRACE = Duration.seconds(5)

const makeExecutor = (db: Db, statementTimeout: Duration.Duration): Executor => {
	const maxWait = Duration.sum(statementTimeout, REPLY_GRACE)
	return {
		use: (operation, f) => settled(operation, maxWait, () => f(db)).pipe(Effect.withSpan(`db.${operation}`)),
		transaction: (operation, f) =>
			settled(operation, maxWait, (signal) =>
				db.transaction(async (tx) => {
					const result = await f(tx)
					// Interrupted while the statements ran: roll back instead of committing.
					if (signal.aborted) throw new RolledBack({ message: `${operation} was interrupted and rolled back` })
					return result
				}),
			).pipe(Effect.withSpan(`db.${operation}`)),
	}
}

/**
 * The Drizzle client over a pg connection pool. The pool is opened when the
 * layer is built and closed when the runtime is disposed.
 */
export class Database extends Context.Service<
	Database,
	Executor & {
		/**
		 * Runs `f` holding `source`'s session advisory lock on a dedicated connection (SourceBusy if
		 * taken). `f` writes through an Executor on that connection, so no write outlives the lock.
		 * Losing the connection interrupts `f` and fails with DatabaseError("sourceLock").
		 */
		readonly withSourceLock: <A, E, R>(
			source: string,
			f: (lock: Executor) => Effect.Effect<A, E, R>,
		) => Effect.Effect<A, E | SourceBusy | DatabaseError, R>
	}
>()("fundstats/server/db/Database") {
	static readonly layer = Layer.effect(
		Database,
		Effect.gen(function* () {
			const config = yield* AppConfig
			const services = yield* Effect.context<never>()
			// Every connection, pooled or holding a source lock, gets the statement
			// timeout, so a statement blocked on a lock fails instead of waiting forever.
			const connection = {
				connectionString: Redacted.value(config.databaseUrl),
				statement_timeout: Duration.toMillis(config.dbStatementTimeout),
			}
			const pool = yield* Effect.acquireRelease(
				Effect.sync(() => new pg.Pool({ ...connection, max: config.dbPoolMax })),
				(pool) => Effect.promise(() => pool.end()),
			)
			// An idle client error (e.g. Postgres restarted) must not crash the process.
			pool.on("error", (error) => {
				Effect.runForkWith(services)(Effect.logWarning("Postgres pool client error", error.message))
			})
			const db = drizzle(pool, { schema })

			yield* Effect.tryPromise({
				try: () => pool.query("select 1"),
				catch: toDatabaseError("connect"),
			})

			if (config.runMigrations) {
				yield* runMigrations(pool, config.migrationsDir)
			}

			// The lock lives on its own connection, not a pool slot, so DB_POOL_MAX=1
			// cannot deadlock and the run's writes are fenced by the lock's session.
			const withSourceLock = <A, E, R>(
				source: string,
				f: (lock: Executor) => Effect.Effect<A, E, R>,
			): Effect.Effect<A, E | SourceBusy | DatabaseError, R> =>
				Effect.acquireUseRelease(
					Effect.tryPromise({
						try: async () => {
							const client = new pg.Client(connection)
							const lost = Deferred.makeUnsafe<never, DatabaseError>()
							let releasing = false
							const onLost = (reason: string, cause?: unknown) => {
								if (releasing) return
								Deferred.doneUnsafe(
									lost,
									Exit.fail(
										new DatabaseError({
											operation: "sourceLock",
											message: `Lost the collection lock of ${source}: ${reason}`,
											cause,
										}),
									),
								)
							}
							// A dropped connection drops the lock too; it must stop the run, not crash the process.
							client.on("error", (error) => {
								Effect.runForkWith(services)(
									Effect.logWarning(`Collection lock connection of ${source} failed`, error.message),
								)
								onLost(error.message, error)
							})
							client.on("end", () => onLost("its database connection ended"))
							const release = () => {
								releasing = true
								return client.end().catch(() => {})
							}
							try {
								await client.connect()
								const result = await client.query<{ locked: boolean }>(
									"select pg_try_advisory_lock($1, hashtext($2)) as locked",
									[SOURCE_LOCK_CLASS, source],
								)
								return { client, lost, release, locked: result.rows[0]?.locked === true }
							} catch (error) {
								await release()
								throw error
							}
						},
						catch: toDatabaseError("lockSource"),
					}),
					({ client, lost, locked }): Effect.Effect<A, E | SourceBusy | DatabaseError, R> =>
						locked
							? Effect.raceFirst(
									f(makeExecutor(drizzle(client, { schema }), config.dbStatementTimeout)),
									Deferred.await(lost),
								)
							: Effect.fail(
									new SourceBusy({
										source,
										message: `another collection of ${source} is running (its lock is held)`,
									}),
								),
					// Ending the session releases the advisory lock.
					({ release }) => Effect.promise(release),
				)

			return Database.of({
				withSourceLock,
				...makeExecutor(db, config.dbStatementTimeout),
			})
		}),
	)
}

// First key of the per-source collection locks; the second is hashtext(source).
const SOURCE_LOCK_CLASS = 727_002

// Arbitrary constant; serializes migrations if two app processes boot at once.
const MIGRATION_LOCK_ID = 727_001

/** Applies the drizzle-kit SQL migrations in `dir`, holding an advisory lock. */
const runMigrations = (pool: pg.Pool, dir: string) =>
	Effect.tryPromise({
		try: async () => {
			const client = await pool.connect()
			try {
				// Waiting for another process's migrations, or a long migration, is fine.
				await client.query("set statement_timeout = 0")
				await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID])
				await migrate(drizzle(client), { migrationsFolder: dir })
			} finally {
				await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {})
				// Back to the connection's own statement timeout before it returns to the pool.
				await client.query("reset statement_timeout").catch(() => {})
				client.release()
			}
		},
		catch: toDatabaseError("migrate"),
	}).pipe(Effect.tap(() => Effect.logInfo(`Database migrations applied from ${dir}`)))
