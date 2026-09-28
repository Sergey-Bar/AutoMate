# AGENTS.md — QA Monorepo

> Guidelines for AI coding agents operating in this repository.

## Repository Overview

This is a **pnpm workspace monorepo** containing the unified Automate platform.

| Directory     | Product                 | Stack                                           |
| ------------- | ----------------------- | ----------------------------------------------- |
| `apps/api`    | Unified API             | Hono v4, Effect, Drizzle ORM, PostgreSQL 16     |
| `apps/web`    | Unified Web             | React 19, Vite, TanStack Router, Tailwind CSS 4 |
| `apps/runner` | Execution boundary      | Node, rootless process control                  |
| `apps/worker` | Lease and recovery loop | Node, worker resilience                         |

The platform uses **pnpm 10+**, **Node.js 24+**, **TypeScript 5.9**, and **Vitest 4** for unit tests.

---

## Build / Lint / Test Commands

Turborepo orchestrates all tasks. Run from the root:

```bash
pnpm install              # Install all workspace deps
pnpm build                # Build all packages (turbo)
pnpm dev                  # Dev servers: API :3000, Web :5173
pnpm lint                 # ESLint across all packages
pnpm typecheck            # tsc --noEmit across all packages
pnpm test                 # Vitest run across all packages
pnpm verify               # Full gate: preflight + format + lint + typecheck + test + contract + integration + runner + coverage ratchet + build + db check + security
pnpm verify:release       # pnpm verify + oci:verify
pnpm unify:preflight      # Pre-unification safety check
```

**Gate and security commands** (each is also wired into a workflow, or has a
check that says so):

```bash
pnpm test:contract        # @automate/contract-tests
pnpm test:integration     # node --test scripts/lib/*.test.mjs + integration + contract
pnpm test:runner          # runner, runner-sdk, worker
pnpm test:performance     # k6 thresholds. Exits non-zero as not_configured without k6
pnpm coverage:ratchet     # Fails on a coverage regression per package, and on a floor that was lowered
pnpm findings:check       # The findings ledger has not drifted from the tree
pnpm findings:baseline    # Rewrites docs/quality/findings-status.json. Deliberate, never automatic
pnpm security:verify      # audit + secrets + secrets history + config check + semgrep/gitleaks + licence + duplication + complexity + capability register + findings
pnpm security:static      # semgrep + gitleaks. Exits non-zero as not_configured without them
pnpm security:secrets     # Dependency-free secret floor, working tree
pnpm security:secrets:history  # The same patterns over every commit. CI step, not a pre-commit hook — it is proportional to the commit count
pnpm duplication          # jscpd
pnpm complexity           # Complexity gate against docs/quality/complexity-baseline.json
pnpm test:render          # Rendering budget: LCP, INP, CLS, long tasks on the four primary routes
pnpm render:baseline      # RECORDS the rendering ceilings. Never in CI, by design
pnpm compose:config       # Resolves the canonical production compose file
pnpm migrate:plan         # Builds the plan. Reads the repository, never a database
pnpm migrate:validate     # Checks the migration graph against the journal
pnpm smoke:local          # HTTP probes against a running stack
pnpm smoke:rehearsal      # A LOCAL-TARGET GUARD, not a rehearsal. Refuses a non-loopback target
pnpm quality:baseline     # The nightly aggregate the numbers in docs/quality/ come from
pnpm oci:build            # Container images
pnpm oci:verify           # Verifies the built images
pnpm docs:capability-register  # Regenerates the capability register
```

`test:render` runs in **two phases, and the phase is derived from the data rather
than chosen**. `scripts/lib/render-gate-phase.mjs` reads
`performance/rendering-budget.json` and computes the tier `test:render` is allowed to
have, and `gate-tooling.test.mjs` fails until `scripts/gate-tooling.json` agrees, in
both directions:

- `recorded: false` — the job **measures** the four routes, publishes the numbers to
  the job summary, compares nothing, and is `pr-reporting`. Not a required check,
  because a required check that can never pass blocks every pull request and teaches
  reviewers to read red as noise.
- `recorded: true` — the same spec **compares** against the ceilings and fails on a
  regression, and `test:render` must be `pr-blocking`.

Graduating is one commit with two parts: record a real run, and raise the tier. The
test refuses to pass if only one happened, so `recorded: true` beside invented numbers
cannot become a gate that is permanently green and unenforced. A GitHub runner is not
the reference hardware — the ceilings describe a self-hosted single-node install, so
`pnpm render:baseline` has to run there.

`scripts/gate-tooling.json` records which external binary each script needs, **and
the tier of every root script** — `pr-blocking`, `pr-reporting`, `nightly`,
`release`, or `never-in-ci`. `scripts/lib/gate-tooling.test.mjs` fails if a workflow
runs one of those scripts without installing the tool, if a script has no tier, or
if `verify` grows past the plan's budget of 20 steps. Adding a tool-dependent script
means adding a row there, not a silent red job.

