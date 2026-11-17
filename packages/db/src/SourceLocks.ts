import { drizzle } from "drizzle-orm/node-postgres"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import pg from "pg"

import { connectionConfig, DatabaseError, type Executor, makeExecutor, toDatabaseError } from "./Database.ts"
import { DbConfig } from "./DbConfig.ts"
import * as schema from "./schema.ts"

/** Another process (or fiber) is already collecting this source. */
export class SourceBusy extends Schema.TaggedError<SourceBusy>()("SourceBusy", {
	source: Schema.String,
	message: Schema.String,
}) {}

// First key of the per-source collection locks; the second is hashtext(source).
const SOURCE_LOCK_CLASS = 727_002

/** The per-source Postgres session advisory locks that keep two collections of one source apart. */
export class SourceLocks extends Context.Service<
	SourceLocks,
	{
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
>()("@fundstats/db/SourceLocks") {
	static readonly layer = Layer.effect(
		SourceLocks,
		Effect.gen(function* () {
			const config = yield* DbConfig
			const services = yield* Effect.context<never>()
			const connection = connectionConfig(config)

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

			return SourceLocks.of({ withSourceLock })
		}),
	)
}
