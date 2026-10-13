# Automate — Final Execution Roadmap to World-Class QA (10/10)

**Type:** implementation-ready final phase · supersedes `1790366935028-automate-product-quality-master-plan.md` as the execution document
**Repo:** `github.com/Sergey-Bar/AutoMate` · pnpm 10.30.2 · Turborepo · Node 24 · TypeScript 5.9 · Vitest 4 · Playwright 1.63 · Tailwind 4 · React 19
**Rule of this plan:** nothing is called done without executable evidence. A mock, a static response, an in-memory store, or an unwired adapter is `not_configured`, never a pass. A gate that cannot fail is a defect. A gate that fails for an environmental reason it does not report is a worse defect.

---

## 1. Decisions locked with the owner

| # | Decision | Consequence |
|---|----------|-------------|
| **D1** | This roadmap is an **executable final phase plus a named backlog**, replacing the 647-line master plan | Old P1–P5 product build becomes backlog `BK-1`…`BK-10` with entry criteria, not deleted. ~120 ordered tasks remain |
| **D2** | **Four tracks run in parallel from day one** | Work is parallel; **gate promotion is ordered** (§4 interlock). Explicit interlock contract replaces the old plan's implicit one |
| **D3** | **Visual redesign pass**, not defect-fix only | The design system is a deliverable. The 28-component library + 27 tokens are the material, restyled — not thrown away |
| **D4** | **Dark-first dense evidence console** | Lean into the accidental dark-first state (`theme.css:42-43`) and turn it into intent. Light theme becomes a contrast-verified peer |
| **D5** | **Adopt TanStack Query + one shared SSE** | One vendor with TanStack Router. Gives cache sharing, dedup, abort, retries, and one place where loading/error/empty states are derived — which the redesign requires |
| **D6** | **Deterministic redesign gates + non-blocking visual review** | axe / tokens / contrast / keyboard / state-coverage are hard merge gates. Screenshots are artifacts; the blocking visual lane is nightly+release with pinned fonts |
| **D7** | All four QA-pillar readings are in scope: instrumented product, testability infrastructure, self-verifying register, evidence/audit hardening | Tracks C and D |
| **D8** | Single-tenant, self-hosted, English-only; browser + API + performance + security + accessibility | Mobile, iOS, multi-tenancy, RBAC/SSO stay out of scope |
| **D9** | **Extend the existing token layer only.** CSS stays the single source of truth; the 7 dead TS token modules are deleted; only the scales Tailwind v4 does not already serve well (type, elevation, motion) are added. Tailwind's spacing and radius scales are kept — they are already a coherent 4px system | A1/A2/A5 get a small diff. No class-name migration. No build step for tokens, and no layer that can drift |
| **D10** | **The evidence console shows evidence the product genuinely has**, and its IA is designed so the deferred failure-intelligence surfaces light up when `BK-3` lands. No invented data anywhere; absence is recorded as `not_configured` in the register | A14 does not pull `BK-3` forward. Keeps the scope decision intact while not throwing away the design work for the differentiating layer |
| **D11** | **Additive-first schema changes: expand, then contract, no destructive change in this final phase** | New migration track (§12). No column is dropped, renamed, or narrowed while the old application can run. Every migration proven against the real migration graph in `tests/integration` |
| **D12** | **10/10 documentation and a GitHub-hosted public site**, structurally inspired by the author's `QA-Doctor` project: VitePress in `site/`, in-repo, deployed to GitHub Pages at `https://sergey-bar.github.io/AutoMate/`, with its own `site-doctor` gate. **Completely different visual identity** | New Track E (`E1`–`E6`). Same architecture, none of the aesthetic |
| **D13** | ~~**Site identity: light technical notebook with dark evidence panels.** Light-first typographic docs chrome, humanist/serif display face, mono for code, grid-ruled, no gradients, no mythology, dual theme with both authored. Every code block, evidence sample, telemetry panel, and capability row renders as a **dark instrument surface in both themes**~~ **SUPERSEDED in part, 2026-10-03** — see the note below this table | The visual split *is* the product's thesis: prose is a claim, evidence is an instrument reading. Breaks all four Mjölnir traits — theme priority, typography, texture, identity |
| **D14** | **English only.** No localized READMEs | All effort goes into depth. A translation surface is a documented extension point, not a commitment |
| **D15** | **The site sells the evidence guarantee, not the feature count.** The hero is a real evidence chain; the differentiator is "every number here has an evidence command"; the capability table shows real rows *and* honest `not_configured` rows; the roadmap is a labelled page, not the pitch | Consistent with `D10` — the site cannot invent capability. Also a QA professional's actual buying criterion, and the one thing a product that admits what it cannot do can uniquely claim |

---

## 1a. Supersessions — read this before working from this plan

This plan is still the roadmap. Three of its decisions have been replaced, and a plan whose
decisions disagree with a later one is how a reader ends up implementing the wrong one twice.
Each supersession names what took it over, so there is one authority rather than two.

Recorded as `DESIGN-1` in `docs/quality/findings-ledger.json`, because an amendment in a
document does not fail and a split authority does not either — it just quietly produces two
answers to "what colour is a run".

### D13 — superseded in part, 2026-10-03

> **Was:** site identity is a light technical notebook with a humanist/serif display face
> against a mono, grid-ruled, no gradients, in both themes authored.

> **Now:** `.kilo/plans/1791024280658-cinematic-design-language-and-docs-overhaul.md` §1.

**What carries over, unchanged.** The thesis D13 rests on — *prose is a claim, evidence is an
instrument reading*, and the visual split is therefore the product's argument — is not
replaced. It is the reason that plan keeps a separate `--automate-surface-sunken` for evidence
panels in a plane that is otherwise a page.

**What is replaced, and why.**

- **The serif display face.** Archivo, a grotesque with a real width axis, replaces it. A serif
  in the *site* chrome and a grotesque in the *product* would be two design languages for one
  product, and this plan's D13 was already the plan that fused them by sharing one token file.
  The serif is not a smaller version of the idea; the idea was "prose and evidence are set
  differently", and Archivo-for-reading against JetBrains-Mono-for-evidence says that with two
  families rather than one and a half.
- **"Light-first".** The product ships dark-first and the site is built from the product's
  tokens, so "light-first" would mean the site's default disagrees with every screenshot in
  the README. The site's dark mode is now the authored default for the same reason the
  product's is: it is the mode the design was drawn in.
- **The typography decision itself is now measured.** Two files rather than a named face:
  `packages/ui/src/assets/fonts/` holds the binaries with a `fonts-lock.json` recording their
  sha256 and their upstream, and `packages/ui/src/tokens/fonts.css` publishes the two families
  with the metrics overrides whose percentages were read out of each face's `hhea` table. A
  font named in a document is not a font anybody loaded; `index.css` used to name `Inter` and
  the product rendered in whatever the OS had.

**What this plan still owns.** Track A's structure — A1 through A13 — and the token gate
(A5), the animation gate (A4) and the state matrix (A8) are **still this plan's work**, and
Phase 1 of the superseding plan moved three of them:

- **A5** shipped: `theme-resolution.test.ts` now scans `apps/web/src` as well as
  `packages/ui/src/components`, which is why the hardcoded-palette detector has somewhere to
  run. It reads 45 colour candidates across both trees, not 40 across one.
- **A4** shipped: the sixteen plugin-only utilities are declared as `--animate-*` tokens in
  `packages/ui/src/tokens/motion.css` rather than by adding the plugin, and
  `PLUGIN_PROVIDED_UTILITIES` in `theme-resolution.test.ts` keeps the next one out.
- **A1's elevation scale** shipped, as three `--shadow-elevation-*` steps rather than the four
  levels described above, because the plane already has four surface tokens and a fifth
  elevation would have been a number nobody could place.

**A5's other half, which is still open:** `quarantine.tsx`'s hardcoded `bg-blue-600` and
`text-yellow-600` were fixed in commit 622bbec, before this plan's amendment. The defect that
survived it is the state semantics — `approved` renders in `text-error` and `rejected` in
`text-success` — and that is `DESIGN-1`, not this section.

### D6, D8 and D12 — unchanged

The redesign gates (D6), the honest capability surface (D8) and the in-repo VitePress site with
its own gate (D12) are untouched. The superseding plan routes the site's *appearance* through
the product's token file rather than defining a second palette, and that is a change to D13's
typography, not to D12's architecture.

---

## 2. Verified current truth (re-measured against the tree, 2026-09-26)

The prior master plan's premises are **partly stale**. Q0.10 and Q0.16 have landed; Q0.19 is largely done; Q1–Q5, P0–P5 have not started.

### 2.1 Landed since the prior plan — do not re-do

| Item | Evidence |
|---|---|
| **Q0.10 security hot-fixes** | `routes/execution.ts:908` returns `409 JOB_LEASE_REQUIRED`; `drizzle-execution-store.ts:88-91` has a `jobScope()` workspace narrowing helper threaded through the write path; `execution-lease-scope.test.ts` (`:120,138,148`) proves cross-workspace rejection |
| **Q0.16 fail-closed defaults (verified subset)** | `junit-xml.ts:56,58` return `'unknown'`; `dashboard.ts:413,612` default `'pending'`; `dashboard.ts:652,694,892` default `'viewer'` |
| **Q0.19 design tokens (mostly)** | `index.css:8` imports `packages/ui/src/tokens/theme.css` (27 tokens, one `@theme inline` block). `apps/web/src/theme-resolution.test.ts` compiles the real Tailwind theme and does selector-level resolution — with a self-check that the detector can fail (`:314-326`) |
| **Q0.11 item 1 error taxonomy** | `apps/api/src/errors/` with `DomainError`, `findSqlState` cause-chain walk, `boundary.ts`; 29 tests + a PGlite-backed classification suite |
| **Q0.17 items 4, 14, 15** | `tests/integration/src/migrations.ts` applies the real graph in journal order; `.semgrep.yml` and `.gitleaks.toml` repaired with config self-checks; `secret-scan.mjs --self-test` (12 cases) |
| **Q0.18 items 1, 2, 3, 5, 6, 7, 10, 11, 12, 14, 15, 16** | Compose secrets, healthchecks, Docker `chown`, nginx non-root on 8080, security headers, `container-runtime.mjs`, format globs, `vitest` `projects`, 145 catalog pins, `tsconfig.scripts.json` |
| **Clean test hygiene** | 151 test files. **Zero** `.skip`/`.only`/`xit`/`xdescribe`/`todo`/`skipIf`/`runIf`/`fails`. **Zero** test files with no `expect(`. Double-enforced via `scripts/disabled-tests.mjs` shared by ESLint and the preflight |

### 2.2 The defining finding: the measurement system is broken, not merely incomplete

**Four of nine CI jobs cannot pass. `pnpm verify` and `release-gate.yml` are permanently red.** These are configuration defects, not missing features:

