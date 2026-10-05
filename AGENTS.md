# AGENTS.md — the rules for changing this repository

> For an agent or an engineer working _in_ this tree.

**What this is not.** Not a contributor guide — [`CONTRIBUTING.md`](CONTRIBUTING.md) is,
and it leads with the four properties of this repository and the three-commit testing
rule. Not a design document — [`site/guide/design-language.md`](site/guide/design-language.md)
is, and it carries the plane, the accent, the type and the motion with every measured
number attached.

**What this is.** The commands that must run, the gates that must not be weakened, and
the conventions nothing else enforces. Where a rule has a gate behind it the gate is
named, because a rule with no gate is a preference and this file used to be hard to tell
apart from one.

## The design system, and what will fail if you ignore it

Six rules an agent working in this tree will otherwise violate by writing something that
looks right. The **why** behind each is on the design-language page; this is the _what
fails_.

| Rule                                                                                                                                                                 | What enforces it                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colour is a token. A literal hex in a `.ts` or `.tsx` file is a build failure.                                                                                       | `apps/web/src/theme-resolution.test.ts` scans **both** `packages/ui/src` and `apps/web/src`, resolves each utility against a real Tailwind compile, and fails on any class that generates nothing     |
| `backdrop-filter` is an error. Phase 1 ships no glass at all.                                                                                                        | `eslint.config.js` — `GLASS_SELECTOR`, spread into every block that sets `no-restricted-syntax`, because a standalone block silently replaced the double-assertion rule the first time it was written |
| `animate-in`, `fade-in-*`, `zoom-in-*` and `slide-in-from-*` do not exist — no plugin is installed, and sixteen class names written against one compiled to nothing. | `PLUGIN_PROVIDED_UTILITIES` in `theme-resolution.test.ts`. Use `animate-fade-in`, `animate-fade-out`, `animate-zoom-in-95`, `animate-zoom-out-95`                                                     |
| `lucide-react` is a dependency of `packages/ui` and **not** of `apps/web`, so an application component cannot import it                                              | pnpm's isolated `node_modules`. Import icons from `@automate/ui`; the list is `packages/ui/src/icons.ts`, and adding one is a line a reviewer reads                                                   |
| The two font binaries are committed once, in `packages/ui/src/assets/fonts/`, each with a sha256 and an upstream beside it                                           | `packages/ui/src/tokens/fonts.test.ts`, in both directions — the recorded digest, and no binary in the directory without a row                                                                        |
| The documentation site imports the product's `theme.css`; it does not copy it                                                                                        | `pnpm site:doctor` check 8, which runs without a build so a palette drift fails on every host rather than hiding behind a `GAP`                                                                       |

## Repository Overview

This is a **pnpm workspace monorepo** containing the unified Automate platform.

| Directory     | Product                 | Stack                                           |
| ------------- | ----------------------- | ----------------------------------------------- |
| `apps/api`    | Unified API             | Hono v4, Effect, Drizzle ORM, PostgreSQL 16     |
| `apps/web`    | Unified Web             | React 19, Vite, TanStack Router, Tailwind CSS 4 |
| `apps/runner` | Execution boundary      | Node, rootless process control                  |
| `apps/worker` | Lease and recovery loop | Node, worker resilience                         |
| `site`        | Documentation site      | VitePress                                       |

The platform uses **pnpm 11**, **Node.js 24+**, **TypeScript 6.0**, and **Vitest 4** for unit tests. ESLint is at **10**, and its major changed which config file it loads: it resolves from each linted file's own directory and uses that directory as the base path for `files` patterns, so a nested `eslint.config.js` — even one that only re-exports the root — silently disables every path-scoped rule beneath it. There are none, and `scripts/lib/eslint-plugin-compatibility.test.mjs` refuses one.

pnpm 11 refuses a package published in the last 24 hours, against the whole lockfile rather than only new resolutions. A same-day release cannot be adopted; the wait is a day, and `pnpm audit --fix` exempts a security patch from it.

