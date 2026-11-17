import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import { defineConfig } from "vite"

export default defineConfig({
	resolve: { tsconfigPaths: true },
	// `.env` lives at the repository root, next to the collector's.
	envDir: "../..",
	server: { port: Number(process.env.PORT ?? 3000), strictPort: false },
	plugins: [
		devtools(),
		nitro({
			preset: "bun",
			// Boots the backend at process start and exits non-zero if that fails.
			plugins: ["./src/server/boot.ts"],
		}),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
})
