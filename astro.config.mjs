import { defineConfig } from "astro/config";
import sentry from "@sentry/astro";
import spotlightjs from "@spotlightjs/astro";
import vercel from "@astrojs/vercel/serverless";
import solidJs from "@astrojs/solid-js";
import icon from "astro-icon";

import react from "@astrojs/react";

// https://astro.build/config
export default defineConfig({
  integrations: [sentry(), spotlightjs(), solidJs(), icon(), react()],
  output: "hybrid",
  adapter: vercel()
});