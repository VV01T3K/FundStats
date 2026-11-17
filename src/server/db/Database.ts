import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Context, Deferred, Effect, Exit, Layer, Redacted, Schema } from "effect"
import pg from "pg"
import { AppConfig } from "../config.ts"
import * as schema from "./schema.ts"

export type Db = NodePgDatabase<typeof schema>
/** A transaction handle; it has the same query API as `Db`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

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
 * Runs a promise that cannot be cancelled. An interruption aborts `signal`
 * and then waits for the promise to settle, so the database work it started
 * has finished (committed or rolled back) before the fiber ends.
 */
const settled = <A>(operation: string, run: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, DatabaseError> =>
	Effect.callback<A, DatabaseError>((resume) => {
		const controller = new AbortController()
		let promise: Promise<A>
		try {
			promise = run(controller.signal)
		} catch (error) {
			promise = Promise.reject(error)
		}
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
		})
	})

class RolledBack extends Error {}

const makeExecutor = (db: Db): Executor => ({
	use: (operation, f) => settled(operation, () => f(db)).pipe(Effect.withSpan(`db.${operation}`)),
	transaction: (operation, f) =>
		settled(operation, (signal) =>
			db.transaction(async (tx) => {
				const result = await f(tx)
				// Interrupted while the statements ran: roll back instead of committing.
				if (signal.aborted) throw new RolledBack(`${operation} was interrupted and rolled back`)
				return result
			}),
		).pipe(Effect.withSpan(`db.${operation}`)),
})

/**
 * The Drizzle client over a pg connection pool. The pool is opened when the
 * layer is built and closed when the runtime is disposed.
 */
export class Database extends Context.Service<
	Database,
	Executor & {
		/**
		 * Runs `f` while holding the collection lock of `source`: a
		 * session-level Postgres advisory lock on a dedicated connection, so it
		 * serializes collections across processes (app, CLI, replicas). Fails
		 * with SourceBusy instead of waiting when another session holds it.
		 *
		 * `f` gets an Executor bound to that same connection; a collection does
		 * all its writes through it. The lock exists exactly as long as the
		 * connection does, so once Postgres frees the lock (connection lost or
		 * terminated) no further write of this run can succeed, and a
		 * transaction cut off mid-way is rolled back. Losing the connection also
		 * interrupts `f` and fails with a DatabaseError (operation
		 * "sourceLock"). The lock is released when `f` ends.
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
			const pool = yield* Effect.acquireRelease(
				Effect.sync(
					() =>
						new pg.Pool({
							connectionString: Redacted.value(config.databaseUrl),
							max: config.dbPoolMax,
						}),
				),
				(pool) => Effect.promise(() => pool.end()),
			)
			// An idle client error (e.g. Postgres restarted) must not crash the process.
			pool.on("error", (error) => {
				Effect.runFork(Effect.logWarning("Postgres pool client error", error.message))
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
							const client = new pg.Client({ connectionString: Redacted.value(config.databaseUrl) })
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
								Effect.runFork(Effect.logWarning(`Collection lock connection of ${source} failed`, error.message))
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
							? Effect.raceFirst(f(makeExecutor(drizzle(client, { schema }))), Deferred.await(lost))
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
				...makeExecutor(db),
			})
		}),
	)
}

// First key of the per-source collection locks; the second is hashtext(source).
const SOURCE_LOCK_CLASS = 727_002

// Arbitrary constant; serializes migrations if two app processes boot at once.
const MIGRATION_LOCK_ID = 727_001

/** Applies the drizzle-kit SQL migrations in `dir`, holding an advisory lock. */
export const runMigrations = (pool: pg.Pool, dir: string) =>
	Effect.tryPromise({
		try: async () => {
			const client = await pool.connect()
			try {
				await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID])
				await migrate(drizzle(client), { migrationsFolder: dir })
			} finally {
				await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {})
				client.release()
			}
		},
		catch: toDatabaseError("migrate"),
	}).pipe(Effect.tap(() => Effect.logInfo(`Database migrations applied from ${dir}`)))