Shared dependency versions live in the `catalog:` block of `pnpm-workspace.yaml` and packages declare `"catalog:"`, never a range. A package in the catalog that declares its own range resolves fine and splits the tree into two versions of one dependency; `pnpm deps:policy` reports it.

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
pnpm verify:local         # The same chain, on a host with no semgrep/gitleaks. Never in CI
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
pnpm skill-scan           # Scans .kilo/skills/ for prompt injection and exfiltration patterns. pr-reporting, needs skillspector
pnpm duplication          # jscpd
pnpm complexity           # Complexity gate against docs/quality/complexity-baseline.json
pnpm test:render          # Rendering budget: LCP, INP, CLS, long tasks on the four primary routes
pnpm render:baseline      # RECORDS the rendering ceilings. Never in CI, by design
pnpm verify:local         # The same chain, on a host with no semgrep/gitleaks. Never in CI
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

### The static scanners, and the one way to run around them

`security:static` exits non-zero when it cannot produce a scan, because an unrun
security scan is not a pass. On a host where `semgrep` is pip-installed, answers
`--version`, and never returns from `scan`, that makes `verify` unrunnable — and a
developer who cannot run the other twelve steps is worse off than one who can.

**`AUTOMATE_HOST_SCANNERS=unavailable`** (set for you by `pnpm verify:local`) records
that as `not_configured` and exits 0. The boundary is narrow and machine-checked:

- a scanner that **ran** and reported something still fails, with or without it;
- a scanner **killed at the ceiling** counts as unavailable, never as clean — so a
  ten-minute stall cannot become a green security gate;
- `AUTOMATE_SCAN_TIMEOUT_MS` is clamped to [1 min, 1 h], because a ceiling small
  enough to guarantee a kill is the same defect by another route;
- **no file anywhere under `.github/` may set it**, composite actions included —
  `auditRepository` reports it as a finding.

`scripts/lib/host-scanners.mjs` holds the policy and `host-scanners.test.mjs` the
proof. Extending the opt-in is a change to that module, not to a workflow.

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

### The agent's own instructions are supply-chain input

`AGENTS.md`, the eleven personas in `.kilo/agent/`, and every `SKILL.md` are text the
agent obeys. Nothing in the gate chain scanned them. `security:secrets` scans the
repository, and a repository that has audited its secrets, its dependencies, and its
licences has not thereby audited the prompt surface — which is the same shape as
`P-6`'s three startup-policy authorities: a trust boundary that exists in the product
and nowhere in the gates.

`pnpm skill-scan` closes it. It wraps NVIDIA's SkillSpector, which found **26.1% of
31,132 analysed skills carrying vulnerabilities and 5.2% showing likely malicious
intent**. The script imports `isHostDegradationOptedIn`, `scanTimeoutMs`, and
`notConfiguredMessage` from `scripts/lib/host-scanners.mjs` rather than restating them,
because a second unavailable-tool policy would be a second authority, and a scanner
killed at the ceiling exits 2 rather than reporting clean. It also fails **closed** on
its own baseline: a missing or unreadable baseline makes every finding new.

It is tier `pr-reporting` and **not in `verify`**, and the reason is a real run rather
than a prediction. On 2026-10-02 it scanned the eight skills and returned
**`DO_NOT_INSTALL` at risk score 56** — on the strength of six pattern matches against
markdown prose: a React README sentence reading "Define clear context interfaces", a
`dangerouslySetInnerHTML` inside a fenced code block in Vercel's own hydration guidance,
and unpinned `npx` in command examples. The scanner works; the corpus is clean. So the
gate **blocks on findings not in `docs/quality/skill-findings-baseline.json`, each with
a stated reason**, and reports the aggregate verdict beside them — a permanently red gate
is what SEM-2's 543 semgrep findings taught this repository. The baseline is keyed on
`match_fingerprint`, never `finding_id`, because the id is regenerated per run and two
scans of the same tree produced different ids for identical findings.

