import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import { defineConfig } from "vite-plus"

const GENERATED = ["src/routeTree.gen.ts", "drizzle/meta/**"]
// shadcn components are copied in as-is and updated by its CLI.
const VENDORED = ["src/components/ui/**", ".repos/**"]

export default defineConfig({
	resolve: { tsconfigPaths: true },
	server: { port: Number(process.env.PORT ?? 3000), strictPort: false },
	plugins: [
		devtools(),
		nitro({
			preset: "node-server",
			// Boots the backend at process start and exits non-zero if that fails.
			plugins: ["./src/server/boot.ts"],
		}),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
	fmt: {
		useTabs: true,
		printWidth: 120,
		semi: false,
		sortImports: {},
		sortTailwindcss: {},
		sortPackageJson: {},
		ignorePatterns: [...GENERATED, ...VENDORED, "test/fixtures/**", "public/**", "bun.lock", ".output/**"],
	},
	lint: {
		ignorePatterns: [...GENERATED, ...VENDORED, ".output/**"],
		plugins: ["eslint", "oxc", "react", "unicorn", "typescript"],
		jsPlugins: ["./oxlint-plugin-fundstats/index.ts"],
		categories: {
			correctness: "error",
			suspicious: "error",
			perf: "error",
		},
		rules: {
			"oxc/no-accumulating-spread": "error",
			"eslint/no-control-regex": "off",
			"typescript/no-this-alias": "off",
			"unicorn/prefer-add-event-listener": "off",
			"unicorn/prefer-string-starts-ends-with": "off",
			"unicorn/prefer-set-has": "off",
			"unicorn/prefer-array-find": "off",
			"unicorn/no-new-array": "off",
			"unicorn/no-array-reverse": "off",
			"react/no-object-type-as-default-prop": "off",
			"react/jsx-no-constructed-context-values": "off",
			"react/no-array-index-key": "error",
			"react/no-unstable-nested-components": "error",
			"typescript/no-extraneous-class": "error",
			"eslint/no-empty-pattern": "error",
			"eslint/no-new": "error",
			"unicorn/no-useless-spread": "error",
			"eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
			],
			"eslint/no-unsafe-optional-chaining": "error",
			"eslint/no-unneeded-ternary": "error",
			"unicorn/no-useless-fallback-in-spread": "error",
			"unicorn/require-module-specifiers": "error",
			"unicorn/no-array-sort": "off",
			"unicorn/consistent-function-scoping": "off",
			"oxc/no-map-spread": "off",
			"react-in-jsx-scope": "off",
			"react-hooks/exhaustive-deps": "off",
			"eslint/no-shadow": "off",
			"eslint/no-await-in-loop": "off",
			"eslint/no-underscore-dangle": "off",
			"typescript/consistent-return": "off",
			"typescript/no-base-to-string": "off",
			"typescript/no-duplicate-type-constituents": "off",
			"typescript/no-floating-promises": "off",
			"typescript/no-implied-eval": "off",
			"typescript/no-meaningless-void-operator": "off",
			"typescript/no-redundant-type-constituents": "off",
			"typescript/no-unnecessary-boolean-literal-compare": "off",
			"typescript/no-unnecessary-type-conversion": "off",
			"typescript/no-unnecessary-type-arguments": "off",
			"typescript/no-unnecessary-type-assertion": "off",
			"typescript/no-unnecessary-type-parameters": "off",
			"typescript/no-unsafe-type-assertion": "off",
			"typescript/await-thenable": "off",
			"typescript/require-array-sort-compare": "off",
			"typescript/restrict-template-expressions": "off",
			"typescript/unbound-method": "off",
			"eslint/no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "effect",
							message: 'Import each Effect module as a namespace: import * as Effect from "effect/Effect".',
						},
					],
				},
			],
			"fundstats/namespace-node-imports": "error",
			"fundstats/no-global-process-runtime": "error",
			"fundstats/no-inline-schema-compile": "error",
			"fundstats/no-low-value-comments": "error",
			"fundstats/no-manual-effect-runtime-in-tests": "error",
			"fundstats/no-polling-loop-in-tests": "error",
			"fundstats/no-real-time-wait-in-tests": "error",
			"fundstats/no-test-in-loop": "error",
			"fundstats/no-test-timeout-or-unreasoned-skip": "error",
			"fundstats/no-wall-clock-in-tests": "error",
			"fundstats/prefer-catch-tags": "error",
			"fundstats/prefer-effect-fn": "error",
			"fundstats/require-suppression-reason": "error",
		},
		overrides: [
			{
				files: ["**/*.test.ts", "test/**", "oxlint-plugin-fundstats/test/**"],
				rules: { "fundstats/prefer-effect-fn": "off" },
			},
		],
		options: {
			reportUnusedDisableDirectives: "error",
			typeAware: true,
			typeCheck: true,
		},
	},
})
