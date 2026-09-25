# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

pnpm workspace monorepo (`packages/*`, `apps/*`, `tools/*`, `e2e/*`) orchestrated by Turborepo.
Node 22+, pnpm 10+, TypeScript 5.9, ESM everywhere (`"type": "module"` in every package).

`AGENTS.md` is the human-facing version of this guidance, but parts of it have drifted
(coverage numbers, `db:push`/`db:studio`, `coverage:ratchet`, an `@/` path alias) — none of
those exist in the unified workspace. Trust `package.json` / `vitest.config.ts` over prose.

## Commands

```bash
pnpm install
pnpm dev            # API :3000 + Web :5173 (sets VITE_AUTH_REQUIRED=false)
pnpm verify         # the gate: build + test + typecheck + lint across all 7 packages
pnpm build | test | typecheck | lint   # individual turbo tasks
```

Per package (names: `@automate/api`, `@automate/unified-web`, `@automate/ui`, `@automate/db`,
`@automate/auth`, `@automate/realtime`, `@automate/shared-contracts`):

```bash
pnpm --filter @automate/api test
pnpm --filter @automate/api exec vitest run src/routes/runs.test.ts
pnpm --filter @automate/api exec vitest run src/routes/runs.test.ts -t "test name"
```

`test` in `apps/api` and `apps/web` runs `vitest run --coverage`, and coverage thresholds are
part of the test gate (85% lines/functions/statements/branches in both). Adding uncovered code
fails `pnpm test` even when every assertion passes. The other packages have no thresholds.

E2E (Playwright, two separate configs):

```bash
npx playwright test                                    # root config, testDir ./e2e, baseURL :5173
pnpm test:automation:score                             # e2e/integration vertical-slice + score gate
```

`e2e/integration/playwright.config.ts` has two projects: `integration` (needs a live nginx stack
on port 80) and `vertical-slice` (starts the API on :3456 and Vite on :5173 itself via `webServer`).
CI runs only the latter, through `scripts/automation-score.mjs`, which fails under a score of 75.

Database (never `db:push` — production schema changes go through generate + migrate):

```bash
pnpm --filter @automate/db db:generate    # drizzle-kit generate -> packages/db/drizzle
pnpm --filter @automate/db db:migrate     # runs dist/migrate.js, so build the package first
```

Other gates:

```bash
pnpm unify:preflight     # legacy-reference guard, see "Legacy tree" below
pnpm smoke:local         # GET :3000/health and :5173/ — expects servers already running
pnpm security:scan       # pnpm audit --audit-level=high (release-blocking in CI)
```

Python sidecar (`services/webwright`, FastAPI + Playwright, uv-managed, mypy strict):

```bash
cd services/webwright && uv sync && uv run pytest      # also: uv run ruff check . / uv run mypy src/
```

## Architecture

**Modular monolith.** `apps/api` is a single Hono app; each domain is a *module factory* that
returns a `Hono` sub-app and is mounted at `/` in `apps/api/src/index.ts`
(`createDashboardModule`, `createOrchestratorModule`, `createConnectorsModule`,
`createAgentsModule`, plus the standalone route factories). Every module takes its
dependencies as constructor options rather than importing singletons — this is what makes the
route tests able to inject in-memory stores. Follow the same pattern for new domains: a
`create<Domain>Module(options): Hono` in `src/modules/<domain>/index.ts`, one file per route
group, mounted from `index.ts`. All endpoints are under `/api/v1/*`.

**DATABASE_URL selects the persistence layer at boot.** With it set, `index.ts` builds
`DrizzleRunRepository` + Drizzle-backed dashboard stores; without it, everything falls back to
in-memory implementations (that is why the whole API runs with no Postgres locally). The
in-memory path is a dev/test convenience — `startup-policy.ts` throws on boot in production if
`DATABASE_URL`, `COOKIE_SECRET` (≥32), `REPORTER_SECRET` (≥16), `AUTOMATE_API_KEY` (≥16), or
`VAULT_SECRET` (≥32) is missing or a placeholder.

**The vertical slice is the load-bearing data path.** Playwright reporter →
`POST /api/v1/reporter/events` (`routes/reporter.ts`, accepts both the legacy `@automate/reporter`
wire shape and the versioned one) → `RunRepository` + `InMemoryRealtimeBus` →
`GET /api/v1/events` SSE stream (`routes/events.ts`) → browser. The repository and bus instances
are process-wide singletons created in `index.ts` and shared by reference; dashboard reads see
reporter writes only because it is the *same* instance. Preserve that when wiring new modules.

**Two auth layers, deliberately separate.** `middleware/auth.ts` is applied globally and accepts
either `Authorization: Bearer <AUTOMATE_API_KEY>` or the signed `automate_session` cookie issued
by `POST /api/auth/login` (`routes/auth.ts`). It bypasses a small `PUBLIC_PATHS` set and the whole
`/api/v1/reporter/` prefix, which authenticates against `REPORTER_SECRET` instead. When
`AUTOMATE_API_KEY` is unset the middleware is in *open mode* and passes everything through — so
"it works locally" says nothing about auth being wired correctly. Client-side, `AuthGuard` redirects
to `/login` unless `VITE_AUTH_REQUIRED=false` (which root `pnpm dev` sets).

**Web app.** React 19 + TanStack Router with a **hand-written route tree** in
`apps/web/src/router.ts` — routes are *not* file-system generated, so a new file under
`src/routes/` is invisible until it is imported and added to the tree there. Data fetching lives in
`src/hooks/use*.ts`, one hook per domain, each parsing responses through Zod schemas from
`src/lib/api.ts`. Vite dev server proxies `/api` → `http://localhost:3000`.

**Packages.** `shared-contracts` (Zod v4 schemas + preserved `*.schema.json` for AJV consumers),
`realtime` (versioned event schemas — every event carries `version: '1'`), `auth` (timing-safe
`validateApiKey`, sessions, permissions), `db` (Drizzle schema/client/migrate), `ui` (Tailwind 4
component library consumed from source, no build step).

## Conventions that will bite you

- Relative imports need explicit `.js` extensions, including in `.tsx` (`./routes/__root.js`).
- Import Zod as `import { z } from 'zod/v4'` — the bare `'zod'` import appears in one file only.
- Read env vars with bracket access: `process.env['DATABASE_URL']`, `import.meta.env['VITE_...']`.
- ESLint is `--max-warnings=0` and bans `any`, unused vars not prefixed `_`, `console.log`
  (`warn`/`error`/`info` allowed), and `.skip`/`.only` in test files.
- Tests are colocated (`*.test.ts(x)`). Web tests import `@testing-library/jest-dom` per file —
  there is no global setup file in `apps/web` (only `packages/ui` has one).
- Commits are commitlint-enforced conventional commits with a scope allowlist in
  `commitlint.config.js` (`api`, `web`, `unified`, `preflight`, …).

## Legacy tree

`AutoMate/` sits in the working directory but is a **separate, gitignored git repository** — not
part of this workspace. Don't edit it, and don't reference legacy paths or non-allowlisted
`@automate/*` package names from config, CI, docker, `README.md`, `AGENTS.md`, or
`docs/{deployment,migration-guide,operations}`: `pnpm unify:preflight` fails the build on them.
Historical/planning docs under `docs/` are held to a looser rule.