The scan was also **not complete** — and vendoring the design-craft skill set made coverage _worse_: `is_complete: false` at **95.8%**, down from 97.7%, with six static analyzers degraded across four files partially inspected by three different limits — and the gate prints the coverage and the
degraded set rather than a clean summary over them. Graduating needs one commit that
installs the scanner in the `security` job and moves the tier together; the condition is
a CI run that printed a `risk_assessment` with `is_complete: true`.

The **sixteen** vendored skills carry an upstream source repository and a content hash in
`skills-lock.json`. A hash answers _did the file change_ and not _is the file safe_,
which is why both exist.

### The agent's configuration, and one planning system

`.kilo/` is the canonical project config root, and the whole of it is inside
`.prettierignore`.

| Path                      | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.kilo/kilo.jsonc`        | Project config. Four lines today.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `.kilo/agent/*.md`        | **The eleven personas**, in Kilo's format: `mode`, `steps`, `color`, and `permission`. The three read-only ones carry `permission: edit: deny`, so "DO NOT edit files" is enforced by the harness rather than by prose — a guard you can forget to call is weaker than a permission you cannot call.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `.kilo/skills/*/SKILL.md` | **The twenty-one project skills.** Five authored here — `ledger-row`, `evidence-test`, `no-second-authority`, `gate-tiering`, `capability-evidence` — and sixteen vendored: four from `vercel-labs/agent-skills` and `supabase/agent-skills`, and twelve design-craft skills from `emilkowalski/skills`, `jakubkrehel/skills`, `ibelick/ui-skills`, `zeke/swiss-design-skill`, `MengTo/Skills`, `prototyper-ui` and `addyosmani/web-quality-skills`. **`scripts/skill-scan.mjs` derives the vendored list from `skills-lock.json` rather than holding a literal**, and `scripts/lib/skill-scan.test.mjs` fails if the two disagree in either direction — a hand-written list said `4 authored, 4 vendored` over a tree of twenty-one directories, because the number came from the array and the skills came from the lock. |
| `.kilo/command/*.md`      | **Three commands**, because the other two layers are only half a workflow without them: `/gate` (which gate applies, and can it pass today), `/close` (close a ledger row, or say why not), `/boundary` (add a table to the tenancy register, or diagnose a regression). Each composes a skill with the gate that decides it; none is a wrapper around one `pnpm` command.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `.kilo/plans/`            | **The one planning system.** The only one of the three that is tracked in git.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `.kilo/worktrees/`        | Agent Manager worktrees.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

`.kilo/agent/` is the same eleven personas as `.github/agents/*.agent.md`, in the
format Kilo reads, and the content is one copy: the thirteen review categories in
`.github/review-rules/rules.json` map to seven of them, and `scripts/review/ruleset.mjs`
keeps that file and the emitters in agreement in both directions. **`.github/agents/`
is the GitHub Copilot copy and stays in sync by hand**; the frontmatter is the only
difference, and the persona bodies are the authority for both.

**Adding a skill.** Project skills go in `.kilo/skills/<name>/SKILL.md` with `name`
and `description` in the frontmatter — that is the only discovery path, and the
description is what the agent matches on, so it must name the _situation_ and not the
tool. A third-party skill is vendored, not copied by hand:

```bash
npx --yes skills@latest add <owner>/<repo> --skill <name> -a kilo --copy -y
# then move the folder from .agents/skills/<name> into .kilo/skills/<name>,
# so the project has one skill root rather than two.
```

Do not run `skills update` here: it writes to `.agents/skills/`, which would
reintroduce the split.

**`.omo/` and `.sisyphus/` are dead state and are not the planning system.** They are
byte-identical to each other, both point at `C:\VScode\QA\.sisyphus\plans\` — a path
from a different machine — and they name packages that no longer exist
(`@automate/server`, `dashboard-server`, `packages/cli`). They are gitignored, so
nothing checks them, which is exactly why nothing noticed. **`.kilo/plans/` is the
authority**; the other two can be deleted whenever nobody wants their session history.

Seventeen of the eighteen files in `.kilo/plans/` are currently untracked, so a plan
written in one session is invisible in the next. Committing them is a deliberate act,
not an automatic one.

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
pnpm --filter @automate/api exec vitest run src/routes/agents.test.ts -t "specific test name"
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

### The findings that are waiting on a measurement, not on code

Three rows in the ledger cannot be closed from a development host, and the reason
is the same in each: the harness is complete and the _evidence_ is missing. They are
listed here because a reader finding them in the ledger would otherwise re-derive
why they are open.

| Row        | What is built                                                                                                                                          | What is missing                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RF-5**   | `pnpm migrate:rehearse` — dump, restore onto a clean instance, migrate **the copy**, re-open every sealed row through the product's own `vault-crypto` | One run against a real installation. CI has no second database, so a rehearsal there proves `pg_dump` is installed                                                             |
| **RF-9**   | `performance/thresholds.json` with a cross-check against the k6 scenario, so a changed threshold and an unchanged record each fail the gate            | Observed numbers. `recorded: false`, so the gate protects drift from a baseline nobody measured                                                                                |
| **PERF-1** | `pnpm test:render` and `pnpm render:baseline`, comparing LCP, INP, CLS, and long tasks                                                                 | A recorded baseline **on the reference hardware** — a self-hosted single-node install. A GitHub runner is not it, which is why the job is `pr-reporting` and not `pr-blocking` |

None of these is closable by writing more code, and none should be closed on the
strength of its harness. The blocker is evidence, not scope — and for **RF-5** that
distinction has already been settled against the record: the tenancy wave (W7) landed
in five migrations, and the rehearsal it was gated on has still never been run, so the
row is an `open` Blocker and `pnpm findings:check` says so. That rule is now
`docs/quality/wave-gates.json` rather than a sentence, which is the only reason it
survived as long as it did.

---

## Project Structure

```
.kilo/                The canonical project config root
  agent/              The eleven reviewer personas, in Kilo's format
  skills/             The twenty-one project skills (five authored, sixteen vendored)
  command/            Three commands: /gate, /close, /boundary
  plans/              The one planning system; the only one tracked in git
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
- Gate scripts in `scripts/` are plain `.mjs` with JSDoc types. They **are**
  typechecked: `tsconfig.scripts.json` sets `allowJs`, `checkJs`, `strict`, and
  includes `scripts/**/*.mjs` deliberately broadly, because "a gate script that
  is excluded from type checking is a gate script whose wrong argument count
  nothing catches". Index a parsed-JSON field through
  `/** @type {Record<string, unknown>} */ (…)` rather than reaching through
  `unknown`. Keep them dependency-free and defensive.

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
  | `apps/api`                  | 95/86/95/97 |
  | `apps/web`                  | 96/88/96/98 |
  | `apps/runner`               | 70/58/66/72 |
  | `apps/worker`               | 63/57/69/65 |
  | `packages/shared-contracts` | 99/98/97/99 |
  | `packages/ui`               | 67/84/68/66 |
  | `packages/db`               | 72/67/55/73 |
  | `tools/migrate-cli`         | 59/42/85/60 |

  Every row was wrong when this table was last read, by 2 to 20 points — the floors
  move every time a package's tests grow, and nothing was checking. `coverage:baseline`
  is the authority and `scripts/lib/docs-drift.mjs`'s `coverage-floors` assertion is
  what holds this copy to it, so this table is a reading aid and not a source.

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
- **Write the test, run it with the defect still present, watch it fail for the reason you
  expect, then fix it.** A test only written against the fixed code is not evidence. See
  [`CONTRIBUTING.md`](CONTRIBUTING.md) — three times in this programme's history a suite
  was fully green while checking the wrong thing, and none of them was caught by reading
  the code carefully.

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
  **`docs/quality/tenancy-scope.json` is which tables that covers** — one row per table,
  each committing its scope, its observed column state, and the reason. `pnpm tenancy:check`
  fails on an unclassified table or on one that loses a hard boundary; it reports the 28
  workspace-scoped tables that do not have one rather than failing, because that debt is
  tracked as `P-20` and a permanently red gate stops catching the regressions.

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
