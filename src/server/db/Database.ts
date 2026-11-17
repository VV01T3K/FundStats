import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Context, Effect, Layer, Redacted, Schema } from "effect"
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

/**
 * The Drizzle client over a pg connection pool. The pool is opened when the
 * layer is built and closed when the runtime is disposed.
 */
export class Database extends Context.Service<
	Database,
	{
		readonly db: Db
		/** Runs a Drizzle query, mapping any failure to DatabaseError. */
		readonly use: <A>(operation: string, f: (db: Db) => Promise<A>) => Effect.Effect<A, DatabaseError>
		readonly transaction: <A>(operation: string, f: (tx: Tx) => Promise<A>) => Effect.Effect<A, DatabaseError>
		/**
		 * Runs `effect` while holding the collection lock of `source`: a
		 * session-level Postgres advisory lock on a dedicated connection, so it
		 * serializes collections across processes (app, CLI, replicas). Fails
		 * with SourceBusy instead of waiting when another session holds it. The
		 * lock is released when `effect` ends, or by Postgres if the process dies.
		 */
		readonly withSourceLock: <A, E, R>(
			source: string,
			effect: Effect.Effect<A, E, R>,
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

			// The lock lives on its own connection, not a pool slot: a run holds it
			// while its queries use the pool, so DB_POOL_MAX=1 cannot deadlock.
			const withSourceLock = <A, E, R>(
				source: string,
				effect: Effect.Effect<A, E, R>,
			): Effect.Effect<A, E | SourceBusy | DatabaseError, R> =>
				Effect.acquireUseRelease(
					Effect.tryPromise({
						try: async () => {
							const client = new pg.Client({ connectionString: Redacted.value(config.databaseUrl) })
							// A dropped connection also drops the lock; it must not crash the process.
							client.on("error", (error) => {
								Effect.runFork(Effect.logWarning(`Collection lock connection of ${source} failed`, error.message))
							})
							try {
								await client.connect()
								const result = await client.query<{ locked: boolean }>(
									"select pg_try_advisory_lock($1, hashtext($2)) as locked",
									[SOURCE_LOCK_CLASS, source],
								)
								return { client, locked: result.rows[0]?.locked === true }
							} catch (error) {
								await client.end().catch(() => {})
								throw error
							}
						},
						catch: toDatabaseError("lockSource"),
					}),
					({ locked }): Effect.Effect<A, E | SourceBusy, R> =>
						locked
							? effect
							: Effect.fail(
									new SourceBusy({
										source,
										message: `another collection of ${source} is running (its lock is held)`,
									}),
								),
					// Ending the session releases the advisory lock.
					({ client }) => Effect.promise(() => client.end().catch(() => {})),
				)

			return Database.of({
				db,
				withSourceLock,
				use: (operation, f) =>
					Effect.tryPromise({ try: () => f(db), catch: toDatabaseError(operation) }).pipe(
						Effect.withSpan(`db.${operation}`),
					),
				transaction: (operation, f) =>
					Effect.tryPromise({
						try: () => db.transaction((tx) => f(tx)),
						catch: toDatabaseError(operation),
					}).pipe(Effect.withSpan(`db.${operation}`)),
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
