import { defineConfig } from "vitest/config"

export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		name: "db",
		include: ["test/**/*.test.ts"],
		globalSetup: ["../../packages/db/test/postgres.ts"],
		testTimeout: 30_000,
		hookTimeout: 120_000,
	},
})
