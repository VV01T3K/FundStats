import type { KnipConfig } from "knip"

const config: KnipConfig = {
	workspaces: {
		".": {
			entry: ["scripts/*.ts", "oxlint-plugin-fundstats/index.ts"],
			project: ["*.ts", "scripts/**/*.ts", "oxlint-plugin-fundstats/**/*.ts"],
		},
		"apps/web": {
			entry: ["src/server/boot.ts"],
			project: ["**/*.{ts,tsx,css}"],
			// shadcn components are copied whole; keep their exports even before they have callers.
			ignoreIssues: { "src/components/ui/*.tsx": ["exports"] },
		},
		"apps/collector": {
			entry: ["src/bin.ts"],
			project: ["**/*.ts"],
		},
		"packages/*": {
			project: ["**/*.ts"],
		},
	},
	// effect-tsgo bundles the Effect language service that tsconfig.effect.json configures.
	ignoreDependencies: ["@effect/language-service"],
	compilers: {
		// Tailwind's stylesheet pulls packages in with `@import`.
		css: (text: string) => [...text.matchAll(/(?<=@)import[^;]+/g)].join("\n"),
	},
}

export default config
