# FundStats

Ranked tables of returns for mBank investment funds and the top cryptocurrencies (CoinGecko, CoinPaprika,
CoinMarketCap).

A collector process calls the providers' APIs on a schedule and stores the results in Postgres. The web app serves
every page and API response from that database, so visitors never trigger upstream calls.

## Stack

- **Runtime**: Bun 1.4.4 for both apps, the tests and the tooling.
- **Web** (`apps/web`): TanStack Start (React 19, Vite 8, Nitro `bun` preset), TanStack Router (typed, validated
  search params), TanStack Query (SSR-prefetched), TanStack Table v9, shadcn/ui on Tailwind 4, and an Effect 4
  `HttpApi` served under `/api`. Read-only.
- **Collector** (`apps/collector`): an Effect 4 process on `@effect/platform-bun` with an Effect CLI: schedules,
  upstream sources, writes, migrations.
- **Database** (`packages/db`): Postgres 18. Drizzle 1.0 RC's Effect Postgres driver over `@effect/sql-pg`
  (Effect SQL's native wire-protocol client), with the Drizzle query builder; drizzle-kit migrations.
- **Tooling**: bun workspaces with a version catalog, TypeScript 7 checked by `@effect/tsgo` (Effect language
  service), oxlint (type-aware, with the local `oxlint-plugin-fundstats`), oxfmt, knip, Vitest with
  `@effect/vitest` run under Bun, testcontainers.

## Layout

```
apps/
  web/                 TanStack Start app: pages and the read-only HTTP API
    src/routes/          file routes; routes/api/$.ts mounts the Effect API
    src/web/             typed API client, table configs, components
    src/server/          API handlers, the Nitro /api route and boot plugin (read-only pool)
  collector/           the collector process
    src/main.ts          entry point (Bun runtime)
    src/cli.ts           commands: start, collect <source|all>, migrate
    src/Collector.ts     runs one source: fetch, decode, normalize, persist; keeps a rejected response
    src/Scheduler.ts     every source on its interval; records the schedule for the web app
    src/sources/         one file per upstream
packages/
  db/                  Drizzle schema, migrations (drizzle/), SQL client, Store (reads), RunStore (writes),
                       SourceLocks, Migrations; test/ has the Postgres test setup shared by the workspaces
  shared/              source catalog, metric names and formulas, the HttpApi contract
oxlint-plugin-fundstats/  custom lint rules, ported from t3code (MIT)
scripts/               `bun run sync:repos`
.repos/                git-ignored reference source for agents (Effect at the installed version)
```

The web app imports only `Store` and the read-only pool from `packages/db`; its sessions are opened with
`default_transaction_read_only=on`, so Postgres rejects any write from them. It learns each source's interval and
whether collection is enabled from the `source_schedules` table, which the collector writes when it starts.

## Run locally

Requires Bun 1.4.4 and Docker.

```sh
bun install
cp .env.example .env                         # DATABASE_URL points to the dev database below
docker compose -f compose.dev.yaml up -d     # Postgres on 127.0.0.1:55432 (FUNDSTATS_DB_PORT changes the port)
bun run db:migrate                           # apply the migrations
bun run collect all                          # fetch every source once
bun run dev                                  # web on http://localhost:3000 (PORT changes it) + the collector
```

`bun run dev` runs the web dev server and the collector (`bun --watch`, restarted on change) side by side. The
collector decides when each source is due from its last run in the database, so a restart does not call the
upstreams again early. To work without calling the upstreams, set `COLLECTOR_ENABLED=false`.

Migrations have one owner: the `migrate` command (`bun run db:migrate`, the `migrate` service in Compose). The web
app and the collector only check at start that the database has the schema they were built for, and exit with
status 1 if it does not. Run `bun run db:migrate` again after pulling a schema change.

The API is a Nitro route (`apps/web/src/server/api.ts`); pages call it in-process during SSR. In dev, an edit under
`apps/web/src/server/` reloads that module, which closes the API it replaces, so there is one connection pool at a
time.

### Scripts

| Command                | What it does                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `bun run dev`          | Web dev server with HMR and the collector in watch mode                                 |
| `bun run build`        | Web production build to `apps/web/.output/`, collector bundle to `apps/collector/dist/` |
| `bun run start`        | Run the web production build (`bun .output/server/index.mjs`)                           |
| `bun run collector`    | Run the collector: every source on its schedule                                         |
| `bun run collect <id>` | Run one source once: `mbank`, `coingecko`, `coinpaprika`, `coinmarketcap`, or `all`     |
| `bun run db:migrate`   | Apply migrations                                                                        |
| `bun run db:generate`  | Generate a migration after changing `packages/db/src/schema.ts`                         |
| `bun run check`        | Format check (oxfmt), lint (oxlint), typecheck (effect-tsgo) and knip                   |
| `bun run fmt`          | Format every file (oxfmt)                                                               |
| `bun run lint`         | oxlint only                                                                             |
| `bun run typecheck`    | effect-tsgo for the root and every workspace                                            |
| `bun run test`         | Vitest under Bun for every workspace and the lint rules; starts Postgres containers     |
| `bun run sync:repos`   | Shallow-clone Effect at the installed version into `.repos/effect` for reference        |

Each workspace also has its own `typecheck` and `test` (`bun run --filter @fundstats/db test`). CI runs
`bun install --frozen-lockfile`, `bun audit`, `check`, `test` and `build` on every pull request. See `AGENTS.md`
for code conventions.

Shared dependency versions live in the root `package.json` catalog (`"catalog:"` in a workspace). `bunfig.toml`
uses isolated installs, skips package versions published in the last three days, and checks installs with the
Socket security scanner.

The tests never call a live upstream. They read saved samples from `apps/collector/test/fixtures/`. Each workspace
with database tests starts its own throwaway Postgres container. To use an existing empty database instead, set
`TEST_DATABASE_URL` and run one workspace at a time (the tests truncate its tables).

## Deploy (Docker Compose)

`compose.yaml` runs Postgres, a one-shot `migrate` service, `web` and `collector`. Both app images come from one
multi-target `Dockerfile` (a Debian-slim Bun builder, distroless Bun runtimes); `migrate` runs the collector image's
`migrate` command. The database sits in a named volume and has a healthcheck; `migrate` waits until it is healthy,
and both apps start only after `migrate` exits successfully.

```sh
cp .env.example .env     # set POSTGRES_PASSWORD; optionally FUNDSTATS_BIND/PORT, API keys, intervals
docker compose up -d --build
docker compose logs -f collector
```

To update, pull and run `docker compose up -d --build` again; `migrate` applies any new migration first.
Postgres is not published on the host. To back it up, run
`docker compose exec db pg_dump -U fundstats fundstats > backup.sql`.

The web app is published on `127.0.0.1:${FUNDSTATS_PORT:-3000}` only. Put a reverse proxy (Caddy, nginx, Traefik)
on the same host in front of it for TLS, or set `FUNDSTATS_BIND=0.0.0.0` to expose the port on every interface.

### Configuration

All settings are environment variables, read through Effect `Config`. An invalid value stops the process at start.
See `.env.example`. `compose.yaml` forwards every setting below from `.env` except those marked "image" (set in the
Dockerfile); an empty or unset value means the default.

| Variable                            | Used by   | Default               | Notes                                                                                               |
| ----------------------------------- | --------- | --------------------- | --------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                      | both      | required              | compose.yaml builds it from `POSTGRES_PASSWORD`                                                     |
| `DB_POOL_MAX`                       | both      | `10`                  | positive integer                                                                                    |
| `DB_STATEMENT_TIMEOUT`              | both      | `30 seconds`          | Postgres cancels a longer statement, lock waits included; at least 1 second (migrations are exempt) |
| `COLLECTOR_ENABLED`                 | collector | `true`                | `false` = never call upstreams                                                                      |
| `COLLECTOR_INTERVAL_<SOURCE>`       | collector | see below             | e.g. `COLLECTOR_INTERVAL_MBANK=6 hours`; at least 1 minute                                          |
| `RAW_PAYLOAD_RETENTION_DAYS`        | collector | `30`                  | positive integer; stored responses of failed runs older than this are deleted daily                 |
| `LIVE_SNAPSHOT_DETAIL_DAYS`         | collector | `7`                   | positive integer; crypto quotes older than this are thinned daily to one per instrument and UTC day |
| `FETCH_TIMEOUT`                     | collector | `5 minutes`           | a run's whole fetch, retries and Retry-After waits included; 30 seconds to 1 hour                   |
| `COINGECKO_API_KEY`                 | collector | unset                 | CoinGecko demo key; raises the rate limit                                                           |
| `CMC_API_KEY`                       | collector | unset                 | official CoinMarketCap API; without it the unofficial web endpoint is used                          |
| `MIGRATIONS_DIR`                    | migrate   | `packages/db/drizzle` | image; where the `migrate` command reads migrations from                                            |
| `PORT` / `HOST`                     | web       | `3000`/all            | image; the port and address inside the container                                                    |
| `FUNDSTATS_BIND` / `FUNDSTATS_PORT` | compose   | `127.0.0.1`/`3000`    | host address and port the web app is published on                                                   |

Default intervals: every source every 6 hours (mBank's feed changes once per business day).
After a failed run, the next attempt comes within 10 minutes.

One source is collected by one run at a time, in one process or across several: a run holds a Postgres advisory lock for its source until its
data is stored. The lock lives on a session of its own, and every write of the run goes through that session, so if
the session is lost (and the lock with it), the run's next write fails, nothing more of it is written, and it is
recorded as failed. An interrupted run rolls back its unfinished transaction, and a run that committed keeps its
success. A `bun run collect` while the collector is collecting that source (or the other way round) skips it and
says so (`SKIPPED`, exit status 1). At start the collector closes runs left `running` only when their source's lock
is free, so a run still going in another process is left alone.

## Data model

- `instruments`: one row per fund or coin per source, unique on `(source, external_id)`. `last_seen_run_id` marks
  the instruments in the source's latest successful run, and the "latest" views list only those. An upstream
  response that lists one id twice fails its run (the response is kept in `raw_payloads`).
- `snapshots`: values at a point in time. `value` holds the unit value or price. `metrics` is jsonb with named
  numbers (`change_1m`, `change_7d`, `rank`, …; see `packages/shared/src/metrics.ts`).
  - **Dedupe rule:** mBank values come with a valuation date (`as_of`). Each instrument has at most one row per
    date, and re-collecting the same date rewrites that row only if a value changed.
  - Crypto quotes have no `as_of`. A collection adds a row only when the quote changed since the instrument's newest
    row (an upstream that has not updated adds nothing).
  - **Downsampling:** once a day the collector thins crypto rows older than `LIVE_SNAPSHOT_DETAIL_DAYS` (7) to the
    newest one per instrument and UTC day. Seven days at the collection interval (4 points a day at the default 6
    hours) cover the 24h and 7d changes we compute ourselves; older history only needs daily points. Fund rows and
    each instrument's newest row are never deleted.
- `collection_runs`: every run with its trigger, status, counts and error. Postgres stamps `finished_at`.
- `raw_payloads`: the upstream response of each run that failed after fetching it (decode or normalize error, no
  instruments, a duplicate id), CoinPaprika trimmed to the top 100, so a changed upstream shape can be inspected and
  replayed after a fix. Successful runs store none.
- `source_schedules`: each source's interval and whether collection is enabled, as the collector last started.

Derived values are computed when the data is read, not stored. Weighted momentum,
`(4·1m + 3·3m + 2·6m + 1·1y) / 10`, is defined only in `packages/shared/src/metrics.ts`.

## API

Data endpoints are under `/api/v1`. OpenAPI document: `/api/openapi.json`. Interactive docs: `/api/docs`.

| Endpoint                                                             | Returns                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------ |
| `GET /api/health`                                                    | app and database status                                      |
| `GET /api/v1/sources`                                                | each source with its last run, last success and a stale flag |
| `GET /api/v1/sources/:source/latest`                                 | source status and the latest row per instrument              |
| `GET /api/v1/sources/:source/instruments/:externalId/history?limit=` | snapshots of one instrument, newest first                    |

The browser uses a client generated from the same definition (`apps/web/src/web/api.ts`). During SSR that client
is answered in-process, without an HTTP round trip.

## Pending upgrades

Revisit these when the condition changes; last checked 2026-11-18.

- **picomatch advisory**: CI's `bun audit` ignores GHSA-fc5q-39xc-vjpf (ReDoS; only build tooling reaches picomatch,
  with this repository's globs). Remove the `--ignore` once a patched picomatch ships and the lockfile has it.
- **Drizzle 1.0**: on the release after RC, rerun `bun run db:generate` (expect no diff), the migrations on an empty
  database, and the SQL fault tests (`bun run --filter @fundstats/db test`).
- **Nitro 3.0**: on the release after RC, check the web lifecycle: fail-fast start, `close` on SIGTERM and an
  `apps/web/src/server/` edit picked up by `bun run dev` with one pool.
- **Postgres 18.4**: the image is pinned by tag and digest in `compose.yaml`, `compose.dev.yaml` and
  `packages/db/test/postgres.ts`; refresh all three together.
- **Effect 4.1.4**: `effect`, `@effect/vitest`, `@effect/platform-bun` and `@effect/sql-pg` share one catalog version
  in `package.json`; upgrade them together, then `bun run sync:repos`.

## Add a source

1. Add its metadata and default interval to `SOURCES` in `packages/shared/src/sources.ts`.
2. Create `apps/collector/src/sources/<id>.ts` with `defineSource({ info, fetch, payload, normalize })`:
   - `fetch`: build the request and call `fetchJson(id, request)`. You get a timeout per attempt (body
     included), retries with backoff and typed errors from that helper. It returns the JSON undecoded.
   - `payload`: the Schema for that JSON. The collector stores the JSON first and decodes it after, so a changed
     upstream shape fails the run but keeps the response.
   - `normalize`: a pure function from the decoded payload to `NormalizedRow[]`. Use the metric names in
     `packages/shared/src/metrics.ts`; add a new one there if needed.
3. Register it in `apps/collector/src/sources/registry.ts`.
4. Add a column config to `TABLES` in `apps/web/src/web/tables/index.ts`: columns, default sort, and optional
   periods, thresholds or categories.
5. Save a small real response under `apps/collector/test/fixtures/` and add a normalize test.

TypeScript reports an error until steps 1, 3 and 4 all have the new id. The page is then served at
`/funds/<id>` or `/crypto/<id>`, and the collector picks the source up on its next start.
