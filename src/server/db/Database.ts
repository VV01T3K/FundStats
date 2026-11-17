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

			return Database.of({
				db,
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