`migrate:apply` is never in `verify` and never in a workflow: CI has no persistent
database, so applying a migration there proves nothing about the migration.

### The findings ledger

`docs/quality/findings-ledger.json` is the machine-checked record of every confirmed
defect, and `pnpm findings:check` is what makes it more than a document:

- a `fixed` row whose evidence path no longer exists **fails** — the proof was
  deleted, so the claim is open again;
- a status moving backwards, or a row disappearing, **fails**;
- an open Blocker or Critical with no owning wave **fails**;
- a Blocker or Critical recorded as debt **fails** — plan §1 forbids debt in the
  two blocking bands;
- a `debt` row with no owner or no removal condition **fails**;
- a `false-positive` row with no `refutedBy` note **fails**;
- an empty ledger **fails**, because a check that measured nothing is not a pass.

`provenance` says how a row got here: `hand` means it was confirmed by reading the
code, `sweep` means an automated sweep produced it and nobody has read it since.
**No** `sweep` row can be closed while it is still `sweep` — it needs
`confirmed: true` first, or `status: "false-positive"` with a `refutedBy` note naming
what refutes it. Deleting a refuted row is not an option: the ratchet fails on
vanished rows. See `confirmationProblems` in `scripts/lib/findings-ledger.mjs`.

**Single package:**

```bash
pnpm --filter @automate/api test          # API tests only
pnpm --filter @automate/unified-web test  # Web client tests only
pnpm --filter @automate/shared-contracts test # Contracts tests only
pnpm --filter @automate/api dev           # API dev only
pnpm --filter @automate/unified-web dev   # Web dev only
```

**Single test file (Vitest):**

```bash
pnpm --filter @automate/api exec vitest run src/routes/execution.test.ts
pnpm --filter @automate/api exec vitest run src/routes/chat.test.ts -t "specific test name"
```

**E2E tests (Playwright):**

```bash
pnpm test:e2e                # All projects
pnpm test:e2e:api            # The API slice (vertical-slice project, "API" tests)
pnpm test:e2e:vertical       # The vertical slice in full
npx playwright test e2e/some-file.spec.ts
```

`DATABASE_URL` is **required** for the E2E suite. `playwright.config.ts` throws
without it, because the API otherwise falls back to the in-memory store and the
suite reports success without PostgreSQL ever being involved. Set
`E2E_ALLOW_IN_MEMORY=1` only for a deliberate local run; CI must not.

**Database operations:**

```bash
pnpm db:generate   # drizzle-kit generate
pnpm db:migrate    # Apply the journal-ordered migration graph
pnpm db:check      # drizzle-kit check — journal and schema agree
```

---

## Project Structure

```
apps/
  api/               Hono v4 API + Effect services (:3000)
  web/               React 19 + TanStack Router + Tailwind CSS 4 (:5173)
  runner/            Rootless execution boundary
  worker/            Lease, readiness, and recovery loop
packages/
  auth/              Installation sessions and credentials
  automation/        AI gateway ports and streaming adapters
  config/            Environment parsing and the startup policy
  connectors/        github / jira / slack connectors plus their SDK
  db/                Drizzle schema and migrations (PostgreSQL)
  orchestration/     Job state machines and schedules
  realtime/          Versioned replay and SSE boundaries
  reporter/          Producer adapters (JUnit, Playwright JSON)
  reporting/         Evidence, KPI, and quality-gate policies
  runner-sdk/        Spool, retry policy, and the runner HTTP client
  shared-contracts/  Type-safe API contracts and Zod schemas
  ui/                Shared Tailwind 4 component library
tools/
  migrate-cli/       Migration utilities
performance/         k6 scenarios and the recorded thresholds
runners/             k6 / playwright / zap runner images (manifests only)
tests/
  contract/          Contract suite
  integration/       PGlite suites against the real migration graph
e2e/                 Playwright end-to-end tests
scripts/             Gate scripts, all `.mjs`, plus `scripts/lib/` node:test suites
```

---

## Code Style Guidelines

### TypeScript

- **Strict mode everywhere.** The project uses `"strict": true` in tsconfig.
- **Target ES2022**, module resolution `Bundler`, ESM (`"type": "module"` in all package.json).
- **NEVER** use `any`, `@ts-ignore`, or `@ts-expect-error`. ESLint enforces `@typescript-eslint/no-explicit-any`.
- Unused variables must be prefixed with `_` (e.g., `_req`, `_unused`). Enforced by ESLint.
- Use `prefer-const` — enforced as `"error"`.
- Use `.js` extensions in relative imports (ESM requirement): `import { foo } from './bar.js'`.
- Gate scripts in `scripts/` are plain `.mjs` with JSDoc types; they are not typechecked
  by `tsc` (only `tsconfig.scripts.json` covers `scripts/review/`), so keep them
  dependency-free and defensive.

### Imports

