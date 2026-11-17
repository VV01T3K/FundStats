import * as PgClient from "@effect/sql-pg/PgClient"
import { sql } from "drizzle-orm"
import { migrate } from "drizzle-orm/effect-postgres/migrator"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Reactivity from "effect/reactivity/Reactivity"

import { clientOptions, drizzleOn } from "./Database.ts"
import { DbConfig } from "./DbConfig.ts"

/** The drizzle-kit migrations shipped with this package. */
export const migrationsFolder = `${import.meta.dirname}/../drizzle`

// Arbitrary constant; serializes migrations if two processes start at once.
const MIGRATION_LOCK_ID = 727_001

/** Applies the drizzle-kit SQL migrations in `dir` on a session of its own, holding an advisory lock. */
export const runMigrations = Effect.fn("Migrations.run")(
	function* (dir: string) {
		const config = yield* DbConfig
		// Waiting for another process's migrations, or a long migration, is fine: no statement timeout.
		const session = yield* PgClient.makeClient(clientOptions(config, { statementTimeout: Duration.zero }))
		const db = yield* drizzleOn(session)
		yield* db.execute(sql`select pg_advisory_lock(${MIGRATION_LOCK_ID})`)
		yield* migrate(db, { migrationsFolder: dir })
		yield* Effect.logInfo(`Database migrations applied from ${dir}`)
	},
	// Ending the session releases the advisory lock.
	Effect.scoped,
	Effect.provide(Reactivity.layer),
)
