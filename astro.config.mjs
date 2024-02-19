import { defineConfig } from "astro/config";
import sentry from "@sentry/astro";
import spotlightjs from "@spotlightjs/astro";
import vercel from "@astrojs/vercel/serverless";
import solidJs from "@astrojs/solid-js";
import icon from "astro-icon";
import react from "@astrojs/react";

import tailwind from "@astrojs/tailwind";

// https://astro.build/config
export default defineConfig({
  integrations: [sentry(), spotlightjs(), solidJs(), icon(), react(), tailwind()],
  output: "hybrid",
  adapter: vercel()
});