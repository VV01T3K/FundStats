import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import pg from "pg"

import { DbConfig } from "./DbConfig.ts"
import * as schema from "./schema.ts"

type Db = NodePgDatabase<typeof schema>
/** A transaction handle; it has the same query API as `Db`. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

export class DatabaseError extends Schema.TaggedError<DatabaseError>()("DatabaseError", {
	operation: Schema.String,
	message: Schema.String,
	cause: Schema.Defect(),
}) {}

export const toDatabaseError = (operation: string) => (cause: unknown) =>
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

export const makeExecutor = (db: Db, statementTimeout: Duration.Duration): Executor => {
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

/** pg connection settings shared by the pool and dedicated sessions; every session gets the statement timeout. */
export const connectionConfig = (config: DbConfig["Service"]) => ({
	connectionString: Redacted.value(config.databaseUrl),
	statement_timeout: Duration.toMillis(config.dbStatementTimeout),
})

const make = Effect.fn("Database.make")(function* (options: { readonly readOnly: boolean }) {
	const config = yield* DbConfig
	const services = yield* Effect.context<never>()
	const pool = yield* Effect.acquireRelease(
		Effect.sync(
			() =>
				new pg.Pool({
					...connectionConfig(config),
					// Postgres rejects any write from these sessions, so the web app cannot change data.
					...(options.readOnly ? { options: "-c default_transaction_read_only=on" } : {}),
					max: config.dbPoolMax,
				}),
		),
		(pool) => Effect.promise(() => pool.end()),
	)
	// An idle client error (e.g. Postgres restarted) must not crash the process.
	pool.on("error", (error) => {
		Effect.runForkWith(services)(Effect.logWarning("Postgres pool client error", error.message))
	})

	yield* Effect.tryPromise({
		try: () => pool.query("select 1"),
		catch: toDatabaseError("connect"),
	})

	return Database.of(makeExecutor(drizzle(pool, { schema }), config.dbStatementTimeout))
})

/**
 * The Drizzle client over a pg connection pool. The pool is opened when the
 * layer is built and closed when the runtime is disposed.
 */
export class Database extends Context.Service<Database, Executor>()("@fundstats/db/Database") {
	static readonly layer = Layer.effect(Database, make({ readOnly: false }))
	/** Sessions that Postgres keeps read-only: the web app's pool. */
	static readonly layerReadOnly = Layer.effect(Database, make({ readOnly: true }))
}
