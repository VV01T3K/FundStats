# syntax=docker/dockerfile:1
# Two images from one build: `--target web` and `--target collector`. compose.yaml builds both.

ARG BUN_SLIM=oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4
ARG BUN_DISTROLESS=oven/bun:1.4.4-distroless@sha256:153a951ae40106e125898103e6e990ee0f38e6aee7f561029e26cf9fbed23470

# ---- build: one full install, the web app's Nitro bundle and the collector's bundle ----
FROM ${BUN_SLIM} AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY apps/web/package.json apps/web/
COPY apps/collector/package.json apps/collector/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# ---- web: SSR pages and the read-only API ----
FROM ${BUN_DISTROLESS} AS web
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build /app/apps/web/.output ./.output
# The images' entrypoint is bun; run as distroless's unprivileged user.
USER 65532:65532
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["/usr/local/bin/bun", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD [".output/server/index.mjs"]

# ---- collector: every source on its schedule; `collector.js migrate` applies the migrations ----
FROM ${BUN_DISTROLESS} AS collector
ENV NODE_ENV=production \
    MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
COPY --from=build /app/apps/collector/dist/main.js ./collector.js
COPY --from=build /app/packages/db/drizzle ./drizzle
USER 65532:65532
CMD ["collector.js", "start"]
