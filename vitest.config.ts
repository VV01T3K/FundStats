import { defineConfig } from "vitest/config"

// Runs every workspace's tests; each workspace also runs its own with `vitest run`.
export default defineConfig({
	test: {
		projects: [
			"apps/*",
			"packages/*",
			{ test: { name: "oxlint-plugin-fundstats", include: ["oxlint-plugin-fundstats/**/*.test.ts"] } },
		],
	},
})