| # | Defect | Evidence | Fix |
|---|---|---|---|
| **F1** | All three E2E jobs fail at config load — no workflow sets `DATABASE_URL` or `E2E_ALLOW_IN_MEMORY`, and `playwright.config.ts:24-31` *throws* when both are absent | `.github/workflows/unified-ci.yml` has zero `DATABASE_URL` and zero `services:` | W0.1 |
| **F2** | The `product` Playwright project is derived from spec files minus the vertical slice; `e2e/` holds exactly one spec, so the set is empty and `playwright.config.ts:120-125` throws **in CI only** | `playwright.config.ts:104-125` | W0.2 |
| **F3** | `security:verify` ends in `security:static`, which exits 1 (`not_configured`) when semgrep/gitleaks are absent — and no workflow installs them | `scripts/static-analysis.mjs:57-99`; `package.json:41` | W0.3 |
| **F4** | `coverage:ratchet` requires `<pkg>/coverage/coverage-summary.json`; **10 of 19** ratcheted packages have a bare `vitest run` test script. No `coverage/` directory exists anywhere | `scripts/coverage-ratchet.mjs:100-104`; package `test` scripts | W0.4 |
| **F5** | The ratchet is not in PR CI at all — only in `pnpm verify`, which only runs in the dispatch-only `release-gate.yml` | `package.json:42`; `release-gate.yml:3-4` | W0.5 |
| **F6** | `apps/api/vitest.config.ts:10-29` and `apps/web/vitest.config.ts:10-28` lack `all: true`, so V8 reports only files a test happened to import — their thresholds are satisfiable by never importing an untested module. `apps/web` also uses thresholds (85/85/91/85) that diverge from `vitest.shared.ts:18-23` (90/90/90/80) | both configs vs `vitest.shared.ts:28-30` | W0.6 |
| **F7** | `oci:build` never writes a digest back; all three `runners/*/manifest.json` are `buildStatus: "unbuilt"`, `imageDigest: null`, and have **no `imageRef` key**, so `oci-verify:100-104` would fail even with digests filled | `scripts/oci-build.mjs:23-33`; `scripts/oci-verify.mjs:73-86,100-104` | W0.8 |

Two more silent-pass holes: `unify-preflight.mjs:45-56` returns `[]` from `gitFiles()` on any `git` failure, so the generated-paths check passes vacuously; and `turbo.json:36-54` sets `outputs: []` on 19 of 22 `#test` overrides, cancelling the `coverage/**` output declared at `:20` — which compounds F4.

**Consequence:** every coverage, quality, and performance number in the rest of this plan is decoration until Wave 0 lands. That is why Wave 0 is a hard merge gate for all four tracks.

### 2.3 Product state

