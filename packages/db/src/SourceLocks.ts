import * as PgClient from "@effect/sql-pg/PgClient"
import { sql } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Reactivity from "effect/reactivity/Reactivity"
import * as Schema from "effect/Schema"

import { clientOptions, type DatabaseError, type Db, drizzleOn } from "./Database.ts"
import { DbConfig } from "./DbConfig.ts"

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
		 * Runs `f` holding `source`'s session advisory lock (SourceBusy if taken). The lock lives on a
		 * session of its own, not a pool slot, and `f` gets a Drizzle database on that one session: its
		 * writes go through the lock's session, so once that session is gone (and the lock with it) every
		 * further write fails. Ending the session at the end releases the lock.
		 */
		readonly withSourceLock: <A, E, R>(
			source: string,
			f: (lock: Db) => Effect.Effect<A, E, R>,
		) => Effect.Effect<A, E | SourceBusy | DatabaseError, R>
	}
>()("@fundstats/db/SourceLocks") {
	static readonly layer = Layer.effect(
		SourceLocks,
		Effect.gen(function* () {
			const config = yield* DbConfig
			const reactivity = yield* Reactivity.Reactivity

			const withSourceLock = Effect.fn("SourceLocks.withSourceLock")(
				function* <A, E, R>(source: string, f: (lock: Db) => Effect.Effect<A, E, R>) {
					const session = yield* PgClient.makeClient(clientOptions(config)).pipe(
						Effect.provideService(Reactivity.Reactivity, reactivity),
					)
					const lock = yield* drizzleOn(session)
					const { rows } = yield* lock.execute<{ locked: boolean }>(
						sql`select pg_try_advisory_lock(${SOURCE_LOCK_CLASS}, hashtext(${source})) as locked`,
					)
					if (rows[0]?.locked !== true) {
						return yield* new SourceBusy({
							source,
							message: `another collection of ${source} is running (its lock is held)`,
						})
					}
					return yield* f(lock)
				},
				// Closing the scope ends the session, which releases the lock.
				Effect.scoped,
			)

			return SourceLocks.of({ withSourceLock })
		}),
	).pipe(Layer.provide(Reactivity.layer))
}
