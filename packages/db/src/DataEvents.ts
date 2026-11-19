import * as PgClient from "@effect/sql-pg/PgClient"
import { sql } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Queue from "effect/Queue"
import * as Reactivity from "effect/reactivity/Reactivity"
import * as Schedule from "effect/Schedule"
import type * as SqlError from "effect/sql/SqlError"
import * as Stream from "effect/Stream"

import { clientOptions, type Db } from "./Database.ts"
import { DbConfig } from "./DbConfig.ts"

/** The Postgres channel a committed collection run is announced on; the payload is the source id. */
const DATA_CHANNEL = "fundstats_data"

/** How long the listener waits before reconnecting after its session failed. */
const RECONNECT_DELAY = Duration.seconds(5)

/**
 * Announces that `source` has new data. Postgres delivers it when `tx` commits and drops it on
 * rollback, so listeners never hear about rows they cannot read yet.
 */
export const announceData = (tx: Db, source: string) => tx.execute(sql`select pg_notify(${DATA_CHANNEL}, ${source})`)

/**
 * The sources whose data changed, as the collector commits them: one Postgres LISTEN session for the
 * whole process, fanned out to every subscriber. The web app streams it to open pages.
 */
export class DataEvents extends Context.Service<DataEvents, { readonly changes: Stream.Stream<string> }>()(
	"@fundstats/db/DataEvents",
) {
	static readonly layer = Layer.effect(
		DataEvents,
		Effect.gen(function* () {
			const config = yield* DbConfig
			const reactivity = yield* Reactivity.Reactivity
			const changes = yield* PubSub.unbounded<string>()
			const listening = yield* Deferred.make<void, SqlError.SqlError>()

			// Its own read-write session: LISTEN is refused in a read-only one, and it idles between runs,
			// so it opts out of idle_session_timeout (0 turns it off).
			const listen = Effect.gen(function* () {
				const session = yield* PgClient.makeClient(clientOptions(config, { idleSessionTimeout: Duration.zero })).pipe(
					Effect.provideService(Reactivity.Reactivity, reactivity),
				)
				const notifications = yield* session.listen(DATA_CHANNEL)
				yield* Effect.logInfo(`Listening for new data on ${DATA_CHANNEL}`)
				yield* Deferred.succeed(listening, undefined)
				return yield* Queue.take(notifications).pipe(
					Effect.flatMap((notification) => PubSub.publish(changes, notification.payload)),
					Effect.forever,
				)
			}).pipe(
				Effect.scoped,
				// A first connection that fails fails the layer (boot); a later loss reconnects.
				Effect.tapCause((cause) =>
					Deferred.failCause(listening, cause).pipe(
						Effect.flatMap((first) =>
							first ? Effect.void : Effect.logWarning("Data listener lost its session; reconnecting", cause),
						),
					),
				),
				Effect.retry(Schedule.spaced(RECONNECT_DELAY)),
			)
			yield* Effect.forkScoped(listen)
			// Ready once LISTEN is registered, so no run committed after the layer is built goes unheard.
			yield* Deferred.await(listening)

			return DataEvents.of({ changes: Stream.fromPubSub(changes) })
		}),
	).pipe(Layer.provide(Reactivity.layer))
}
