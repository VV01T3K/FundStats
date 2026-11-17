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
			// The API is a Nitro route, so its pool lives in Nitro's module graph only; the boot plugin
			// waits for it at process start (exiting non-zero if that fails) and closes it with the server.
			handlers: [{ route: "/api/**", handler: "./src/server/api.ts" }],
			plugins: ["./src/server/boot.ts"],
		}),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
})
