# Agents

## Cursor Cloud specific instructions

### Project Overview

CryptoStats (`crypto-dad`) is an Astro SSR web application that displays cryptocurrency and investment fund data from external APIs (CoinPaprika, CoinMarketCap, mBank). No database or API keys are required — all data is fetched live at request time.

### Development Environment

- **Runtime:** Bun (primary), Node.js 22
- **Package manager:** Bun (`bun install` — lockfile is `bun.lockb`)
- **Framework:** Astro 5.x with SolidJS, TailwindCSS, HTMX
- **Deployment target:** Vercel (via `@astrojs/vercel` adapter)

### Running the Dev Server

```sh
bunx --bun astro dev
```

Server starts on `http://localhost:4321/`. Use `--host 0.0.0.0` if you need network access.

### Type Checking and Linting

```sh
bunx --bun astro check
```

Note: There is a pre-existing type error in `src/lib/myutils.ts` (Buffer type incompatibility) and unused import warnings. These are not regressions from new changes.

### Building

```sh
bunx --bun astro build
```

The build uses the Vercel adapter (`output: "server"`). The build output goes to `.vercel/output/` and `dist/`. A Vercel warning about Node.js version is expected and harmless for local development.

### Key Caveats

- The `@vercel/speed-insights` package has a postinstall script. After `bun install`, run `bun pm trust @vercel/speed-insights` if it was blocked (Bun blocks untrusted postinstall by default).
- The app fetches data from external APIs on every request; no `.env` file is needed.
- HTMX partial page updates are used for switching between data views (CoinPaprika, CoinMarketCap, mBank Funds). The HTMX library is loaded from CDN.
- Images are cached to `public/cache/` on the filesystem.
