import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import * as Effect from "effect/Effect"
import pg from "pg"

import { connectionConfig, toDatabaseError } from "./Database.ts"
import { DbConfig } from "./DbConfig.ts"

/** The drizzle-kit migrations shipped with this package. */
export const migrationsFolder = `${import.meta.dirname}/../drizzle`

// Arbitrary constant; serializes migrations if two processes start at once.
const MIGRATION_LOCK_ID = 727_001

/** Applies the drizzle-kit SQL migrations in `dir`, holding an advisory lock. */
export const runMigrations = Effect.fn("Migrations.run")(function* (dir: string) {
	const config = yield* DbConfig
	yield* Effect.tryPromise({
		try: async () => {
			// Waiting for another process's migrations, or a long migration, is fine.
			const client = new pg.Client({ ...connectionConfig(config), statement_timeout: 0 })
			await client.connect()
			try {
				await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID])
				await migrate(drizzle(client), { migrationsFolder: dir })
			} finally {
				// Ending the session releases the advisory lock.
				await client.end()
			}
		},
		catch: toDatabaseError("migrate"),
	})
	yield* Effect.logInfo(`Database migrations applied from ${dir}`)
})