- `import type { ... }` for type-only imports.
- Node built-ins: no prefix needed (target ES2022).
- Client path alias: `@/` maps to `src/` in web client.
- Workspace deps: `"workspace:*"` references in package.json.

### Naming Conventions

- **Files**: `kebab-case.ts` for services, routes, utilities. `PascalCase.tsx` for React components.
- **Variables/functions**: `camelCase`.
- **Types/Interfaces**: `PascalCase` (e.g., `FeatureFlagName`, `HubEvent`).
- **Zod schemas**: `PascalCase` with `Schema` suffix (e.g., `RunSchema`, `StartRunBody`).
- **Constants**: `UPPER_SNAKE_CASE` for true constants (e.g., `FLAG_DEFAULTS`, `PASS`).
- **Test files**: colocated with source as `*.test.ts` / `*.test.tsx`.

### Server Patterns (Hono / Effect)

- Use Effect for dependency injection and error handling in services.
- Request validation via Zod schemas defined in `shared-contracts`.
- Return structured JSON responses with appropriate HTTP status codes.
- One error boundary for the app (`src/errors/boundary.ts`); every response carries a
  stable `code`. Do not add a second.

### Client Patterns (React 19)

- **Data fetching**: hand-written fetch wrappers in `src/lib/api.ts`, consumed by custom
  hooks in `src/hooks/` (`useRuns`, `useDashboard`, `useCommandActions`). There is **no**
  TanStack Query and **no** `apps/web/src/store/` directory.
- **Routing**: TanStack Router with file-based routes in `src/routes/`.
- **Validation**: Zod schemas parse API responses on the client side.
- **UI components**: Tailwind CSS 4 + `packages/ui` library.
- **Icons**: `lucide-react`.

### Testing

- **Framework**: Vitest 4 with `globals: true`.
- **Coverage floors are enforced by `pnpm coverage:ratchet`, not by per-package Vitest
  `thresholds`.** `vitest.shared.ts` sets `STANDARD_THRESHOLDS` (90/80/90/90) and
  explicitly declines to apply them per package, because four packages sit well below
  and a gate that blocks every run gets raised until it means nothing. The ratchet
  records the real floor per package in `coverage-baseline.json` and fails only on
  regression, so the floor only moves up. Current floors, as
  `statements/branches/functions/lines`:

  | Package                     | Floor       |
  | --------------------------- | ----------- |
  | `apps/api`                  | 93/84/93/96 |
  | `apps/web`                  | 95/86/96/97 |
  | `apps/runner`               | 68/55/65/70 |
  | `apps/worker`               | 56/43/62/58 |
  | `packages/shared-contracts` | 99/97/97/99 |
  | `packages/ui`               | 59/74/62/59 |
  | `packages/db`               | 61/40/42/62 |
  | `tools/migrate-cli`         | 59/41/85/59 |

  A newly-measured file must be genuinely covered on the same PR. **Lowering a floor to
  make room is not a fix**; the ratchet exists to make that visible.

- **Exclusions**: `docs/quality/coverage-exclusions.md` is the register, and
  `scripts/lib/coverage-exclusions.test.mjs` asserts it agrees with every
  `vitest.config.ts` in both directions. A removal condition must name a thing which
  could happen — never "in the future".
- **Mandatory Rules**:
  - Add or adjust tests for every behavior change.
  - Never delete or skip failing tests.
  - No `.skip` or `.only` in committed code.
  - A test that cannot fail is worse than no test. If a loop or assertion exists only
    to move a coverage counter, assert the real mapping or quarantine the code with a
    reason in the exclusion register.

### Security

- Never commit tokens/credentials. Use `.env` locally.
- Do not log sensitive data.
- `pnpm security:secrets` scans the working tree; `pnpm security:secrets:history` scans
  every commit and is a CI step. Synthetic credentials in tests are assembled at
  runtime, never written as literals — `apps/api/src/test-support/synthetic-credentials.ts`
  is the fixture, and `scripts/lib/test-support-boundary.test.mjs` fails if product code
  imports from `src/test-support/`.
- Vault: AES-256-GCM encryption with PBKDF2 key derivation.
- `WORKSPACE_ID` is the only tenancy boundary in the system. Any new workspace-scoped
  read or write needs a cross-workspace isolation test.

### Git / PR Workflow

- Branch from `main`. Small, focused PRs.
- Husky is installed by `pnpm install` (`prepare` → `husky`), so `.husky/pre-commit` and
  `.husky/commit-msg` are live. `pre-commit` runs `security:secrets` and a
  `prettier --check` over the staged files, and nothing else — the full gates are CI's
  job, and a slow commit hook gets `--no-verify`'d.
- All CI gates must pass before merge: `lint`, `typecheck`, `test`, `build`.
- CI wiring is audited, not assumed: every job needs a `timeout-minutes`, every workflow
  a `concurrency` block, and any job running a tool-dependent script must install the
  tool. `scripts/lib/gate-tooling.test.mjs` enforces all three.
