import { defineConfig } from "astro/config";
import solidJs from "@astrojs/solid-js";
import tailwind from "@astrojs/tailwind";
import icon from "astro-icon";
import mdx from "@astrojs/mdx";

import vercel from "@astrojs/vercel/serverless";

// https://astro.build/config
export default defineConfig({
    integrations: [
        solidJs(),
        tailwind({
            applyBaseStyles: false,
        }),
        icon(),
        mdx(),
    ],
    output: "hybrid",
    adapter: vercel(),
});
