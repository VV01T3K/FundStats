import { defineConfig } from "vitest/config"

export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		include: ["test/**/*.test.ts", "oxlint-plugin-fundstats/**/*.test.ts"],
		globalSetup: ["test/setup/postgres.ts"],
		// Tests never call live upstreams; the collector is never started.
		env: { COLLECTOR_ENABLED: "false" },
		testTimeout: 30_000,
		hookTimeout: 120_000,
	},
})