- **8 web routes** (`routes/index.tsx`, `login.tsx`, `dashboard.tsx`, `dashboard/{index,run-detail,analytics,quarantine}.tsx`, `__root.tsx`) — one is `export {}` (`reporting.tsx`), one is **unreachable** (`/dashboard/quarantine` is absent from `route-manifest.ts:1-7`, so `Sidebar.tsx:39` never links it) despite being a 142-line screen with a 111-line test suite.
- **No React error boundary anywhere.** A render throw unmounts the entire SPA to a blank page. `packages/ui/DESIGN-MAP.md:15` lists `ErrorBoundary` as if it existed.
- **19 of 28 UI components unconsumed:** `Select`, `Toggle`, `Textarea`, `Label`, `Alert`, `Dialog`, `Drawer`, `Popover`, `Tooltip`, `Tabs`, `Breadcrumbs`, `NavItem`, `Toast`, `Avatar`, `AppShell`, `Stack`, `Grid`, `Container`, `Splitter`.
- **13 non-resolving animation utilities** ship in 7 files (`animate-in`, `fade-in[-0|-90]`, `zoom-in-95` in `CommandPalette.tsx:110,114`, `Tooltip.tsx:25`, `Dialog.tsx:54`, `Drawer.tsx:18`, `Popover.tsx:54`, `EmptyState.tsx:6`) — no `tailwindcss-animate` dependency, no `@plugin`, and the gate's `REMOVED_IN_TAILWIND_V4` list doesn't cover plugin utilities.
- **Data layer:** 6 hand-rolled hooks reimplementing the same `mounted` guard; **zero `AbortSignal` on all 9 `fetch` sites**; no timeout, no dedup, no cache sharing. `routes/dashboard.tsx:338` calls `useRuns` *before* the `:341` early return, so every dashboard child page opens **2 `EventSource` connections + 2 five-second pollers** (3 + 2 on run-detail). No `Last-Event-ID` resume (`lib/api.ts:193-264` never reads `message.lastEventId`). `lib/api.ts:104` uses `schema.parse`, so a `ZodError` is rendered verbatim to the user at `run-detail.tsx:189`; `:179` detects 404 by string-matching the error message.
- **Zero accessibility instrumentation:** 0 `aria-live` in `apps/web` despite a live SSE event timeline and a LIVE/RECONNECTING indicator; 0 axe, 0 `user-event` anywhere; `Table.tsx:54-78` sort headers are mouse-only.
- **8 dead files / 239 lines** in `apps/web` kept alive by their own tests, including `components/shared/ErrorState.tsx` (the repo's error component, never rendered) and `RunExplorer.tsx` — which `README.md:38,51` advertises as Implemented and which the capability register cites as `real` evidence.
- **Two uncovered production cores:** `apps/worker/src/postgres-store.ts` (~580 lines, the *production* store — only the in-memory one is tested) and `apps/runner/src/playwright-reporter.ts` (the runner's core evidence translation). `apps/worker`'s ratcheted 57/43/62/59 is reached precisely because the real DB path is never measured.
- **P0 not started:** `apps/api/src/routes/runs.ts` still exists, shadowed by `routes/execution.ts:501` with an incompatible response shape (its test passes because it builds an app *without* `createExecutionRoutes`, hiding the shadowing). `apps/worker/src/main.ts` has no `JobHandler` — the worker reaps leases and polls schedules but can never execute a job. `packages/automation` (393 tested lines) is imported by no application. `agents.ts` returns `501 AGENT_NOT_CONFIGURED` for all 15 domain×action combinations. `/api/v1/features` is empty.
- **The only E2E runs against the in-memory API** (`e2e/integration/vertical-slice.spec.ts`, 5 tests), so the durable path has no browser-level proof. Worse, `:303-305,326-328` sets `window.__pollDisabled`, which **no code reads**, and then writes a hard-coded `"PASSED"` evidence file regardless of mechanism.
- **Evidence written to `.sisyphus/evidence/`** (gitignored) — the artifacts the suite exists to produce are never committed or uploaded.

### 2.4 Gate and tooling inventory

- **Missing root scripts:** `review`, `review:pr`, `complexity`, `duplication`, `mutation`, `quality:baseline`, `test:a11y`. `db:check` exists.
- **`eslint.config.js` loads exactly two plugins** (`@eslint/js`, `typescript-eslint`). No `sonarjs`, `security`, `jsx-a11y`, `testing-library`, `react-hooks`, `import-x`, `ban-ts-comment`. **Type-aware linting is off** (`recommended`, not `recommendedTypeChecked`) — so `no-floating-promises`, `no-misused-promises`, `await-thenable`, `no-unsafe-*` cannot run. No complexity or size ceilings.
- **Only 3 of 22 packages declare coverage `thresholds`**, and those 3 are the only ones whose test script can satisfy them.
- **Zero-branch ratchets:** `packages/connectors/{github,jira,slack}` and `packages/db` sit at branch 0 / functions 0 — those metrics can never fail.
- **Undocumented coverage exclusions:** `apps/api` excludes `src/index.ts`, `drizzle-execution-store.ts` (the largest file in the repo), `drizzle-realtime-feed.ts`, `execution/index.ts` — all four have real tests and no written reason. `packages/shared-contracts` excludes `src/**/index.ts`, contradicting the explicit policy in `vitest.shared.ts:50-52`. `docs/quality/coverage-exclusions.md` does not exist.
- **CI is clean where it can be:** 3 workflows, 12 jobs, every action SHA-pinned (zero tag pins), `permissions: contents: read` on all three, `timeout-minutes` on every job, **zero** `continue-on-error`, **zero** `|| true`, **zero** conditional `if:` skips.
- **11 well-written AI agent files, zero human governance files:** no `CODEOWNERS`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, PR/issue templates, `docs/adr/`, or `docs/quality/`.
- **Semgrep rule defects:** `no-comment-only-catch` uses `...anything...` (not valid deep-expression syntax) in its `pattern-not`, so it would fire on all **37** try/catch sites in scope; `no-string-concat-sql`'s `pattern-not` duplicates its own `pattern-either` alternative. Scope is `apps/api/src packages tools scripts e2e` — `apps/web`, `apps/runner`, `apps/worker` are never scanned.
- **Two strong artifacts to build on:** `.gitleaks.toml` (every allowlist entry has a one-line reason; the over-broad `vault-test-fixture` rule is gone) and the 5 `pnpm.overrides` (each with an advisory ID, rationale, and review date). But the review dates are `2026-06-30` and **~3 months overdue with nothing tracking them**.
- **Defective docs:** `api-versioning-strategy.md` prescribes Fastify for a Hono/SSE codebase; `parity-matrix.md:7-9` has three broken links; `secret-rotation.md` rotates `AUTOMATE_DASHBOARD_API_KEY`/`VAULT_PASSWORD` (real: `AUTOMATE_API_KEY`/`VAULT_SECRET`), points at a gitignored `.automate/auth.json`, references a nonexistent "Settings > Access Control" screen, and describes a **WebSocket** transport in an SSE codebase; `dependency-vulnerability-sla.md` documents a nightly Gitleaks run that never runs; `README.md` documents port 3456 while `vite.config.ts` proxies to 3000, and `README.md:38,51` advertises dead `RunExplorer` as Implemented; `AGENTS.md` lists `apps/runner/` twice; two ADRs are both ADR-003 with no ADR-001. `.github/COMMIT_MSG_v1.0.0.txt:44-49` claims "All 28 Turborepo tasks passing", "366 unit tests", and "Security scans clean (Semgrep, gitleaks)" — all three contradicted by F1–F4.
- **Documentation surface, measured:** `docs/` holds 3 directories (`architecture/`, `migration/`, `operations/`), 4 short files, and one **40 KB** `PRD_QAce_Ecosystem_v2.md` that prescribes FastAPI, InfluxDB, Grafana, Allure, and Gemini — none of which is the architecture, and none of it marked superseded. **No `docs/quality/`, no `docs/adr/`, no generated capability register, no link checker, no doc-drift gate.** **No `site/`** and no Pages workflow, so the project has no public presence and no shareable link preview. Per-package READMEs are absent from all 22 packages.
- **The pattern the docs get wrong is uniform.** A document asserts something the code does not do — a port, a secret name, a transport, a nightly job, an implemented component, a passing gate count. Six independent instances, all in prose, none checkable. Track E's answer is not more careful writing; it is `scripts/docs-drift.mjs` (E4) and site-doctor's no-typed-claims check (E5), so the claim is *verified* rather than *reviewed*.

### 2.5 Foundations that already exist (do not rebuild) and new dependencies (all new)

Three things the plan builds on rather than invents:

- **A correlation id already exists.** `apps/api/src/index.ts:114` injects `requestId: (c) => c.req.header('x-request-id')?.trim() || randomUUID()` into the error boundary, and every error response already carries `error.requestId` — proven at `errors.test.ts:169-173` and `db-error-classification.test.ts:141-144`. `ErrorBoundaryOptions:9` declares it as a contract. **D1 extends this into a correlation context that reaches the worker, the runner, events, and artifacts.** It is not a new mechanism.
- **A logging seam already exists.** `ErrorBoundaryOptions:7` declares `log?: (message, context) => void`, defaulting to `console.error` at `:34`, deliberately injected "so tests can assert what was logged." **D2 supplies a real structured logger at that seam** rather than introducing a new abstraction.
- **The evidence-explorer API already exists.** `routes/execution.ts` mounts `GET /api/v1/runs/:runId` (`:719`), `/artifacts` (`:586`), `/artifacts/:artifactId` (`:762`), `/events` (`:639`), `/gate` (`:610`), `GET /api/v1/releases/:releaseId/readiness` (`:606`), and `GET /api/v1/integrations/maturity` (`:758`). **A14 needs no new endpoint** — it needs a UI over reads that already work, plus a 404 path fix.

Every QA dependency is genuinely new. Confirmed absent from every `package.json` and the workspace catalog: `@tanstack/react-query`, `@testing-library/user-event`, `axe-core` / `@axe-core/playwright` / `vitest-axe`, `fast-check` (present only transitively via Vitest 4, never declared), `@stryker-mutator/core`, `jscpd`, `knip`, `eslint-plugin-sonarjs`, `eslint-plugin-security`, `eslint-plugin-jsx-a11y`, `eslint-plugin-react-hooks`, `eslint-plugin-import-x`, `eslint-plugin-ban-ts-comment`, `eslint-plugin-testing-library`. `@opentelemetry/api` is already in the lockfile transitively. `semgrep` and `gitleaks` remain external binaries.

**The migration tooling is defective in ways that matter here.** `packages/db/src/migrate.ts:18,26,29,30,37,40` applies migrations with no advisory lock, so two instances can apply the same migrations concurrently; its `argv[1] === import.meta.url` guard is false on Windows and for any symlinked bin, so the CLI can exit 0 having applied nothing; the connection string is unvalidated; and "success" is logged without listing what was applied. The old plan's `migrate:apply` was to stay blocked until resumable waves and restore evidence exist.

---

## 3. Track and wave structure

```
Wave 0  Trustworthy Signal   ── hard merge gate for ALL tracks (shared foundation)
   │
   ├─ Track A  UI/UX Excellence          (redesign: dark-first dense evidence console)
   ├─ Track B  Functional Perfection     (durable product path)
   ├─ Track C  Comprehensive Coverage    (static analysis, mutation, property, perf)
   ├─ Track D  QA-Centric Optimization   (observability, testability, register, audit)
   ├─ Track E  Documentation & Site      (README, governance, ADRs, doc-drift gate,
   │                                      VitePress site + its own 10-check gate)
   │
   ├─ §12    Migration path               (additive-first; cut across B, C, D — not a
   │                                        separate work stream, but a hard gate on all
   │                                        three because every schema change is its own
   │                                        expand/switch step with its own proof)
   │
   Backlog   BK-1 … BK-10  (named, with entry criteria — not deleted)
```

Work is parallel (D2). **Gate promotion is ordered:** `W0 → B → A → C → D → E`. The migration path (§12) is not a sixth track: it is a gate that B, C, and D each pass through when they touch the schema, and its runner repair (W0.11) is a Wave 0 prerequisite. **Track E is last** because it consumes the generated capability register (D6) and the quality report (D7) — documenting a capability before the thing that proves it exists would reproduce the exact failure it is meant to prevent.

---

## 4. Interlock contract (replaces the old plan's implicit rule)

1. **Wave 0 is a hard merge gate.** No task in Tracks A–D merges before W0 is green. Reason: F1–F7 make every number downstream unmeasurable.
2. **No gate reports green on `not_configured`.** Every `not_configured` is enumerated with a machine-readable reason in the nightly report (D7).
3. **Track A screens merge only behind Track B's data contracts** (B5 base URL, B12 OpenAPI, A6 query keys). A screen built on an unstable contract is rework.
4. **Track C's floors are measured only on a green Wave 0 and only ratchet upward.** `coverage-baseline.json`, complexity, and duplication numbers may only improve.
5. **Track D's capability register may only claim what a test proves.** A claim without an evidence command is a D6 failure, not a doc edit.
6. **Every new or changed source file has a test, or an entry in the coverage-exclusions register.** Enforced in D11, not by convention.
7. **Gate promotion stays ordered even though work does not.** Four unmeasured tracks is how the current doc-drift situation arose.

### 4.1 Merge mechanics (how "parallel" stays safe on one repository)

The four tracks are work streams, not merge units. Every track touches shared files — `package.json`, `eslint.config.js`, the vitest configs, `apps/web/src`, the API composition root — so concurrent merges would conflict on all of them.

1. **Waves are the merge unit.** All four tracks work concurrently. Merges happen in wave order: `W0 → B → A → C → D`. Nothing from wave *n+1* merges until wave *n* is green.
2. **Explicit path ownership per track.** A written ownership table (part of the wave kickoff) assigns each path prefix to exactly one track. A track needing a file it does not own opens a small PR against that track's interface rather than editing it directly.
3. **Interface files have a single owner.** These are edited by one track only, and other tracks consume them: the root `package.json` script block, `eslint.config.js`, `vitest.shared.ts`, `apps/api/src/index.ts` (composition root), `apps/web/src/router.ts`, and `apps/web/src/lib/api.ts`. Interface changes are separate PRs with a stated reason.
4. **Per-wave integration branch.** Each wave gets one integration branch. Individual task PRs land there; conflicts are resolved in that branch, not by rebasing four streams against each other.
5. **No feature flags.** Single-tenant and self-hosted, so a flag buys nothing but a second code path to test. Ordering replaces flags.
6. **PR budget.** ≤400 changed lines; ≤800 requires a written justification in the body. Mechanical sweeps (deleting dead files, migrating a class name) are split into reviewable steps so the reviewer stays useful.

---

## 5. Data flow (the shape every track depends on)

Two flows matter. The first is mostly built — the annotations mark what is already verified (`✓`) versus what this plan fixes (`→`).

### 5.1 Control flow — enqueue to gate (Track B)

```
CLI / CI webhook / UI form
  └─ POST /api/v1/runs            idempotency-key, config, optional retryOfRunId
      └─ createRun                one transaction, idempotency key re-checked
          └─ outbox append        ✓ workspaceId threaded;  → dedupeKey unique per (workspaceId, key)   [§12 M1]
              └─ worker lease     ✓ workspaceId scoped;    → real JobHandler                            [B2]
                  └─ runner       ✓ both lease credentials required, 409 JOB_LEASE_REQUIRED
                      ├─ appendEvents      ✓ one transaction per event, dedupe key, FOR UPDATE re-read
                      │   └─ outbox append → SSE cursor advances ONLY after the listener resolves  [C6/Q0.11]
                      │       └─ GET /api/v1/events          → one shared EventSource                 [A6]
                      └─ POST /jobs/:jobId/artifacts        bounded body, checksum, unique temp name ✓
                  └─ POST /jobs/:jobId/complete   ✓ leaseOwner === runner.id enforced
                      └─ gate evaluation    → total === 0 && passed ⇒ unknown + evidence:NO_TESTS   [C9]
                          └─ GET /api/v1/runs/:runId/gate
```

The ✓ marks are the Q0.10/Q0.11 work already verified in §2.1. The → marks are this plan's work. Ten of fourteen steps are sound; the four marked → are where correctness still leaks.

Two invariants carry the whole product, and both are verified by the durable E2E:

- **Fail-closed.** Missing evidence yields `unknown` with a named reason, never a pass. `total === 0 && outcome === 'passed'` must evaluate to `unknown` with `evidence:NO_TESTS`.
- **Lossless realtime.** The SSE cursor advances only after the listener resolves, each subscriber is isolated, and `bus.publish` is non-rejecting by contract. Today the cursor advances first and the error is swallowed, so event loss is silent and permanent per subscriber.

### 5.2 Evidence flow — the correlation chain (Track D, consumed by A14)

This is the flow the redesign makes visible. One id, created at the edge, carried by everything:

```
x-request-id header  ──or──▶  randomUUID()          apps/api/src/index.ts:114
        └─▶ request context (AsyncLocalStorage)     D1
            ├─▶ every log line                       D2
            ├─▶ run_events row                       appendEvents
            ├─▶ job claim: leaseId + fencingToken
            ├─▶ runner event batch + response header
            ├─▶ artifact metadata (checksum, size, kind)
            ├─▶ gate evaluation                      policyHash in the evaluation id
            └─▶ error response body                  error.requestId  (already exists)
```

A QA engineer starts from one id in the redesigned evidence console and reaches every log line, event, artifact, and gate decision that id produced. **The evidence console's job (A14) is to make this chain legible to a human** — which is why D1 lands before A14 in gate-promotion order, and why the console is built on the reads that already exist rather than on new endpoints.

### 5.3 The three-outcome rule

Every gate, every capability row, and every evidence field resolves to exactly one of:

- **pass** — checked, and held.
- **fail** — checked, and did not hold. Named reason.
- **`not_configured`** — not checked, with a printed reason for *why* and for *which parts did run*. Never a pass, and never silent.

This is the rule that makes the plan's "10/10" claim falsifiable rather than aspirational.

---

## 6. Wave 0 — Trustworthy Signal (blocks everything)

Each item ends with the evidence that proves it.

- **W0.1 — E2E can run in CI.** Add a `postgres:16-alpine` service plus `DATABASE_URL`, and a MinIO service, to the `api-e2e`, `e2e`, and `vertical-slice` jobs in `unified-ci.yml`. Keep the hard-fail at `playwright.config.ts:24-31` — it is correct. *Evidence: `playwright test --project=vertical-slice -g "API"` exits 0 in CI with `DATABASE_URL` set; the same command without it still fails fast.*
- **W0.2 — The empty `product` project stops being a CI crash.** Report the empty set as an explicit `not_configured` with a reason in the job summary (B8 grows real specs). *Evidence: `pnpm test:e2e` in CI completes and prints the reason.*
- **W0.3 — `security:verify` can pass.** Install semgrep and gitleaks (SHA-pinned) in the `quality` job. Fix the two rule defects (`no-comment-only-catch` `...anything...`; `no-string-concat-sql` self-contradictory `pattern-not`) and prove it by running semgrep over the current tree. Extend the scan scope to `apps/web`, `apps/runner`, `apps/worker`, `tests/`, `infra/`, `runners/`, `performance/`. Add the missing `security:semgrep` script that `.semgrep.yml:14` already references. *Evidence: `pnpm security:verify` exits 0; the semgrep run reports the expected 37 `try/catch` sites before the rule fix and 0 after.*
- **W0.4 — Coverage is actually produced.** Add `--coverage` to the 10 test scripts lacking it (`apps/worker`, `packages/auth`, `packages/db`, `packages/realtime`, `packages/ui`, `packages/connectors/{github,jira,sdk,slack}`, `tools/migrate-cli`). Remove the 19 `#test` `outputs: []` overrides in `turbo.json:36-54` that cancel the `coverage/**` output. *Evidence: `coverage/coverage-summary.json` exists for all 19 ratcheted packages.*
- **W0.5 — The ratchet runs in PR CI.** Add `pnpm coverage:ratchet` as its own required job after `unit-and-coverage`, writing a per-package table to the job summary. Add `pnpm test:performance` and `pnpm smoke:local` to a scheduled job, or mark them `not_configured` with a reason. *Evidence: the ratchet appears in the required-checks list and produces real numbers.*
- **W0.6 — `all: true` everywhere.** Bring `apps/api/vitest.config.ts` and `apps/web/vitest.config.ts` onto `standardCoverage` (`all: true` + explicit `include`) and one threshold set. Delete the stale `src/routeTree.gen.ts` exclusion (the file does not exist). Add `setupFiles` so jest-dom is loaded consistently — 4 files use the `/vitest` entry and the rest the bare entry. *Evidence: adding a deliberately untested module to `apps/web/src` lowers its reported coverage.*
- **W0.7 — Zero-branch packages stop being ungated.** Set a non-zero branch/functions floor for `packages/connectors/{github,jira,slack}` and `packages/db`. Create `docs/quality/coverage-exclusions.md` justifying every excluded path: the four undocumented `apps/api` exclusions and `shared-contracts`' `src/**/index.ts`. Reconcile `shared-contracts` with the stated policy in `vitest.shared.ts:50-52`. *Evidence: the ratchet fails if a branch floor is breached; the exclusions doc has one row per excluded glob.*
- **W0.8 — Container images are real or the claim is withdrawn.** Make `oci-build.mjs` write `imageRef`, digest, and `buildStatus` back into the manifest (it currently never does). Then either install the real toolchains in `runners/{playwright,k6,zap}/Dockerfile` (currently `node -e console.log(...)`, `k6 version`, `zap.sh -version` stubs) or delete the isolation claim from the docs and move the images to `BK-8`. *Evidence: `pnpm oci:build && pnpm oci:verify` either passes with a runtime-verified digest or reports the missing runtime as `not_configured` with a reason.*
- **W0.9 — No silent passes.** Add a `no-silent-skip` rule and script asserting no `continue-on-error`, no `|| true`, no `exit 0` inside a gate, and that every conditional skip emits a machine-readable `not_configured` reason. Fix `unify-preflight.mjs:45-56`, where `gitFiles()` returns `[]` on any `git` failure and the generated-paths check then passes vacuously. Add the missing `coverage-baseline.json`, `.semgrep.yml`, `.gitleaks.toml`, `playwright.config.ts`, `commitlint.config.js`, `tsconfig.scripts.json`, `vitest.config.ts`, and `vitest.shared.ts` to `turbo.json` `globalDependencies`. Add the missing `lint` script to `tools/migrate-cli` and the missing `build` to `tests/{contract,integration}`.
- **W0.10 — Unused exports become a gate.** Add `knip` (or an equivalent check) to `pnpm verify`: no unused files, no unused exports, no unlisted dependencies. *Evidence: it names the 8 dead `apps/web` files, `tailwindPreset`, `ManifestRoute`, `isApplicationPath`, `_themeLoaded`, `DialogFooter`, `DrawerHeader`.*

- **W0.11 — The migration runner is trustworthy.** `packages/db/src/migrate.ts:18,26,29,30,37,40` has no advisory lock, so two instances can apply the same migrations concurrently; its `argv[1] === import.meta.url` guard is false on Windows and for any symlinked bin, so the CLI can silently exit 0 having applied nothing; the connection string is unvalidated; and success is logged without listing what was applied. Add a Postgres advisory lock around the apply, replace the entrypoint guard with a comparison that works on Windows and through symlinks, validate the connection string, and log exactly which migrations were applied. *Evidence: two concurrent applies serialize; the CLI exits non-zero and says why when the journal is inconsistent.* This is the prerequisite for §12.

**W0 gate:** every CI job either passes or fails for a real, named reason. `pnpm verify` completes. No `not_configured` without a printed reason. The ratchet produces real numbers for all 19 packages. No gate can exit 0 without having checked something.

---

## 7. Track A — UI/UX Excellence (dark-first dense evidence console)

### A1 — Design language: add only what Tailwind does not already serve
Per **D9**, `packages/ui/src/tokens/theme.css` stays the single source of truth and no class-name migration happens. Tailwind v4's default spacing and radius scales are already a coherent 4px system and are kept as-is. Add three scales that do not exist today, all consumed by the components:

- **Type scale** — 4 sizes with explicit line heights, as `@theme` tokens (`--text-*` / `--leading-*`).
- **Elevation scale** — 4 levels (overlay, raised, panel, sunken) mapped to the existing surface/border tokens, so borders and depth are one system.
- **Motion scale** — 3 durations + 2 easings as tokens, consumed by the transitions in A4.

Flip `:root` to **light** with `[data-theme='dark']` explicit, and add a **pre-hydration inline script** to `apps/web/index.html:2` to eliminate the guaranteed dark flash (`theme.css:42-43` currently maps `:root` to dark, and the document ships no `data-theme` and no blocking script).

Fix the semantic trap: `bg-primary` resolves to `--color-primary` = accent, while `tokens/colors.ts:116` documents it as surface and `theme.test.ts:145-150` cannot detect it. Rename to unambiguous tokens and correct the test that encodes the wrong mapping. Semantic colour stays reserved for run state (passed/failed/flaky/blocked/unknown) and gate verdicts.

### A2 — Delete the dead TS token layer
`packages/ui/src/tokens/{index,colors,typography,spacing,radii,shadows,motion,z-index}.ts` are consumed **only** by `tokens/theme.test.ts`, while every non-colour scale the app renders comes from stock Tailwind. Per **D9**, delete all seven rather than build a generator: the scales they describe are not the ones running, `tailwindPreset` is a Tailwind v3 `presets` shape v4 cannot consume, and `_themeLoaded` is a V8 coverage marker with no product meaning. `colorRamps`/`builtInColorNames` are also unreferenced, but `semanticColorTokens` is the drift check against `theme.css`, so keep that one and re-point its assertion at the real token names. W0.10 prevents recurrence. Fix `DESIGN-MAP.md:11,15`, which document a `Kbd` and an `ErrorBoundary` that do not exist.

### A3 — Error boundary and router error/404 components
Add `ErrorBoundary` to `packages/ui`, wire TanStack's `defaultErrorComponent` and `notFoundComponent`, and wrap the root outlet. Today a render throw unmounts the entire SPA to a blank page with no message, no recovery, and no report. Add a reporting hook that ships the error context (route, correlation id from D1) to the diagnostics endpoint. *Evidence: a test that throws in a route component renders a recoverable error UI with the error id visible, and the SPA does not blank.*

### A4 — Fix the 13 non-resolving animation utilities
Express the transitions in the motion scale from A1, or add the pinned animation plugin (catalogued) if the enter/exit primitives are wanted. Extend `theme-resolution.test.ts`'s `REMOVED_IN_TAILWIND_V4` list to cover plugin-provided utilities so this class of bug cannot recur. *Evidence: the token-resolution test resolves every animation utility used in the tree.*

### A5 — Extend the token gate to its full scope
`theme-resolution.test.ts:139-156` scans only `packages/ui/src/components`; **zero** `apps/web` colour utilities are verified today. Add `apps/web/src`. Add a Tailwind-palette-class detector — `bg-blue-600`/`hover:bg-blue-700` (`quarantine.tsx:59,110`) and `text-yellow-600` (`:134`) bypass the token system, render the wrong blue in dark mode, and invert the hover affordance. Fix those three sites. Replace the vacuous `theme/index.test.ts`. *Evidence: the test names all 7 hardcoded sites before the fix and 0 after.*

### A6 — TanStack Query and one shared SSE
Replace the 6 hand-rolled hooks. Thread `AbortSignal` through all 9 `fetch` sites (`lib/api.ts`, `auth/useAuth.ts`). Hoist a single `EventSource` to router level that invalidates queries, deleting the 2–3 per-page connections and the 5s poll fan-out caused by `routes/dashboard.tsx:338` running `useRuns` before the `:341` early return. Implement `Last-Event-ID` resume. Replace `schema.parse` at `lib/api.ts:104` with `safeParse` → a classified error, so a `ZodError` is never rendered as user-facing text. Replace the string-matched 404 detection at `run-detail.tsx:179` with a typed `ApiError.status === 404`. *Evidence: a run-detail page holds exactly one `EventSource`; a test asserts the count.*

### A7 — Route completeness and reachability
Add `/dashboard/quarantine` to `route-manifest.ts` — it is a finished screen with a test suite, unreachable today. Add a test asserting every registered route has a manifest entry and a sidebar link (extending `router.test.tsx:69-77`). Delete `routes/reporting.tsx` (`export {}`). Adopt `AppShell` in `__root.tsx` instead of the hand-rolled shell. *Evidence: the router test fails if a route is added without a manifest entry.*

### A8 — State-coverage matrix
Every route gets loading / empty / error / partial, all built from `packages/ui` primitives. Current gaps: `/login` has no loading treatment; `run-detail` uses 4 ad-hoc `<p className="text-fg-muted">` instead of `EmptyState`; `AuthGuard.tsx:24` returns `null` on 401 (blank page, no prompt to sign in); `quarantine.tsx:39-51` swallows a failed add with `console.error` and no UI; the 404 is TanStack's unstyled default. Wire or delete `components/shared/{ErrorState,LoadingState,EmptyState}.tsx` — 3 dead files kept alive by their own tests. *Evidence: a test enumerates the matrix and fails on a missing cell.*

### A9 — Accessibility to WCAG 2.2 AA, verified by axe
Add `@axe-core/playwright` and `vitest-axe`. Fix: `CommandPalette` is a modal with zero dialog semantics (`CommandPalette.tsx:110-161` — no `role="dialog"`, `aria-modal`, `aria-expanded`, `aria-activedescendant`); `Table.tsx:54-78` sort headers are mouse-only; `Toggle.tsx:51-57,83-93` gives one control two labels; `Dialog.tsx:51-62` has no accessible name; `AlertTitle` is an `<h5>` (heading-order break); `Drawer.tsx:82` reads a ref during render; `Input`/`Select`/`Textarea` interpolate a possibly-undefined `id` into `aria-describedby`, producing dangling `"undefined-error"` IDREFs; two undistinguished `<nav>` landmarks. Add `aria-live` regions for the SSE-driven status, the LIVE/RECONNECTING indicator, and the run-queued confirmation — `apps/web` has **zero** today, and ~~`Toast` (the one component that sets it) is unused~~ — **refuted 2026-09-29: `Toast` is rendered in 15 places.** It was the one component already doing this, and calling it unused pointed at replacing rather than reusing it. *Evidence: axe reports zero serious/critical on every route in both themes, including empty/error/loading states.*

### A10 — Real interaction tests
Add `@testing-library/user-event` to `apps/web` and `packages/ui` and convert the `fireEvent` suite. Every component gets a keyboard and focus-visible test. Add the missing `NavItem.test.tsx` — 1 of 28 components has no test at all. *Evidence: a keyboard-only traversal test reaches and activates every interactive element on every route.*

### A11 — One date/time/format layer
Three `formatDate` clones disagree on null handling (`'Not started'` / `'UNKNOWN'` / `Invalid Date`) with no locale, no time zone, and no offset — unacceptable in an evidence UI, and `'UNKNOWN'` currently means both "no timestamp" and "no value". Extract `lib/format.ts` on `Intl` with an explicit zone. Collapse the 2 `ACTIVE_PHASES` copies, the 4th phase list in `run-detail.tsx:19-29`, and the 3 tone mappers. *Evidence: one formatter, one vocabulary for unknown, a test per timezone.*

### A12 — One theme implementation
Three disagreeing cycles over one `localStorage` key: `NavBar.tsx:36-40` (light→dark→system), `ThemeToggle.tsx:6-10` (dark→light→system, and dead), `GlobalCommandPalette.tsx:29` (binary — `system` unreachable). Add the missing `prefers-color-scheme` listener; `ThemeProvider.tsx:34-39` samples once and discards the `MediaQueryList`, so an OS theme change at sunset never propagates. Wrap all `localStorage` in try/catch (`ThemeProvider.tsx:25,49`, `Sidebar.tsx:12,16`) — `CommandPalette.tsx:34-43` shows the correct pattern. Delete the dead `ThemeToggle.tsx`. *Evidence: a test flips the OS preference and asserts the DOM updates.*

### A13 — Wire or delete the orphaned design system
Each of the 19 unconsumed components is either used by a real surface or deleted with a recorded rationale. Fix `toggleVariants`, whose class is never applied (`Toggle.tsx:73` re-implements it inline). W0.10's unused-export gate prevents recurrence. *Evidence: knip reports zero unused files and exports; each remaining component has at least one consumer.*

### A14 — Redesigned evidence surfaces (the core deliverable)
Per **D10** the console is built on evidence the product genuinely has. Per §2.5 the reads already exist, so **this needs no new endpoint** — it needs a UI over working reads plus the 404 path fix from A6.

Turn `RunExplorer` — currently dead code at `components/dashboard/RunExplorer.tsx`, fetching a fourth hand-written path (`/api/v1/reporting/runs/{id}`) that `lib/api.ts` does not have, yet cited as `real` in the capability register and advertised in `README.md:38,51` — into the real evidence explorer over `GET /api/v1/runs/:runId` and its children.

Run detail becomes the dense evidence console. Everything below is available today:

- **Per-test attempts as first-class evidence.** Attempts already exist and are already rendered as `<details>` per test; the redesign promotes attempt count, first/last-seen, and pass/fail across attempts into the primary view, so flake is *observed* rather than asserted. This replaces the structurally-always-zero `flakiness` field noted in C9.
- **Quarantine state per test.** The table has a reader, a writer, and a fixed `pending` default, so this is real, not a placeholder.
- **The gate verdict beside the policy and thresholds that produced it** — plus the shard-completeness arithmetic, so a `partial` verdict shows *which shards are missing* rather than the word.
- **Artifacts with checksum, size, and kind**, authenticated and path-safe.
- **The full event timeline** as the run's causal history, not a log dump.

Design the IA so the deferred `BK-3` surfaces occupy a defined region — failure classification, clustering, correlations, known failures, suppression, self-healing locators — which renders an explicit `not_configured` panel citing the register row, and lights up when `BK-3` lands. **No invented data, no placeholder chart, no fabricated zero.** The product's claim is "evidence before claims"; a console that shows the evidence as the hero is the design, not a summary count above a table.

### A15 — Redesign verification
Hard merge gates: extended token resolution (A5), per-theme WCAG contrast for every semantic pair, keyboard traversal (A10), the state-coverage matrix as a test (A8), axe (A9), and the orphaned-component rule (A13). Non-blocking: Playwright screenshots of a curated golden set — every route × light/dark × empty/loading/error/populated — uploaded as artifacts for human review. Blocking visual regression runs in the nightly and release lanes with pinned fonts, viewport, and DPR, plus a documented baseline-approval workflow. *Evidence: a visual-regression failure blocks nightly; no visual gate is in the PR required list.*

**Track A gate:** axe zero serious/critical on every route in both themes; every route has all four states; zero dead components; one date layer; one theme implementation; every colour, type, elevation, and motion utility in both trees verified to compile; one `EventSource` per page.

---

## 8. Track B — Functional Perfection (durable product path)

- **B1 — Delete the shadowed route.** `apps/api/src/routes/runs.ts` is shadowed by `routes/execution.ts:501` with an incompatible response shape, and its test passes only because it builds an app *without* `createExecutionRoutes`. Delete both; assert the mounted route set in `index.test.ts`.
- **B2 — Give the worker a real `JobHandler`.** `apps/worker/src/main.ts` reaps leases and polls schedules but can never execute a job. Wire the canonical runner dispatch with lease renewal, timeout/abort, and graceful shutdown. *Evidence: a worker test enqueues a job and observes execution.*
- **B3 — Cover the two uncovered production cores.** `apps/worker/src/postgres-store.ts` (~580 lines) and `apps/runner/src/playwright-reporter.ts`. `apps/worker`'s 57/43/62/59 floor exists because the real DB path is never measured.
- **B4 — One `ExecutionStore` semantic contract.** A shared scenario suite — enqueue → claim → events → complete → gate, plus cancel, timeout, lease expiry, re-registration, terminal-event rules — executed against both implementations, failing on any divergence. Extract the shared `terminalStatus` / `isTerminalEvent` / registration contract. The two implementations currently disagree on status vocabulary (values the DB enum rejects), terminal-event rules, token rotation, and summary merging.
- **B5 — One configured API base.** 13 hardcoded `/api/v1/...` literals across 4 files with no `import.meta.env`; `auth/useAuth.ts` repeats the auth paths separately; `RunExplorer.tsx:9` invents a fourth. One config, validated at boot.
- **B6 — Fix the `retry()` evidence-integrity bug.** `useRunDetail.retry()` writes the new run into state while the URL, `id`, and event filter stay on the old one, so the page renders the retried run's phase/outcome/artifacts under the old run's URL, then flips on the next refetch. In an audit product this is a correctness bug. Navigate instead of mutating local state. *Evidence: a test asserts the URL, the rendered run id, and the event filter agree after a retry.*
- **B7 — Honest capability negotiation.** `/api/v1/features` is empty and `agents.ts` returns `501 AGENT_NOT_CONFIGURED` for all 15 domain×action combinations. Make it a real per-domain, per-layer report with a readiness reason and a probe. `modules/dashboard/index.ts:41-42` silently falls back to in-memory stores when `DATABASE_URL` fails — log it and surface it in `/features`. *Evidence: a test asserts every advertised capability has a probe that passes.*
- **B8 — The real E2E, on the durable stack.** The current spec runs against the in-memory API, so the durable path has no browser-level proof. Add a durable lane: Postgres + MinIO + worker + runner in containers, enqueueing a real Playwright run → executing → streaming → evidencing → gating. It becomes the release gate; the in-memory lane stays the fast lane. Fix the existing spec: `:303-305,326-328` sets `window.__pollDisabled`, which no code reads, so the SSE-vs-poll assertion rests on timing alone and then writes a hard-coded `"PASSED"` evidence file regardless of mechanism. Write evidence to `test-results/evidence/` and publish it — the current `.sisyphus/evidence/` path is gitignored, and the filenames are agent bookkeeping leaked into a product test.
- **B9 — Authorization matrix.** Every route × {unauthenticated, wrong scope, expired session, revoked session, replayed cookie} asserting the exact status and error code, with the route list **generated from the Hono app** so a new route cannot skip the matrix. *Evidence: the matrix test fails when a route is added without a row.*
- **B10 — Wire `packages/automation` or move it to backlog.** 393 tested lines imported by no application. Either wire the `AiGateway` port into the API composition (Ollama default, Kilo optional, dynamic model catalog, persisted profiles, approval flow) or record it as `not_configured` in the register and correct `README.md`.
- **B11 — Product-path consolidation.** One canonical serialiser (3 copies), one path sanitiser (4), one bearer parser (2), one event-type set (duplicated twice, rebuilt per event). Delete the misplaced test files that import `./reporter.js` for a service in `src/services/`, and the dead `createExecutionApiRoutes` / `createRunnerApiRoutes` aliases that imply two route families.
- **B12 — Contract authority and generated OpenAPI.** Collapse the six parallel vocabularies: job state (6 DB values vs 9 contract values, 4 shared, so `running → succeeded/expired/waiting_approval` violates `execution_jobs_state_check`); permissions (2 of 7 overlap); run status (five declarations including both `timedOut` and `timed_out`); event version (DB default 2, schema default 1, frame emits 1); `ReporterEventSchema` ×3; `RunEventEnvelopeSchema` ×4 aliases. Generate a `check()` for every enum column from the same constant array — ~25 enum columns have no DB-level constraint because drizzle's `text({ enum })` is compile-time only — and add a schema test that fails when an enum column lacks one. Generate an OpenAPI 3.1 document from the shared Zod contracts and add a contract test that it matches the mounted routes. *Evidence: the schema test names every unconstrained enum column; the OpenAPI test fails when a route is added or changed without a contract update.*

**Track B gate:** a clean checkout migrates, authenticates, enqueues a real Playwright run, executes it worker→runner, streams durable events, shows normalized evidence and artifacts, cancels/retries, recovers a lost lease, and evaluates a release policy — with no in-memory store on the path, proven by the durable-lane E2E as a required check.

---

## 9. Track C — Comprehensive Quality Coverage

- **C1 — Static analysis stack.** Add `eslint-plugin-sonarjs` (SonarQube's own rule catalogue running locally, rather than a SonarQube service — the prior plan's locked decision), `eslint-plugin-security`, `eslint-plugin-jsx-a11y`, `eslint-plugin-react-hooks`, `eslint-plugin-import-x`, `eslint-plugin-ban-ts-comment`, `eslint-plugin-testing-library`. Turn on the type-aware families that catch real defects: `no-floating-promises`, `no-misused-promises`, `await-thenable`, `restrict-template-expressions`, `no-unsafe-assignment/member-access/call/return`, `consistent-type-imports`, `consistent-type-assertions` (`objectLiteralTypeAssertions: 'never'`), `no-unnecessary-type-assertion`, `require-await`. One package per PR; never blanket-disable a rule. Convert the existing ad-hoc boundary blocks into one import-graph rule set driven by `docs/quality/boundaries.json`.
- **C2 — Complexity and size ceilings.** `complexity` ≤10, `max-depth` ≤4, `max-lines-per-function` ≤60, `max-lines` ≤400, plus `sonarjs/cognitive-complexity`. Track existing offenders in `docs/quality/debt-baseline.json` with a per-file budget — never silent exceptions.
- **C3 — Duplication.** `jscpd` at 3% with a reviewed ignore list, ratcheted from `debt-baseline.json`. Confirmed clusters to remove: 3 `formatDate`, 2 `ACTIVE_PHASES`, 3 tone mappers, 3 copies of the canonical serialiser, 4 path sanitisers, 2 bearer parsers, 6 event-version symbols, 3 role enums.
- **C4 — Mutation testing.** Stryker on the five core packages (`shared-contracts`, `reporting`, `reporter`, `automation`, `orchestration`) at `break: 75`, on PRs touching those paths plus nightly. This is the only measure that answers whether the assertions are real — and `packages/reporting/src/kpi.ts` currently has a test that **encodes** a known contradiction rather than catching it.
- **C5 — Property and fuzz tests.** Declare `fast-check` (already transitively present via Vitest 4, never declared) and cover what unit tests cannot: `canonicalJson`/`fingerprint` determinism across key order, number/string coercion, and `undefined`; `evaluateCompleteness` shard arithmetic (index 5 of 3 is currently silently ignored, and `duplicateShards` order makes the same logical run hash differently); the JUnit SAX parser against malformed, truncated, entity-bearing, and billion-laughs XML; the spool round-trip, tamper detection, and path-escape rejection; path sanitization; idempotency keys; lease/fencing transitions; SSE cursor arithmetic and retention-floor gap detection; the quality-gate truth table.
- **C6 — Failure injection.** Postgres down mid-transaction; object-store timeout; runner lost during `COLLECTING`; duplicate outbox delivery; out-of-order and duplicated event batches; clock skew across worker and runner; provider outage/timeout/rate-limit/malformed stream; artifact-store disk-full.
- **C7 — Real-stack integration.** Extend `tests/integration` from PGlite to real Postgres + MinIO from the container runtime: migration-from-previous-version, concurrent claim, lease expiry, idempotency, transaction rollback, outbox replay. `tests/contract` has **one** test file and needs the full producer/consumer fixture matrix — every reporter generation, version rejection, unknown-field behavior, deterministic ordering.
- **C8 — Performance budgets as tests.** Extend the k6 harness: API p95 <300 ms for ordinary authenticated reads/writes, dashboard usable <2 s, live event freshness <2 s, Playwright start <5 s after claim, artifact transfer bounded by configured limits. Fix the `checks` threshold drift — `performance/smoke.js:39` declares `rate>0.99` while `thresholds.json:24` records `1`, and `performance-gate.mjs:67-71` never inspects `checks`, so the disagreement is invisible. Add a per-endpoint `EXPLAIN` fixture: `listRuns` issues `1 + 3N` queries and a 10k-run workspace means ~30k queries per request, and `authenticateRunner` scans the entire `runners` table on every authenticated request because `tokenHash` has no index.
- **C9 — Fail-closed audit, verified.** The verified subset has landed (§2.1). Confirm the rest and add a `no-fail-open-default` rule plus a lint rule banning `as unknown as` in schema files: `total === 0 && outcome === 'passed'` must be `unknown` with `evidence:NO_TESTS`; the legacy reporter's constant `'0'.repeat(64)` result digest defeats the proof chain; the artifact `legacyAttachmentId` checksum exemption contradicts the contract; `flakiness: 'unknown'` is hardcoded by both producer adapters, so the flake rate is structurally always 0; `evaluateCompleteness(0, …)` returns `complete`; the KPI `denominator` contradicts the reported `value` so the three rates do not sum to 1; `quarantine.status` and API-key role defaults must keep their regression tests.
- **C10 — Test-quality guards.** Reject tests with zero assertions; forbid `.skip`/`.only`/`xdescribe`/`xit`/`todo`/`skipIf`/`runIf`/`fails` (already clean and double-enforced — keep it); forbid over-mocking in integration suites; require a negative or authorization test for every new route; typed default resolutions for every mock API.
- **C11 — Dependency hygiene.** The 5 `pnpm.overrides` are exemplary but the `2026-06-30` review dates are **~3 months overdue with nothing tracking them**. Add Renovate with grouped non-major updates, a weekly lockfile-maintenance job, and `osv-scanner` as a registry-independent second advisory source. Enforce the written-reason policy for new overrides. Bump `@types/node` `^22.15.3` → `^24` to match the `engines` floor and CI's `NODE_VERSION: 24.x`. Add `runners/**`, `performance/**`, `.github/agents/**`, `docs/adr/**` to the `format:check` globs. Add `license` fields to the workspace packages that declare none.

**Track C gate:** `pnpm lint` green with the full rule set; complexity ≤10 and duplication ≤3% on changed code; mutation ≥75% on the five core packages; every perf budget measured in CI; zero fail-open defaults; the authz matrix and property suites green.

---

## 10. Track D — QA-Centric Optimization

- **D1 — Extend the existing `requestId` into a correlation context.** `apps/api/src/index.ts:114` already injects `requestId` from the `x-request-id` header with a `randomUUID()` fallback, and every error response already carries it (§2.5). Promote it from a per-response field to a request-scoped context (AsyncLocalStorage) that also reaches: the worker's job claim, the runner's event batch, the persisted `run_events` row, the artifact metadata, and the gate decision. A QA engineer must be able to start from one id in the UI and find every log line, event, and artifact it produced. Also: echo the id as a response header so the browser network panel and a support ticket carry it. *Evidence: a test asserts one id appears in the log line, the event row, and the artifact metadata for a single execution.*
- **D2 — A real structured logger at the existing seam.** `ErrorBoundaryOptions:7` already declares an injected `log` function "so tests can assert what was logged," defaulting to `console.error` at `:34`. Supply a structured JSON logger there and route all request handling through it, with a documented field set (`ts`, `level`, `requestId`/`correlationId`, `runId`, `jobId`, `leaseId`, `runnerId`, `event`, `outcome`, `durationMs`). Never log prompts, tokens, raw credentials, or unbounded artifact bodies. Fix the swallowed failures the audit found: the outbox retention sweep discards errors with no logging and no `lastSweepError`, and the realtime feed advances its cursor *before* the listener runs and swallows the error, making event loss silent and permanent per subscriber with zero logging. *Evidence: the existing error-boundary tests keep passing unchanged, which proves the seam still works; a new test asserts the JSON shape.*
- **D3 — Metrics endpoint and health/readiness split.** `/metrics` in Prometheus format: run outcomes by domain, gate verdicts, event freshness, queue latency by phase, runner health/leases/slots, cancellation counts, artifact bytes, AI token and cost estimates. Readiness must expose `lastSweepError`, the realtime `lastError`, and any degraded-store fallback. `/health` and `/api/v1/health` currently differ by one field — build the base body once.
- **D4 — Run diagnostics: "why did this verdict happen?"** The product differentiator, and it does not exist. A surface answering: which policy, which thresholds, which shard arithmetic produced `partial` vs `ready`, which failure-taxonomy rule classified this failure, which flake attempt history informed the verdict, and which artifact backs each number — every field linked to its source row.
- **D5 — Testability infrastructure.** `@testing-library/user-event` (A10) plus seeded/reset fixture factories per package, an injected clock and RNG so time and flakiness are deterministic, the `fast-check` harness (C5), and a PGlite-backed factory for the execution store. **No test may depend on wall-clock time or `Math.random`.**
- **D6 — Self-verifying capability register.** Generate `docs/quality/capability-register.md` from the integration-maturity registry **and the test suite**, with an evidence command per row and a status vocabulary that cannot be edited without a passing check. The current register cites two `real` rows on false evidence (`RunExplorer` is dead code; a CI file was cited at a moment it did not exist), contradicts itself on `tool.playwright` vs `quality.browser`, has no `quality.mobile` row, and is pinned to a baseline commit with no "last reviewed" date. *Evidence: deleting the test behind any `real` row flips that row to `unverified`.*
- **D7 — Nightly quality report.** One artifact aggregating every gate: coverage per package, complexity, duplication, mutation, security findings, a11y violations, perf budgets, E2E results, and the full `not_configured` inventory. A `not_configured` gate appears as `not_configured`, never as a pass.
- **D8 — Harden the evidence and audit chain.** `nl_query_history` stores raw NL queries plus generated SQL — treat generated SQL as untrusted (read-only role, statement timeout, no DDL/DML, row cap, parameterized binding). Prove a complete immutable audit chain for every state change: `PATCH /runs/:id/status` writes no audit row today, allows any transition including out of a terminal phase, and can return 200 with a literal `null`; `audit_events` and `systemAuditEvents` duplicate each other with a colliding index prefix and no workspace column. Add retention, legal hold, and signed evidence bundles. Vault: move the SAML SP private key out of plaintext into `vault_entries` behind an `spPrivateKeyRef`; add a workspace column to connector credentials, which are `UNIQUE` on `connector_name` alone; bind vault rows with AAD so row A's ciphertext cannot be moved onto row B and still verify; constrain `iterations >= 600000` and `octet_length(salt) >= 16`.
- **D9 — The reviewer as a merge gate.** `scripts/review/` normalizing ESLint JSON + `tsc` + jscpd + semgrep + Stryker + a coverage diff into `findings.json` and a `REVIEW.md` in CodeRabbit's format (walkthrough, per-file `severity | category | file:line | finding | fix`, trivial diffs, out-of-diff notes). Diff mode `--base main` reports only changed lines and their direct callers; `--all` is a nightly reporting tool, never a merge gate. The ruleset lives as data in `.github/review-rules/rules.json` with id, category, severity, path globs, rationale, and fix guidance, mapped to the 11 existing `.github/agents/*.agent.md` personas so human and automated review share one vocabulary. Severity: `Blocker` (security, data loss, wrong release decision), `Critical` (bug on a product path), `Major`, `Minor`, `Nit`. CI fails only on Blocker/Critical; Majors are counted and ratcheted in `debt-baseline.json`. Add `pnpm review:pr` for branch name, conventional title, changed-line budget (≤400; ≤800 needs a written justification), a test for every behaviour change, and a test or an exclusions-register entry for every new source file. This is what makes C1–C6 enforceable in review rather than aspirational.

**Track D gate:** every run, gate decision, and artifact is traceable by one correlation id; a QA engineer can answer "why did this verdict happen?" from the UI; the capability register's every `real` row has a passing evidence command; the audit chain is proven complete; the reviewer blocks on Blocker/Critical.

Documentation and governance move to **Track E** (`E1`–`E6`) so one track owns every human-facing claim. The old `D9`/`D10` are now `E2`/`E5`; the reviewer stays here because it gates code, not prose.

---

## 11. Track E — Documentation and Public Site

The repo has 11 well-written AI agent files and **zero** human-facing governance, no `docs/quality/`, no `docs/adr/`, and a documented set of concrete lies (§2.4). The product's central claim is that it never overstates — and its own documentation currently does. This track makes the claim true of the repository itself.

Consumes D6's generated register and D7's quality report. Ordered last in gate promotion because both must exist first.

### E1 — README as the verified front door
Rewrite `README.md` around behaviour that exists and is measured. It is the most-read file in the repository and currently documents port **3456** while `vite.config.ts` proxies to **3000**, and advertises `RunExplorer` as *Implemented* at `:38,51` when the file is dead code that its own test keeps alive.

Required structure: a one-paragraph statement of what Automate is and is not; a **working 10-minute quickstart** that a stranger can follow from a clean checkout to a real run with real evidence; the **generated capability table** (D6) with `real` / `partial` / `not_configured` shown as-is; an **architecture diagram matching the real runtime** (Hono API, Postgres, worker, runner, object storage, SSE — not FastAPI, not WebSockets); only badges backed by a check that actually runs, with a note on what each one gates; and a **"What Automate cannot do"** section listing the `BK-*` backlog in plain language. Every claim links to the command that proves it. *Evidence: `scripts/docs-drift.mjs` (E4) passes with zero claims.*

### E2 — Governance set
`.github/CODEOWNERS` (mapped to the 11 existing `.github/agents/*.agent.md` personas, so an AI-assistant role and a human review role map to the same ownership), `SECURITY.md` with a real disclosure path and a stated response window, `CONTRIBUTING.md` covering the review budget, the evidence rule, and the `not_configured` convention, `CODE_OF_CONDUCT.md`, `SUPPORT.md` distinguishing a bug from a capability request, `.github/PULL_REQUEST_TEMPLATE.md` with the evidence checkbox, and `.github/ISSUE_TEMPLATE/{bug_report,feature_request,qa_gap}.md`. Each file gets a one-line purpose in `docs/quality/hygiene-register.md`. Also wire `commitlint.config.js` into CI (today only `.husky/commit-msg` invokes it), make `.husky/pre-commit` real with `lint-staged`, and correct `.github/COMMIT_MSG_v1.0.0.txt:44-49`, which claims all 28 Turborepo tasks passing, 366 unit tests, and clean Semgrep/gitleaks scans — all three contradicted by F1–F4.

### E3 — Architecture decision records
`docs/adr/` does not exist; numbering collides (two ADR-003, no ADR-001). Create the directory, renumber without collision, add ADR-001, and add `docs/adr/README.md` as an index with status (`proposed` / `accepted` / `superseded` / `rejected`) and supersession links. Every existing architecture decision gets recorded with its real evidence — Hono and SSE, Postgres-only durable queue, native reporting instead of Allure/Grafana/InfluxDB, Ollama/Kilo, single-tenant self-hosted, browser as the only mobile-free domain. Rewrite `api-versioning-strategy.md` for Hono, choosing header *or* path versioning — one choice — enforced by the B12 contract test. *Evidence: the ADR index resolves; `docs-drift.mjs` reports no unrecorded decision referenced in prose.*

### E4 — Anti-drift gate
`docs/` has no `quality/` and no `adr/` directory, and the defects in §2.4 are all the same failure: a document asserting something the code does not do. Create `docs/quality/` as the quality home (review standards, boundary rules, `debt-baseline.json`, `coverage-exclusions.md` from W0.7, capability justification, `hygiene-register.md`, `schema-migration-backlog.md` from §12.1) and add `scripts/docs-drift.mjs` as a gate, with its own tests. It asserts:

1. every relative link in `README.md` and `docs/**` resolves (three are currently broken in `parity-matrix.md:7-9`);
2. every `pnpm …` command in a fenced block exists in a `package.json` script;
3. every port number in prose matches the real value in `vite.config.ts`, the compose files, and the API;
4. every environment variable and secret name in prose matches `packages/config/src/config.ts`;
5. every transport named in prose matches the code — **SSE, never WebSocket**; the current security runbook describes a WebSocket transport with a log string that does not exist;
6. no page claims a capability whose register row is not `real` — the `D15` rule, enforced on the repo side as well as the site side;
7. no ADR is referenced without a record.

Then fix the prose it names: `secret-rotation.md` (rotates `AUTOMATE_DASHBOARD_API_KEY`/`VAULT_PASSWORD`; the real names are `AUTOMATE_API_KEY`/`VAULT_SECRET`; it points at a gitignored `.automate/auth.json` and a "Settings > Access Control" screen that does not exist), `dependency-vulnerability-sla.md` (documents a nightly Gitleaks run that never runs), `parity-matrix.md`, and `AGENTS.md` (lists `apps/runner/` twice; needs the quality commands, the severity policy, and the "no new capability without evidence" rule). *Evidence: `pnpm docs:check` is green; planting `port 3456` in a doc makes it fail.*

### E5 — The site (D12, D13, D15)
`site/` in-repo, VitePress, deployed to `https://sergey-bar.github.io/AutoMate/` with `base: "/AutoMate/"`.

**Structure** — same architecture as the reference, different identity and different content:

```
site/
  .vitepress/config.mts        base, dual theme, nav, sidebar, OG + social card
  .vitepress/theme/            Home.vue, the evidence-chain components, styles/
  guide/                       getting started · the five domains · the evidence model
                               quality gates · run lifecycle · architecture · configuration
  reference/                   API (from B12's OpenAPI) · capability register
                               configuration · environment variables · error codes · troubleshooting
  quality/                     how the gates work · the three-outcome rule · coverage and
                               mutation policy · security policy · accessibility statement
  roadmap/                     clearly labelled; not the pitch
  public/                      self-hosted fonts, favicons, social card
  scripts/                     gen-capabilities.mjs · site-doctor.mjs · lighthouse-run.mjs
```

**Visual identity (D13)** — light technical notebook with dark evidence panels. Light-first typographic chrome; a humanist or transitional **serif** display face against a **mono** for code and evidence; grid rules instead of gradients; no mythology, no aurora, no rune motif. **Every code block, evidence sample, telemetry panel, and capability row is a dark instrument surface in both themes** — that split is the thesis, not a style. Semantic colour is reserved for run state and gate verdicts, exactly as in `packages/ui/src/tokens/theme.css` (A1), so the site and the product share one palette. Fonts are **self-hosted, sha256-locked, and preloaded** — no third-party stylesheet, so the page renders its own wordmark without a cross-origin round-trip, and the display face is preloaded before first paint to keep CLS at zero.

**The site's own gate** — `site/scripts/site-doctor.mjs` plus tests, blocking the Pages job. Adapted from the reference's eight checks, plus two that are specific to this product:

1. **contrast** — every declared foreground/surface pair, per theme, against WCAG AA;
2. **no typed claims** — every number, verdict, and code sample on the site traces to a generated artifact; a hand-typed figure is a failure. The reference project shipped a hand-typed `70/100` beside a generated `75/100` on the page whose entire argument is that it never asserts what it has not measured; this check exists so that cannot recur here;
3. **asset budget** — per-file and total byte ceilings for JS, CSS, fonts, and images;
4. **no-JS** — all content readable with scripting disabled, because reveal-on-scroll that starts at `opacity: 0` is only ever rescued by script;
5. **motion budget** — a cap on infinite animations, all covered by a `prefers-reduced-motion` block;
6. **structural a11y** — landmarks, heading order, alt text, table headers, focus visibility;
7. **link integrity** — no dead internal link; external links checked on a schedule, not every build;
8. **brand palette** — the site's tokens conform to `packages/ui`'s, so the site cannot drift from the product;
9. **capability honesty** *(Automate-specific)* — no page claims a capability whose register row is not `real`; `not_configured` rows render as `not_configured`, and the roadmap page is the only exemption, because it is labelled as not-built;
10. **artifact staleness** *(Automate-specific)* — every generated artifact under `site/.vitepress/theme/generated/` is newer than the commit that last touched the source it derives from, so a stale number fails rather than shipping.

**Deployment** — `.github/workflows/pages.yml`: least-privilege top-level `permissions: contents: read` with `pages: write` and `id-token: write` scoped to the deploy job only, all actions SHA-pinned, `fetch-depth: 0` so VitePress `lastUpdated` is not dated to the build commit, a Lighthouse budget run, and the site-doctor gate **after** the build (checks 2, 6, 7, and 10 read the built HTML). `concurrency: { group: pages, cancel-in-progress: false }` so a publish is never cancelled mid-flight.

*Evidence: `pnpm --filter site build && pnpm --filter site doctor` is green; deleting the test behind a `real` capability row turns the site build red; planting a hand-typed number in a site page turns site-doctor red.*

### E6 — Documentation contract
State the rules the documentation must keep, in `CONTRIBUTING.md` and in the site: every claim carries an evidence command; a capability is `real`, `partial`, or `not_configured` and the third is never a euphemism for the first; a supersession is recorded rather than deleted; a broken link is a defect with the same weight as a failing test. D14 keeps the corpus English-only, and the extension point for translations is documented rather than pre-built.

**Track E gate:** `pnpm docs:check` green with zero unbacked claims; the README quickstart completes from a clean checkout; the ADR index resolves with no collision; the governance set exists and is linked from the hygiene register; the site builds, passes site-doctor on all ten checks, and its capability table matches the register exactly.

---

## 12. Migration path (additive-first, per D11)

Schema changes are unavoidable: B12 needs a generated `check()` for ~25 unconstrained enum columns plus the collapsed vocabularies, D8 needs vault AAD binding with `iterations`/`salt` constraints plus a `workspaceId` on connector credentials and a deduplicated audit table, and W0.7 changes exclusion policy. **No destructive change ships in this final phase.**

### 12.1 The expand/contract rule

1. **Expand** — a migration adds columns, tables, indexes, and `check()` constraints, each with a default that is valid for existing rows. The application keeps reading and writing the old shape.
2. **Switch** — application code begins reading the new column, constraint, or table. Both shapes are valid during this window.
3. **Contract** — a *later*, separately-gated migration drops or renames the old column. **Out of scope for this phase.** Every contract migration is written down in `docs/quality/schema-migration-backlog.md` with its expand step, so the next phase has the plan, not the archaeology.

The one deliberate exception: a `check()` that the current data already satisfies can land in the expand phase, because it is additive and cannot fail an existing write path. Every such constraint must be proven against the real migration graph first (§12.3) so an unnoticed violating row is discovered in the test, not in production.

### 12.2 Migrations in dependency order

| # | Migration | Serves | Notes |
|---|---|---|---|
| `M1` | Indexes only: `runners.token_hash` (an unindexed column is scanned on **every** authenticated request), the composite indexes behind the hot dashboard queries, and the `(workspaceId, dedupeKey)` uniqueness fix (the outbox `dedupeKey` is currently **globally** unique, so a cross-workspace collision silently drops an event) | C8, D8 | Zero application change. Safe first |
| `M2` | `notNull` + defaults: outbox `workspaceId` (currently nullable, so an event can be written, counted, and **never delivered**), `runnerIdentities.credentialHash` (nullable with no unique index, so two runners can share a hash), and `notNull` on the enum-constrained columns | B12, D8 | Expand-then-switch: write the value before constraining |
| `M3` | Generated `check()` constraints for every enum column from the same constant array, plus `check(iterations >= 600000)` and `check(octet_length(salt) >= 16)` on the vault | B12, D8, C9 | Proof: see §12.3. Also fix `runs.gateStatus`, whose enum cannot store `warning`, `unknown`, or `not_evaluated` from the contract |
| `M4` | Collapsed vocabularies as **new** columns: one `RUN_STATUS_VALUES` derived from `CanonicalStatusSchema.options`, removing the duplicate `timed_out` spelling so a `GROUP BY` cannot split one state in two; one `EVENT_VERSION`; one job-state source; one permission enum | B12 | The old columns stay readable. This is the only step where "no migration" would be wrong — the duplicate spellings are a live correctness bug, so the new column is written and switched to, and the old one is left in place |
| `M5` | Vault AAD binding: add the AAD/keyVersion columns, backfill with the row identity, then verify each row re-opens under its own AAD | D8 | A backfill migration, not a constraint. **Re-open verification is the test** — a row that fails to re-open is a defect found by the test, not a silent data loss |
| `M6` | Audit chain: a single deduplicated `audit_events` table (today `audit_events` and `systemAuditEvents` duplicate each other with a colliding index prefix and no `workspaceId`), with the fields the immutable chain needs — actor, operation, before, after, reason, correlation id | D8 | Expand: new writes go here. Old rows are retained, not migrated destructively |

### 12.3 Proof for every migration

`tests/integration` already applies the real migration graph in **journal order** through PGlite and diffs it against the Drizzle schema in both directions — every declared table exists, every declared column exists, and no table exists that the schema dropped. It also asserts the `0006` constraints through the database. Every migration in this plan lands with:

- a journal entry (the runner refuses to run if a journalled file is missing or a file has no entry);
- a `tests/integration` assertion that the constraint or column behaves through the database, not through a mock — the existing `quarantine` CHECK test, which returns a classified `422 CHECK_CONSTRAINT_VIOLATED` where it once returned an unclassified 500, is the template;
- a forward-compatibility check that the **previous** application version's queries still succeed against the expanded schema, which is what makes the switch step safe;
- a fresh-schema check that the migration applies cleanly to an empty database, not only to one already carrying data.

**Migration gate:** the migration suite is green, `migrate:apply` is idempotent, two concurrent applies serialize, and no contract migration has been written. `migrate:apply` remains blocked from any production cutover until a restore rehearsal exists (`BK-9`).

---

## 13. Named backlog (deferred, with entry criteria)

Not deleted — each becomes a candidate only when its entry criterion is met.

| ID | Scope | Entry criterion |
|---|---|---|
| `BK-1` | Five-domain execution engines (browser, API, load, security, Android) with real fixtures, cancellation, timeout, recovery, native evidence | Track B gate green; `packages/tool-sdk` exists |
| `BK-2` | AI gateway wiring, durable conversations/tool runs, bounded tool loop, AI workspace surfaces, cross-domain generation | B10 decision made |
| `BK-3` | QA-intelligence tables: flake engine, quarantine workflow, auto-triage, root cause/clustering, suppression, self-healing locators, auto-repair, defect graph | Fingerprint model stabilized (B12) |
| `BK-4` | Connectors end to end: GitHub/GitLab webhooks with signature verification, Jira, Slack, generic webhooks, delivery logs, dead-letter | Idempotent-retry + audit pattern from D8 |
| `BK-5` | `apps/cli`: `run`, `test`, `schedule`, `connect`, `doctor`, `replay`, `export`, `backup` — public API only, never the database | B12 OpenAPI generated |
| `BK-6` | Scheduler completeness: cron with timezone, blackout windows, misfire policy, quotas, priorities | B2 JobHandler stable |
| `BK-7` | Exports: JUnit, Playwright JSON, SARIF, Allure-compatible XML, signed evidence bundle | C9 fail-closed audit proven |
| `BK-8` | Real digest-pinned, non-root runner images replacing the three stubs | W0.8 decided which way |
| `BK-9` | Backup, restore, upgrade, rollback with rehearsal evidence; `migrate:apply` stays blocked until resumable waves and restore evidence exist | Storage parity complete |
| `BK-10` | The remaining OSS surface: a recorded demo that runs from a clean checkout, a measured time-to-first-run against E1's quickstart, a good-first-issue set generated from the `BK-*` entries, and discussion/roadmap upkeep. **The documentation site, README, governance set, and ADRs are no longer here — they are Track E.** | E gate green |

---

## 14. Validation commands

**Exist today:** `pnpm format:check` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:contract` · `pnpm test:integration` · `pnpm test:runner` · `pnpm test:e2e` · `pnpm test:performance` · `pnpm coverage:ratchet` · `pnpm security:verify` · `pnpm build` · `pnpm db:check` · `pnpm verify` · `pnpm verify:release` · `pnpm oci:build` / `oci:verify` · `pnpm smoke:local` / `smoke:rehearsal` · `pnpm migrate:{plan,validate,apply,verify}`

**Added by this roadmap, with the wave that adds it:**

| Command | Added by | Purpose |
|---|---|---|
| `pnpm quality:baseline` | W0 | Prints the current status of every gate metric, so the baseline is reproducible rather than remembered |
| `pnpm test:a11y` | A9 | axe across every route in both themes, plus component-level checks |
| `pnpm visual:review` | A15 | Capture the golden-set screenshot set as artifacts |
| `pnpm visual:regress` | A15 | Blocking visual regression, nightly/release lanes only |
| `pnpm mutation` | C4 | Stryker over the five core packages, `break: 75` |
| `pnpm duplication` | C3 | jscpd at 3%, ratcheted from `debt-baseline.json` |
| `pnpm complexity` | C2 | Per-file complexity/size against `debt-baseline.json` |
| `pnpm review` / `pnpm review:pr` | D11 | CodeRabbit-style diff review; PR hygiene checks |
| `pnpm register:check` | D6 | Regenerate the capability register and fail if a claim lacks evidence |
| `pnpm report:quality` | D7 | The nightly aggregated quality artifact |
| `pnpm migrate:test` | §12 | Applies the real journal in order against PGlite, diffs both directions against the Drizzle schema, asserts the forward-compatibility check, and fails on a missing journal entry |
| `pnpm docs:check` | E4 | `scripts/docs-drift.mjs` — links, commands, ports, env vars, transports, capability claims, ADR references |
| `pnpm --filter site build` | E5 | VitePress build, after `gen-capabilities` regenerates the site artifacts |
| `pnpm --filter site doctor` | E5 | The site's own 10-check gate; blocks the Pages job |
| `pnpm --filter site test` | E5 | Unit tests for the generators and site-doctor |

No cached output, no stale `.last-run` files, and no mock-only test counts as evidence.

---

## 15. Risks

| Risk | Response |
|---|---|
| **Parallel tracks outrun the measurement system.** Four tracks making unreviewable claims is how the current doc-drift situation arose | Wave 0 is a hard merge gate; interlock §4 orders gate promotion even though work is parallel; the nightly report (D7) enumerates every `not_configured` |
| **The redesign lands on screens with no data behind them.** A beautiful run-detail page over a thin product is wasted work | Interlock §4.3: Track A screens merge only behind Track B's data contracts. The redesign targets the evidence surfaces, which is where the product's value already is |
| **Visual regression becomes the next flaky gate.** Pixel diffs fail on font rasterization and GPU | D6: visual gates are nightly/release-only, with pinned fonts and viewport. PR carries only deterministic gates (axe, tokens, contrast, keyboard, states) |
| **Enabling type-aware lint surfaces hundreds of findings** | Triage once into `debt-baseline.json` with per-file budgets; fix in the same PR that touches the file; never blanket-disable a rule. One package per PR |
| **Enabling `all: true` (W0.6) drops `apps/api`/`apps/web` reported coverage sharply** | Expected and correct — the current number ignores untested modules. Re-baseline honestly and ratchet from the real value; do not re-exclude files to preserve the old figure |
| **CI cannot install semgrep/gitleaks on the runner** | W0.3 installs them; if the environment truly cannot, an explicit `SECURITY_SCAN=off` prints `not_configured` with a reason. Never a silent pass |
| **The durable E2E lane is slow or flaky in CI** | Keep the in-memory lane as the fast PR gate; run the durable lane as a required but scheduled check with `retries: 1` and trace-on-failure. A flaky release gate is a real cost — fix it, do not relax it |
| **The deferred backlog is read as "not doing it"** | `BK-*` entries are named with entry criteria and tracked as backlog items, not dropped |
| **A generated `check()` constraint meets a row that already violates it.** This is the one additive change that can fail, and the constraint is meant to be unconditional | Prove it first: `tests/integration` applies the real graph and the constraint is asserted *through the database* before it is in any migration. A violation is a data defect the test surfaces, not a production 500. Every such constraint carries a named remediation note in the migration |
| **A migration applies but the previous application version then fails.** The expand step is only safe if the old queries still succeed | Every migration ships a forward-compatibility check that the previous version's queries still succeed against the expanded schema, plus a fresh-schema check that it applies to an empty database. The migration runner is repaired first (W0.11) so a partial apply cannot be silently reported as success |
| **Four parallel tracks collide on shared config and composition files** | Waves are the merge unit, not tracks (§4.1). Explicit path ownership, single-owner interface files, one integration branch per wave, no feature flags |
| **The site becomes a second product with its own drift.** A marketing page is exactly where an unverified claim survives longest | The site consumes only D6's generated register, never hand-typed numbers. Site-doctor check 2 (no typed claims) and check 9 (capability honesty) both block the Pages job, and check 10 (artifact staleness) fails when a source moved and the artifact did not. `docs-drift.mjs` enforces the same rule repo-side |
| **The site's own gate cannot fail, or fails on noise.** A gate that always passes is the repo's existing disease; a gate that flags a moved heading every commit gets ignored | Port the reference's design: numbered, stable checks; unimplemented checks report as `GAP` with what they would need, never a silent pass; external-link checking runs on a schedule rather than every build; visual/diff-style checks are excluded from the blocking set |
| **Self-hosted fonts are forgotten and a third-party stylesheet returns**, reintroducing a render-blocking round-trip and the CLS it caused in the reference project | Fonts vendored under `site/public/fonts`, sha256-locked in a `fonts.lock.json`, preloaded in `<head>`, with the critical faces preloaded before first paint. E5's evidence line requires the rendered page to paint its wordmark without asking anyone else |
| **Scope discipline.** ~120 tasks is already a large program | Each task is independently shippable and independently verifiable; any track can pause after a completed gate without leaving a broken product |

---

## 16. Explicitly out of scope

Hosted SaaS; multi-tenant isolation; user/RBAC/SSO/SCIM administration; iOS device execution; Redis/Kafka/Kubernetes/Helm; a second orchestrator; a general workflow engine; arbitrary untrusted shell execution; an MCP gateway; HTML scraping as a normalization path; Tauri desktop; a light-theme-only design language; a blocking pixel-diff gate in PR CI.

Also out of scope by explicit decision: a TS-authored design system with a token build step (D9 — CSS stays authoritative); tokenizing Tailwind's spacing and radius scales (D9 — they are already a coherent 4px system); any destructive schema change (§12 — contract migrations are written down, not executed); pulling failure-intelligence writers forward from `BK-3` (D10 — the console shows evidence the product genuinely has, and the IA reserves the region); feature flags for the redesigned shell (§4.1 — ordering replaces flags).

Documentation and site, out of scope by explicit decision: **localized READMEs and a translated site** (D14 — English only; the extension point is documented in E6, not pre-built); a marketing site that presents aspirational capabilities as current (D15 — the roadmap page is the only place a not-built capability may appear, and it is labelled); a CMS, a search backend, or an analytics/tracking service (local search only, no third-party requests — same self-hosting discipline as the product); a custom site framework (VitePress, matching the reference architecture in D12); multilingual SEO hreflang scaffolding before any second language exists.

---

## 17. Definition of done

1. **Every gate passes, fails, or reports `not_configured` with a printed reason — never a silent pass.** No CI job is deterministically red.
2. **`pnpm verify` and `pnpm verify:release` complete.** A green CI run is a trustworthy signal.
3. **The durable product path is proven by a required E2E:** migrate → authenticate → enqueue → execute worker→runner → stream durable events → normalized evidence → cancel/retry → lost-lease recovery → release gate. No in-memory store on the path.
4. **The UI is a world-class dark-first evidence console:** axe zero serious/critical on every route in both themes, every route has loading/empty/error/partial states, one error boundary, one theme implementation, one date layer, one SSE connection, zero dead components, and every colour/type/elevation/motion utility in both trees verified to compile. The console shows evidence the product genuinely has, and every deferred surface renders an explicit `not_configured` panel citing its register row.
5. **Quality is measured, not asserted:** complexity ≤10, duplication ≤3% on changed code, mutation ≥75% on the five core packages, property/fuzz suites on every stated invariant, the authz matrix generated from the app, real-Postgres integration, and every perf budget measured in CI.
6. **The product is instrumented:** one correlation id from API to artifact, structured logs with a documented schema, a metrics endpoint, honest health/readiness, and a run-diagnostics surface that answers why a verdict happened.
7. **Every capability claim has a passing evidence command** in the generated register, and deleting a test flips its row to `unverified`.
8. **The evidence and audit chain is complete and immutable**, and the vault binds ciphertext to row identity.
9. **Every schema change is additive and proven.** `pnpm migrate:test` is green, `migrate:apply` is idempotent, two concurrent applies serialize, and no contract migration has been written — each is recorded in `docs/quality/schema-migration-backlog.md` with its expand step.
10. **No doc claims a capability the register marks `not_configured`, and no relative link is broken.** `pnpm docs:check` is green across links, commands, ports, env vars, transports, capability claims, and ADR references.
11. **`pnpm review --base main` is a real merge gate** with zero Blocker/Critical findings.
12. **The public site is live at `https://sergey-bar.github.io/AutoMate/`, passing all ten site-doctor checks**, with a working 10-minute quickstart, an honest capability table matching the register exactly, an ADR index with no collision, and a complete governance set. Every number on the site traces to a generated artifact.
