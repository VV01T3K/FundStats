import * as PgClient from "@effect/sql-pg/PgClient"
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import * as PgDrizzle from "drizzle-orm/effect-postgres"
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Reactivity from "effect/reactivity/Reactivity"
import type * as SqlError from "effect/sql/SqlError"

import { DbConfig } from "./DbConfig.ts"
import { collectionRuns, instruments, rawPayloads, snapshots, sourceSchedules } from "./schema.ts"

/** Drizzle's Effect query builder over one Effect SQL client: the pool, or one dedicated session. */
export type Db = PgDrizzle.EffectPgDatabase

/** A failed query; Drizzle wraps the driver's SqlError. */
export type QueryError = EffectDrizzleQueryError

/** A failed query or a failed transaction control statement (BEGIN, COMMIT). */
export type DatabaseError = QueryError | SqlError.SqlError

/** The pool retires a connection idle this long, checking once per period (effect/Pool "usage" TTL). */
const POOL_IDLE_TIMEOUT = Duration.seconds(60)

/**
 * Postgres ends a session idle (outside a transaction) this long. Above the pool's own retirement, which
 * takes up to twice POOL_IDLE_TIMEOUT, so it never closes a healthy pooled connection; it ends a session
 * whose client still awaits a reply Postgres already sent, such as a COMMIT ack lost in transit.
 */
const IDLE_SESSION_TIMEOUT = Duration.times(POOL_IDLE_TIMEOUT, 3)

/**
 * PgClient settings for the pool and for dedicated sessions. Every session gets the statement timeout
 * in its startup packet, so a statement blocked on a lock fails instead of waiting forever.
 */
export const clientOptions = (
	config: DbConfig["Service"],
	settings: {
		readonly statementTimeout?: Duration.Duration
		readonly idleSessionTimeout?: Duration.Duration
		readonly readOnly?: boolean
	} = {},
) => ({
	url: config.databaseUrl,
	// One statement at a time per session, so interrupting one can cancel it.
	multiplex: false,
	// TCP keepalive fails a session whose peer vanished while we await a reply, e.g. a lost COMMIT ack,
	// which nothing else can end: COMMIT is uninterruptible. A live peer that answers probes is not covered.
	keepAlive: Duration.seconds(10),
	startupParameters: {
		statement_timeout: String(Duration.toMillis(settings.statementTimeout ?? config.dbStatementTimeout)),
		idle_session_timeout: String(Duration.toMillis(settings.idleSessionTimeout ?? IDLE_SESSION_TIMEOUT)),
		...(settings.readOnly ? { default_transaction_read_only: "on" } : {}),
	},
})

/** A Drizzle database on `client`. */
export const drizzleOn = (client: PgClient.PgClient) =>
	PgDrizzle.makeWithDefaults().pipe(Effect.provideService(PgClient.PgClient, client))

const make = Effect.fn("Database.make")(function* (options: { readonly readOnly: boolean }) {
	const config = yield* DbConfig
	const client = yield* PgClient.make({
		...clientOptions(config, { readOnly: options.readOnly }),
		maxConnections: config.dbPoolMax,
		idleTimeout: POOL_IDLE_TIMEOUT,
	})
	// Fail at boot, not on the first request, when Postgres is unreachable or not migrated to this schema.
	yield* client`select 1`
	const db = yield* drizzleOn(client)
	yield* Effect.forEach(
		[collectionRuns, rawPayloads, instruments, snapshots, sourceSchedules],
		(table) => db.select().from(table).limit(0),
		{ discard: true },
	).pipe(
		Effect.tapError(() =>
			Effect.logError("The database does not match this version's schema; run the migrate command"),
		),
	)
	return db
})

/** The connection pool, opened when the layer is built and closed with it. */
export class Database extends Context.Service<Database, Db>()("@fundstats/db/Database") {
	static readonly layer = Layer.effect(Database, make({ readOnly: false })).pipe(Layer.provide(Reactivity.layer))
	/** Sessions Postgres keeps read-only (default_transaction_read_only): the web app's pool. */
	static readonly layerReadOnly = Layer.effect(Database, make({ readOnly: true })).pipe(Layer.provide(Reactivity.layer))
}
