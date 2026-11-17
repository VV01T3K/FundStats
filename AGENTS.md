# FundStats

Collects fund and crypto statistics from public upstreams into Postgres and serves them as tables. A Bun workspaces
monorepo: `apps/web` (TanStack Start pages and the read-only Effect HttpApi), `apps/collector` (the Effect process that
collects and writes), `packages/db` (Drizzle schema, migrations, Store/RunStore on Effect SQL) and `packages/shared`
(source catalog, metrics, the API contract). Everything runs on Bun 1.4.4. See README for layout and scripts. Conventions adapted from [t3code](https://github.com/pingdotgg/t3code)'s AGENTS.md.

## Reference source

- Run `bun run sync:repos` first. It puts Effect's source, at the installed version, in git-ignored `.repos/effect`.
- Read `.repos/effect/LLMS.md` before writing Effect code, and prefer patterns found in `.repos/` over invented ones.
- Never edit or import from `.repos/`.

## Taste

- The web app never writes: it imports `Store` and `Database.layerReadOnly` only. Writes go through `RunStore`, and a
  run's writes through the Drizzle database `SourceLocks.withSourceLock` hands it (the lock's own session).
- Database code uses Drizzle's Effect query builder (`drizzle-orm/effect-postgres`); queries are Effects. No
  promise-based drivers, no hand-written wrappers around the client.
- Effect code stays runtime-agnostic; only `apps/collector/src/main.ts` picks the platform (`@effect/platform-bun`).
- Server features are services (`Context.Service` + `layer`). Routes and HTTP handlers stay thin: decode input, call
  one service method, map errors.
- Import Effect modules as namespaces: `import * as Effect from "effect/Effect"`, never from `"effect"`.
- Reusable Effect functions use `Effect.fn("Service.operation")` with a stable span name, not a function wrapping
  `Effect.gen`. Keep `Effect.gen` for inline programs and layer construction.
- Time, randomness and config come from `Clock`/`DateTime`, `Random` and `Config`, not `Date.now()`, `new Date()`,
  `Math.random()` or `process.env`. Errors are `Schema.TaggedError` classes; catch them with `Effect.catchTags`.
- Compile schemas once at module scope (`const decode = Schema.decodeUnknownEffect(X)`), not per call.
- Inferred types over annotations. `any` is the enemy.
- Default to no comment. Write one only for a constraint, an external quirk, or an invariant the code can't show, in
  one line where you can and four at most. Don't restate names, narrate steps, or record history.
- Every lint or type suppression says why: `// oxlint-disable-next-line <rule> -- <reason>`.
- If a rule here fights the task, say so and get the owner's sign-off before breaking it.

## Tests

- Test behavior that can break at the lowest layer that fails without the change. Extend an existing test before
  adding one.
- A bug fix starts with a failing test, then the fix.
- `it.effect` runs on a `TestClock`; advance it with `TestClock.adjust`. Never sleep, poll, or measure wall-clock
  time: await the `Deferred`, `Queue` or event that marks the milestone. A test that needs a timeout to pass is wrong.
- No per-test timeouts or retries, no `it(...)` inside loops (use `it.effect.each`), no hand-made Effect runtimes.
- The database tests run against a real Postgres from testcontainers (`packages/db/test/postgres.ts`, shared by the
  workspaces; helpers in `packages/db/test/support.ts`). Never call a live upstream; use the saved fixtures in
  `apps/collector/test/fixtures/`.
- Tests live in the workspace that owns the code. Vitest runs under Bun (`bun --bun vitest run`); `bun test` cannot
  load `@effect/vitest`.

## Verifying

Run these before pushing; CI runs the same, plus `bun audit` and `bun run build`:

```sh
bun run check       # oxfmt --check, oxlint (type-aware, with oxlint-plugin-fundstats), effect-tsgo, knip
bun run test        # vitest under Bun for every workspace, real Postgres, plus the lint rule tests
```

`bun run fmt` fixes formatting. Lint rules live in `.oxlintrc.json`, formatting in `.oxfmtrc.json`, the Effect
diagnostics in `tsconfig.effect.json`, shared dependency versions in the root `package.json` catalog. Don't use
`bun lint` or `bun fmt` (canary).
