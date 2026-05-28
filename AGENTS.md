<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

<!-- intent-skills:start -->
## Skill Loading

Before substantial work:
- Skill check: run `vpx @tanstack/intent@latest list`, or use skills already listed in context.
- Skill guidance: if one local skill clearly matches the task, run `vpx @tanstack/intent@latest load <package>#<skill>` and follow the returned `SKILL.md`.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

## Cursor Cloud specific instructions

### Overview

This is a Vite+ monorepo with:
- `apps/website-react` — TanStack Start (React) full-stack app with Drizzle ORM, better-auth, PostgreSQL
- `docs/my-electric-app-example` — ElectricSQL example app (reference/docs only)

### Environment prerequisites

- **Vite+ CLI (`vp`)**: Install via `curl -fsSL https://vite.plus | bash`, then `vp env setup`.
- **Docker**: Required for PostgreSQL 18 + ElectricSQL services (see `.devcontainer/compose.yaml`).
- **Node.js**: Managed by `vp` — the project uses Node 24 (specified in `package.json` `engines`).

### Required environment variables

```bash
export DATABASE_URL="postgresql://fundstats:fundstats@127.0.0.1:5432/fundstats?sslmode=disable"
export ELECTRIC_SHAPE_URL="http://127.0.0.1:5133/v1/shape"
export ELECTRIC_TABLE="fund_stats"
```

### Starting backend services

```bash
docker compose -f .devcontainer/compose.yaml up -d
```

This starts PostgreSQL (port 5432), ElectricSQL (port 5133), and Caddy (ports 8080/3443).

### Key commands (see README.md for full list)

| Command | Purpose |
|---------|---------|
| `vp install` | Install all workspace dependencies |
| `vp run dev` | Start dev server (port 3000) |
| `vp check` | Format, lint, type check |
| `vp run -r test` | Run tests across workspaces |
| `vp run -r build` | Build all packages |

### Known issues / gotchas

- **nitro self-reference bug**: After `vp install`, you may need to create a symlink for `nitro` inside the bun cache: `cd node_modules/.bun/nitro-nightly@*/node_modules && ln -sf nitro-nightly nitro`. Without this, `vp run` commands fail with `ERR_MODULE_NOT_FOUND: Cannot find package 'nitro'`.
- **`vp check` formatting**: The repo has pre-existing formatting issues (39 files) that cause `vp check` to exit non-zero. Use `vp check --fix` to auto-fix.
- **No test files**: `apps/website-react` currently has no test files; `vp run -r test` exits with code 1 due to "No test files found".
- **PATH priority**: Ensure `$HOME/.vite-plus/bin` is first in PATH so `vp`-managed node (v24) is used instead of nvm's node (v22).