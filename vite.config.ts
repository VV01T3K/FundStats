import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import { defineConfig } from "vite"

export default defineConfig({
	resolve: { tsconfigPaths: true },
	server: { port: Number(process.env.PORT ?? 3000), strictPort: false },
	plugins: [devtools(), nitro({ preset: "node-server" }), tailwindcss(), tanstackStart(), viteReact()],
})
