declare module "vitest" {
	export interface ProvidedContext {
		databaseUrl: string
	}
}

/** Key under which the global setup (postgres.ts) provides the test database's URL. */
export const DATABASE_URL = "databaseUrl"
