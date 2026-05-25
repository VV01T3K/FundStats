import { defineConfig } from "vite-plus";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";

import { tanstackStart } from "@tanstack/solid-start/plugin/vite";

import solidPlugin from "vite-plugin-solid";
import { nitro } from "nitro/vite";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    tanstackRouter({ target: "solid", quoteStyle: "double", semicolons: true }),
    nitro(),
    tailwindcss(),
    tanstackStart(),
    solidPlugin({ ssr: true }),
  ],
});
