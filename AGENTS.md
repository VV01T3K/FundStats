# FundStats

Collects fund and crypto statistics from public upstreams into Postgres and serves them as tables. One TanStack
Start app: React in `src/web` and `src/routes`, an Effect 4 backend in `src/server`, shared contracts in `src/shared`.
See README for layout and scripts. Conventions adapted from [t3code](https://github.com/pingdotgg/t3code)'s AGENTS.md.

## Reference source

- Run `bun run sync:repos` first. It puts Effect's source, at the installed version, in git-ignored `.repos/effect`.
- Read `.repos/effect/LLMS.md` before writing Effect code, and prefer patterns found in `.repos/` over invented ones.
- Never edit or import from `.repos/`.

## Taste

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
- The database tests run against a real Postgres from testcontainers. Never call a live upstream; use the saved
  fixtures in `test/fixtures/`.

## Verifying

Run these before pushing; CI runs the same:

```sh
bun run check       # vp check: format check + oxlint (type-aware, with oxlint-plugin-fundstats)
bun run typecheck   # effect-tsgo: TypeScript with the Effect language service
bun run knip        # unused files, exports, dependencies
bun run test        # vitest, real Postgres, plus the lint rule tests
```

`vp check --fix` and `bun run fmt` fix formatting. Lint rules live in `vite.config.ts`, the Effect diagnostics in
`tsconfig.effect.json`.
