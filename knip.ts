import type { KnipConfig } from "knip"

const config: KnipConfig = {
	entry: ["src/server/boot.ts", "src/server/cli/*.ts", "scripts/*.ts"],
	project: ["**/*.{ts,tsx,css}"],
	// shadcn components are copied whole; keep their exports even before they have callers.
	ignoreIssues: { "src/components/ui/*.tsx": ["exports"] },
	// effect-tsgo bundles the Effect language service that tsconfig.effect.json configures.
	ignoreDependencies: ["@effect/language-service"],
	compilers: {
		// Tailwind's stylesheet pulls packages in with `@import`.
		css: (text: string) => [...text.matchAll(/(?<=@)import[^;]+/g)].join("\n"),
	},
}

export default config
