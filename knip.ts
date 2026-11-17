import type { KnipConfig } from "knip"

const config: KnipConfig = {
	workspaces: {
		".": {
			entry: ["scripts/*.ts"],
			// bunfig.toml loads the install security scanner.
			ignoreDependencies: ["@socketsecurity/bun-security-scanner"],
		},
		"apps/web": {
			// Nitro loads these by path from vite.config.ts.
			entry: ["src/server/boot.ts", "src/server/api.ts"],
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
