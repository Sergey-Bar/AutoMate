# Automate (Q-Ace) — QA Test Strategy

## Goal

Take the **real** vertical slice of Automate from "well-instrumented local sample" to a state
where a QA professional can trust it implicitly: every gate is *capable of failing*, every claim
in the capability register is backed by a test that would catch a regression, and every known
boundary is written down instead of implied.

## Locked decisions

| # | Decision | Consequence |
| --- | --- | --- |
| 1 | **Trust target = the `real` slice only** | Test to production confidence: reporting.*, `realtime.sse`, `artifacts.storage`, `orchestration.leases`, `runner.spool`, `reporting.persistence`, `contracts.authority`, `db.postgres-target`, `tool.junit`, `governance.*`. Mock/missing surfaces get **fail-closed contract tests**, not mock-parity tests. |
| 2 | **Single-node local-first topology** | Multi-instance SSE, cross-instance revocation, and cross-instance lease contention are explicit **out of scope**, not "TODO". Pool/saturation curves still tested — one node, one pool. |
| 3 | **Tests + minimal enabling fixes** | Where a category is untestable without a small product change, make the change and tie it to a test that would otherwise fail. |
| 4 | **WCAG 2.2 AA, blocking on the real routes** | Static lint, component-level axe, keyboard/focus tests, and E2E axe all participate. |
| 5 | **Repair first, then stage heavy gates** | Phase 0 restores red-means-red. Heavy gates (real PostgreSQL, k6, cross-browser, visual) land in tier 2 (nightly) and are promoted only once baselined. Cheap gates (axe in Vitest, jsx-a11y, contract, integration) block immediately. |

## Current state — what is already strong

Do not rebuild these; extend them.

- **PGlite is real PostgreSQL compiled to WASM**, and ~15 suites apply the **real migration graph**
  to it (`tests/integration/src/migrations.ts:85-98`). This is the best asset in the repo and the
  reason the data layer is as trustworthy as it is.
- `execution/store-parity.test.ts` runs the same scenario against in-memory **and** Drizzle, so a
  divergence the database would introduce is caught.
- `scripts/coverage-ratchet.mjs` records a real per-package floor and fails only on regression —
  this is what lets `apps/worker` (56%), `packages/ui` (59%), and `packages/db` (61%) participate
  honestly instead of being either excluded or blocked.
- Anti-vacuous patterns are already established and idiomatic here: spec-derived Playwright project
  list, non-empty spec assertion, `DATABASE_URL` required for E2E, freshness stamps on coverage,
  the `coverage-exclusions.md` register with prose removal conditions, `.semgrep.yml` structural
  self-check. **Follow the house style; do not invent a new one.**
- Only **one** `vi.mock()` exists in 63 API test files. The DB is never faked at the store layer.
- `packages/reporter/src/junit.test.ts` and `packages/runner-sdk/src/spool.test.ts` are
  model-quality: forward-scan parsing, torn-tail/tamper/wrong-key spool recovery.

## Blocking findings — why Phase 0 is not optional

Verified directly, not inferred.

1. **Four of nine jobs in `unified-ci.yml` are red by construction, plus both other workflows.**
   `scripts/static-analysis.mjs:89-99` exits 1 when a scanner binary is missing, but
   `unified-ci.yml:136-157` installs neither `semgrep` nor `gitleaks` (nor does `nightly.yml`).
   So `security`, all of `nightly.yml`, and `release-gate.yml:verify` fail on their first step and
   never reach the secret scan, licence check, duplication, complexity, or capability-register
   steps behind it.
2. **The three E2E jobs die at Playwright config load.** `playwright.config.ts:24-31` throws unless
   `DATABASE_URL` is set, and no workflow sets it or declares a `services:` block — so
   `api-e2e`, `e2e`, and `vertical-slice` (`unified-ci.yml:88-232`) cannot start.
3. **The `product` Playwright project matches zero specs.** `e2e/` contains exactly one spec,
   `e2e/integration/vertical-slice.spec.ts`, which the `product` filter
   (`playwright.config.ts:109`) explicitly excludes. Guarded in CI at `:117-124`, so it fails
   there and passes locally — the worst of both.
4. **The spool retry ceiling does not exist.** `apps/runner/src/runner-service.ts:572,583,595`
   reads only `retryPolicy.baseDelayMs`; `maxAttempts` and `maxDelayMs`
   (`packages/runner-sdk/src/spool.ts:127-129`) are populated by `apps/runner/src/main.ts:81-83`
   and never read. `SpoolEntryDisposition`'s `dead_letter` is declared and never used. A
   permanently unreachable API retries at a fixed 250 ms forever. No test would fail.
5. **A performance threshold has silently drifted and the gate cannot see it.**
   `performance/thresholds.json:24` records `checks.rate: 1`; `performance/smoke.js:39` carries
   `rate>0.99`; `performance-gate.mjs` cross-checks only p95/p99/`http_req_failed`.
6. **No performance baseline has ever been recorded.** `observed_on_reference_hardware` is `null`
   for all three metrics (`performance/thresholds.json:29-31`), and `test:performance` is wired
   into no workflow, no `verify`, and no `verify:release`.
7. **The two largest DB files are measured at 0%.** `apps/api/vitest.config.ts:33-34` excludes
   `drizzle-execution-store.ts` (the largest file in the repo) and `drizzle-realtime-feed.ts`.
   Tracked as B4/C6 in `docs/quality/coverage-exclusions.md:31-32` — a documented gap, not an
   accident, and the highest-value coverage work in the repo.

**Why this ordering matters:** a "zero-failure standard" is unreachable while four gates are
permanently red. Either the team learns to ignore red, or the gates stop meaning anything. Both
outcomes destroy more trust than the gaps in Phase 2–5 ever could.

---

## Phase 0 — Gate integrity (tier 1, blocking)

**0.1** Make the `security` job runnable: add pinned `semgrep` and `gitleaks` install steps to
`unified-ci.yml` job `security` and to `nightly.yml`, matching the existing SHA-pinning convention.
Re-run `pnpm security:verify` and confirm it reaches the licence, duplication, and complexity steps.

**0.2** Add a PostgreSQL `services:` container and a `DATABASE_URL` env to `api-e2e`, `e2e`, and
`vertical-slice` in `unified-ci.yml`. Do **not** set `E2E_ALLOW_IN_MEMORY` in CI — the existing
guard is correct and should stay fail-closed.

**0.3** Resolve the zero-spec `product` project: either land the Phase 4 specs, or until then make
the job explicitly absent rather than silently green. Do not weaken the `:117-124` guard.

**0.4** Add `scripts/gate-tooling.json` — a manifest mapping each npm script to the external
binaries it requires (e.g. `security:static` → `[semgrep, gitleaks]`, `test:performance` → `[k6]`,
`oci:verify` → `[docker|podman]`) — plus a `node:test` case in `scripts/lib/` that parses every
workflow under `.github/workflows/`, asserts each job has `timeout-minutes`, asserts every
`pnpm <script>` reference resolves to a real root script, and asserts any job running a
manifest-listed script installs the tool or sets an explicit skip. This is the coverage-exclusions
pattern applied to CI wiring, and it would have caught findings 1 and 6. Wire it into
`pnpm test:integration`.

**0.5** Fix `performance-gate.mjs` to cross-check all four thresholds including `checks.rate`, so
finding 5 fails instead of drifting.

**0.6** Add `actions/upload-artifact` for `test-results/evidence`. `e2e/integration/vertical-slice.spec.ts:34-35`
states CI uploads this evidence; nothing does. Add `fetch-depth: 0` to any job that scans history.

**0.7** Add `concurrency` blocks to `nightly.yml` and `release-gate.yml` (only `unified-ci.yml` has
one, so overlapping runs are possible).

**0.8** Correct the stale `AGENTS.md` claims that will mislead the implementing agent:
coverage thresholds are **not** "enforced per package in `vitest.config.ts`" (`vitest.shared.ts:32`
is explicit that they are not, and enforcement is `coverage-ratchet`); web is 95% not 91%;
shared-contracts is 99/97/97/99, not 100% all; `apps/web/src/store/` does not exist so "Zustand
stores in `store/`" is wrong; `apps/runner` is listed twice; `apps/worker`, `performance/`,
`tests/`, `runners/`, `tools/` are omitted; and `test:runner`, `test:performance`,
`security:static`, `duplication`, `complexity` are missing from the command table.

---

## Phase 1 — Functional depth and integration (tier 1, blocking)

Positive, negative, boundary, and edge-case coverage for the real slice.

**1.1** Add `apps/api/src/routes/execution.test.ts`. `routes/execution.ts` defines **21 endpoints**
with no dedicated route test. Critically, every existing test injects `InMemoryExecutionStore`, so
**no test drives an HTTP request through a Drizzle-backed route**. Build the app on
`createMigratedDatabase()` and cover create/list/get, cursor paging, `events`, `gate`,
`artifacts` (+ `:artifactId` and the bare `/artifacts/:artifactId` alias), `cancel`, `retry`,
`readiness`, `quality-policies` GET/POST, `integrations/maturity`, runner `register`/`heartbeat`/
`claim`, and the job `events`/`events/batch`/`artifacts`/`complete` set — each with positive,
unauthorized, wrong-workspace, not-found, and malformed-body cases.

**1.2** Strengthen `apps/api/src/route-manifest.test.ts`: mount **all** route modules, not only
`createExecutionRoutes`, so a `(method, path)` collision *between* modules is detectable — the
exact class of bug it was written for, one level up. Add the 8 registered-but-unlisted routes to
`CANONICAL_API_ROUTES`: `runs/:runId/events`, `runs/:runId/cancel`, `runs/:runId/retry`,
`releases/:releaseId/readiness`, `quality-policies` (GET and POST), `integrations/maturity`,
`runs/:runId/artifacts/:artifactId`.

**1.3** Cover the currently dead surfaces: the bare `GET /ready` alias; the
`POST /api/v1/jobs/:jobId/events/batch` handler alias; and the entire production composition
branch at `index.ts:188-213` — all five `index-production-composition.test.ts` cases assert that
`import('./index.js')` *rejects*, so a production composition that **succeeds** has never been
exercised and the 7 `PROCESS_LOCAL_CONTROL_DISABLED` stubs are unverified. Also give
`apps/api/src/services/reporter-persistence.ts` a direct test.

**1.4** Add per-module tests for the 12 dashboard routes (`runs.ts`, `tests.ts`, `analytics.ts`,
`quarantine.ts`, `quality-gates.ts`), which today have only one cross-file `dashboard.test.ts`.

**1.5** Replace counter-moving loops in `execution/execution-coverage.test.ts`. Its loops assert
`expect(result).not.toBeNull()` / `toBeDefined()` over status and outcome arrays; they exist to
move the V8 counter and would not detect a wrong value. Assert the real mapping, or quarantine
them with a reason in the exclusion register.

**1.6** Fix the falsified exclusion rationale at `apps/api/vitest.config.ts:25-28` and in
`docs/quality/coverage-exclusions.md:29`, which claim no test can import `src/index.ts` —
`src/index.test.ts:3` imports `{ app }` and `index-production-composition.test.ts:58-92` imports it
dynamically. Also fix the stale path `scripts/coverage-exclusions.test.mjs` → `scripts/lib/`
(`vitest.config.ts:19`, `coverage-exclusions.md:5`).

**1.7** Delete `apps/web/src/routes/reporting.tsx` — it is `export {};`, is absent from `router.ts`
and from `route-manifest.ts`, and is a dead file.

**1.8** Add property and adversarial-input tests on the ingestion path, which is the untrusted
boundary: deeply nested and self-referencing step trees, unicode and RTL test names, invalid
surrogates, 10k-step payloads, malformed/hostile XML entities and XXE attempts, truncated gzip,
multi-gigabyte-declared uploads, negative/zero/`NaN`/`Infinity`/overflow durations, duplicate
`(runId, testId)` with conflicting outcomes, and out-of-order event sequences. The register's own
JUnit note — a backtracking regex replaced by a forward scan because the lazy pattern restarted
per opener and was quadratic — is exactly the class of defect these tests exist to prevent
regressing.

**1.9** Add contract tests for every `mock`/`missing` capability asserting it **fails closed**:
`automation.agents` returns `501 NOT_CONFIGURED` for `api`/`performance`/`accessibility`/`security`
domains, `quality.*` deferred domains reject rather than fabricate, and `/api/v1/runner/v1/*`
returns `503` outside production. These lock honesty in place and are the correct substitute for
mock-parity tests under decision 1.

---

## Phase 2 — Security, data integrity, and resilience (tier 1 blocking / tier 2 where marked)

**2.1** *(enabling fix + test)* Honor the spool retry policy in `apps/runner/src/runner-service.ts`:
enforce `maxAttempts`, grow delay toward `maxDelayMs`, add jitter, and route to
`dead_letter` via `SpoolEntryDisposition` on exhaustion. Test: a permanently unreachable API stops
retrying, eventually dead-letters, and the entry is recoverable after a restart.

**2.2** *(enabling fix + test)* Add a security-header middleware (CSP, HSTS,
`X-Content-Type-Options`, `frame-ancestors`/`X-Frame-Options`, `Referrer-Policy`) and an explicit
CORS policy — default deny, allowlist derived from `PUBLIC_APP_URL`, correct for single-node
local-first. Assert the actual response headers, not the config values. Today there is no `cors`,
`helmet`, or CSP anywhere, and the only mitigation is `SameSite=Lax`.

**2.3** *(enabling fix + test)* Add a server-side request deadline middleware. `timeoutMs` is
currently stored in Zod schemas and DB CHECK constraints and **never enforced at the HTTP
boundary**; the only real aborts in the tree are `AbortSignal.timeout(15_000)` in
`packages/runner-sdk/src/client.ts:32` and Playwright's `webServer.timeout`.

**2.4** Extend the Semgrep scope from `apps/api/src packages tools scripts e2e` to include
`apps/web`, `apps/runner`, and `apps/worker`. `apps/runner/src/execution.ts:193-209` is the only
command-spawning code in the repository (`taskkill /t /f` vs `process.kill`) and is currently
outside the scan path. Also fix `no-raw-sql-interpolation`: its `pattern-not` for the Drizzle `sql`
tag (`.semgrep.yml:58`) structurally exempts the precise injection vector in a Drizzle codebase.
Add rules for the real risk surface: command injection, `dangerouslySetInnerHTML`/XSS, path
traversal in artifact keys, SSRF in the AI gateway adapters, and ReDoS in reporter parsing.

**2.5** *(tier 1)* Add **workspace-isolation (IDOR) tests** across every workspace-scoped read and
write. `WORKSPACE_ID` is the only tenancy boundary in the system and nothing currently asserts
that run `A` in workspace 1 is invisible to workspace 2. This is the single highest-value
missing security test class and it is schema-level, so it is testable single-node.

**2.6** *(tier 1)* Auth: session expiry at the `SESSION_TTL_HOURS` boundary, revocation
propagation, rotation, and cookie flags asserted from the real `Set-Cookie` header (HttpOnly,
SameSite, Secure only on HTTPS origins). Assert **credential separation** directly: a
`REPORTER_SECRET` must not reach a control-plane route, an `AUTOMATE_API_KEY` must not pass
`/api/v1/reporter/*` ingestion, and a runner identity must reach neither.

**2.7** Rate limiting exists only on `/api/v1/auth/login`. Add tests for reporter-ingestion flood
protection and document — in the test, as an explicit assertion — which endpoints are
intentionally unthrottled and why.

**2.8** *(tier 1)* Build a **deterministic fault-injection seam** (injectable clock, injectable
transport, and a store double that can throw on demand) so resilience tests are not timing-dependent.
Reuse the pattern already proven in `spool.test.ts`. Then cover: Postgres connection loss
mid-ingest, outbox flush failure, S3 timeout and its legacy-root fallback, vault decrypt failure,
SSE client disconnect mid-frame, worker lease loss, `ECONNRESET` on a live socket, and disk-full
on spool append. Today there is **no chaos tooling or practice in the repository at all** and
**no circuit breaker anywhere**; where degradation is the intended behavior, assert the
degradation explicitly so a telemetry or vault failure cannot silently fail a request.

**2.9** *(tier 1)* Test `apps/worker`'s entire resilience loop, which is unexercised despite being
production logic: readiness-`ping` gating, lease renewal, `leaseLost → runner_lost`
reclassification, job timeout, and `Promise.allSettled` shutdown drain. This needs a
fault-injecting store fake; `apps/worker/src/in-memory-store.ts` has no fault seam today.
`apps/worker` is also the lowest coverage floor in the repo at 56% statements / 43% branches.

**2.10** *(enabling fix + test)* Add `unhandledRejection` / `uncaughtException` handlers to the
api, runner, and worker entry points, and assert a rejected promise in a handler cannot take a
process down silently.

**2.11** *(tier 2)* Add a **real-PostgreSQL** CI job: apply the real migration graph to real PG,
exercise the `pg.Pool` path in `createDbResources`, pool exhaustion, and two-connection contention
on the outbox `ON CONFLICT` / `FOR UPDATE SKIP LOCKED` paths. PGlite is single-client everywhere —
`drizzle-run-repository.test.ts:457` is literally titled *"instance B reads data written by instance
A (same PGlite client)"* — so contention is structurally untestable today.

**2.12** *(tier 2)* Supply chain: add `osv-scanner` alongside `pnpm audit`; add
Dependabot or Renovate (neither exists); add a gate that **fails on an expired override review
date** — the five transitive pins in `pnpm-workspace.yaml:31-48` carry a `2026-06-30` review date
that is already past and nothing re-checks it; generate an SBOM; replace the licence **deny-list**
in `license-check.mjs` with an allow-list plus a compatibility check; add `trivy`/`grype` image
scanning once the runner images are real.

**2.13** *(tier 1)* Extend `secret-scan.mjs` to git history (needs 0.6's `fetch-depth: 0`) and give
`.husky/pre-commit` an actual command — it is currently a comment that runs nothing.

**2.14** Remove `apps/api/src/infrastructure/synthetic-credentials.ts` from product source or move
it under a test directory. It is a test-only fixture, imported by exactly one test file and by no
production code, yet it is measured by coverage as if it were product.

---

## Phase 3 — Accessibility, WCAG 2.2 AA (tier 1, blocking)

Zero automated accessibility assertions exist today. `axe-core` is present only transitively via
`eslint-plugin-jsx-a11y` and is never imported by app or test code: no `toHaveNoViolations`, no
`@axe-core/playwright`, no Lighthouse, no a11y CI job.

**3.1** Fix `eslint.config.js:188` — the jsx-a11y block is scoped to `apps/web/src/**/*.tsx`, so all
**28 shared components** in `packages/ui` (Dialog, Drawer, Table, Tabs, Select, Toggle, Popover,
CommandPalette, Splitter) are linted with no a11y rules at all. Extend the glob. Cheap and blocking.

**3.2** *(enabling fixes)* Repair the concrete defects these tests will assert:
`Splitter.tsx:25-27` has `role="separator"` with no `aria-valuenow`/`valuemin`/`valuemax` and no
keyboard resize; `Popover.tsx:29-36` toggles `aria-expanded` but never closes on Escape, never
returns focus, and has no `aria-controls`/`aria-haspopup`; `CommandPalette.tsx` implements a
combobox with no `role="combobox"`/`aria-expanded`/`aria-activedescendant`; `Dialog.tsx:57` and
`Drawer.tsx:88` set `aria-modal` in a position the `{...props}` spread can silently override, and
neither implements a focus trap or focus restore; `AuthGuard.tsx:23` renders a loading `<div>` with
no `role="status"`/`aria-live`, so the auth transition is silent for screen-reader users; and
`dashboard.tsx:325` flips run status with no live region.

**3.3** Add `@testing-library/user-event`, which is **absent** — every interaction test uses
`fireEvent`, which cannot express real focus movement or tab order, so focus-visible and
focus-management behavior is structurally untestable today. Then write keyboard and focus tests
for Dialog, Drawer, Popover, CommandPalette, GlobalCommandPalette, Tabs, Select, Toggle, Splitter,
Table, and NavBar: Tab/Shift+Tab order, Enter/Space activation, Escape dismissal, focus trap
containment, and focus restore to the trigger.

**3.4** Add `vitest-axe` and assert zero serious/critical violations across all 28 `packages/ui`
components and the `apps/web` components.

**3.5** Extend the existing contrast test at `packages/ui/src/tokens/theme.test.ts:189-208` — the
strongest automated a11y check already in the repo — to the untested tokens
(`--automate-fg-muted`, `--automate-text-secondary`, `--automate-text-muted`, `--automate-accent`,
`--automate-warning`, `--automate-success`) against their real backgrounds, in **both** theme
blocks, at AA (4.5:1 text, 3:1 large/UI).

**3.6** *(tier 2, promote when green)* Add `@axe-core/playwright` to the five real dashboard routes
in the E2E project, so accessibility is asserted against the composed application rather than only
in jsdom.

**3.7** Honor `prefers-reduced-motion`. `packages/ui/src/tokens/motion.ts` ships durations and
easings and the media query appears **nowhere** in the repository.

**3.8** *(tier 2)* Guard the `focus-visible:ring-*` / `focus-visible:outline-*` styling in Button,
Input, Select, Toggle, and Textarea. It is invisible to jsdom, so it needs a Playwright assertion.

**3.9** Add `@storybook/addon-a11y`. 26 stories exist and a working Storybook is present; the
addon list is `addon-essentials` alone.

---

## Phase 4 — E2E, compatibility, and UX (tier 1 core, tier 2 breadth)

The entire E2E surface is one spec with five tests, all in
`e2e/integration/vertical-slice.spec.ts`. The `product` project matches zero files.

**4.1** Expand `e2e/` across the real slice: auth login/logout/session-expiry, run list and run
detail, artifact fetch, quarantine add/remove, quality-gate read, cancel and retry, upload of both
Playwright JSON and JUnit XML, 401 on every control-plane route, and SSE reconnect after a
server-side drop. This also resolves 0.3.

**4.2** *(tier 2)* Add Playwright projects for **Firefox** and a **mobile viewport**. Only
`devices['Desktop Chrome']` is configured, so cross-browser and responsive claims are currently
unevidenced. Add viewport coverage at `sm`/`md`/`lg`/`xl` — there is no responsive test at any
viewport today, and jsdom has no layout engine.

**4.3** *(tier 2)* Introduce `toHaveScreenshot` baselines for the five dashboard routes across
dark/light and three viewports. There are **zero** snapshots in the repository and no
`__snapshots__` directory; the single `page.screenshot` at `vertical-slice.spec.ts:244` is an
unasserted artifact.

**4.4** *(tier 2)* Add an OS matrix: `windows-latest` and `macos-latest` alongside `ubuntu-24.04`.
Windows is the primary dev platform per the repo's own PowerShell-first instructions, and
`apps/runner/src/execution.ts:193-209` branches on platform (`taskkill /t /f` vs
`process.kill(-pid, 'SIGTERM')`) while being tested only with a synthesized `close` event — a fake
signal, not a real kill. Also add a **real `SIGKILL` and crash-restart** test for the runner.

**4.5** *(tier 2)* Client resilience: `apps/web/src/lib/api.ts` has no `AbortSignal` and no
401/session-expiry handling, and `useRuns.ts:107` polls every 5 s unconditionally with no backoff
or error-aware pacing. Add the abort + 401 re-auth path, then test hung-request termination,
session-expiry re-prompt, `fetch` rejection paths (currently only mocked `Response` objects are
used, so the `catch` branches are unverified), Zod-validation failure on a malformed 200, and the
default `crypto.randomUUID()` path in `retryRun`.

---

## Phase 5 — Performance (tier 2, promote when baselined)

k6 is the only tool, `performance/smoke.js` is the only scenario, and `test:performance` is wired
into **no** workflow, no `verify`, and no `verify:release`.

**5.1** Record the missing baseline on the reference container. `observed_on_reference_hardware`
is `null` for all three metrics — nothing has ever been measured, so the existing thresholds are
unvalidated numbers.

**5.2** *(depends on 0.5)* Fix the `checks.rate` cross-check.

**5.3** Add DB-backed scenarios. The three measured endpoints are cheap — `/api/v1/health` is a
bare `c.json` with no DB — and **`/api/v1/ready`, the only DB probe, is unmeasured**. Add
`/api/v1/ready`, paginated `/api/v1/runs`, `/api/v1/reporting/kpis`, and a **write path**
(`POST /api/v1/reporter/events`). Add a pool-saturation curve: the exact failure mode the PRD's own
load narrative invokes, and the one a single-node topology makes meaningful.

**5.4** Add soak (endurance) and spike scenarios. Today there is one 100-second ramping scenario
peaking at 50 VU.

**5.5** Treat SSE as a reliability target rather than a latency budget — as the current thresholds
file already acknowledges. Measure reconnect storms and slow consumers rather than pretending a
long-lived stream has a p95.

**5.6** *(tier 2)* Web performance: no bundle-size, hydration, or Lighthouse gate exists.

---

## Category coverage map

| Requested category | Covered today | Plan tasks |
| --- | --- | --- |
| **Functional** (positive/negative/boundary/edge) | Strong on ingestion, contracts, auth, leases; **21 execution endpoints and 12 dashboard routes have no direct route test**; several loops assert only `not.toBeNull()` | 1.1–1.8 |
| **Non-functional** (perf/load/stress/scale/reliability) | One 100 s k6 smoke over 3 cheap endpoints, no DB, never run in CI, **no baseline ever recorded** | 5.1–5.6, 2.11 |
| **Usability / UX / accessibility** | **Zero** automated a11y assertions; `packages/ui` not linted; 28 of 47 components unchecked; no responsive, keyboard, or visual coverage | 3.1–3.9, 4.2–4.3 |
| **Security** (vuln/data integrity/auth) | Decent secrets + rate-limit + startup-policy unit tests; **no DAST, no CodeQL/SARIF, no SBOM, no CVE scan, no Dependabot, no workspace-isolation tests, no security headers**; Semgrep misses web/runner/worker and exempts the Drizzle `sql` tag | 2.2, 2.4–2.7, 2.12–2.13 |
| **Compatibility** (platform/browser/env) | **No matrix at all** — one OS, one browser, one viewport; platform fork in the runner untested | 4.2, 4.4 |
| **Regression / integration** | Ratchet, freshness stamps, contract + integration suites, store-parity are genuinely good; **route-manifest cannot see cross-module collisions**; 4 gates red | 0.1–0.7, 1.2, 1.4 |
| **Error handling / robustness** | Good unit-level evidence (swallowed errors, lease fencing, spool tamper, retry classification); **no chaos practice, no circuit breaker, worker loop untested, spool ceiling nonexistent, no request deadlines** | 2.1, 2.3, 2.8–2.10, 4.5 |

## Explicitly out of scope

Written down so the next person finds the reasoning instead of repeating the idea — the same
convention as the "Rejected exclusions" table in `coverage-exclusions.md`.

- **Multi-instance behavior**: cross-instance SSE fan-out, cross-instance session revocation,
  cross-instance lease contention. Decision 2. Revisit only with an approved topology.
- **Mock surfaces**: `automation.chat`, `automation.agents`, `automation.test-generation`,
  `ai.catalog`, `connectors.core`, `orchestration.inventory`, `vault.persistence`, and
  `auth.sessions` durability. Covered by 1.9 fail-closed tests only.
- **Missing tools**: `tool.k6` and `tool.zap`. The product's own load and security runners are
  unbuilt manifests with `"imageDigest": null`; asserting quality of a tool that does not exist is
  not testable.
- **i18n and RTL** — deferred by `docs/migration/unified-repository-migration.md:94`. Recorded
  rather than dropped: `packages/ui` uses **physical** margins (`Drawer.tsx:22-25`,
  `Dialog.tsx:76`, `Tabs.tsx:111`) while its own `DESIGN-MAP.md:20` recommends logical properties.
  Either fix the components or correct the design map.
- **Mobile/native** — `desktop.tauri` is `obsolete`.
- **DAST against production** — no approved topology exists to attack.

## Validation

The plan is done when all of the following hold:

1. `pnpm verify` and `pnpm security:verify` pass **end to end**, not just their first step — and
   `scripts/gate-tooling.json` proves each of the 9 `unified-ci.yml` jobs can reach its last step.
2. All three workflows are green, or an explicitly green-and-empty job is justified in writing.
   The `product` project is non-empty.
3. `pnpm coverage:ratchet` passes, and B4/C6 rows in `coverage-exclusions.md` are either removed
   (durable store measured) or restated with a removal condition that names a thing which could
   happen — never "in the future".
4. `node --test` on the gate-tooling manifest fails when a workflow drops a required install step
   or a tool goes missing. Prove it by breaking it, then reverting — the repo's own
   anti-vacuous standard.
5. Every Phase 2–5 test demonstrably fails when its corresponding fix is reverted.
6. `pnpm test:performance` has a recorded non-null baseline in
   `performance/thresholds.json` and runs in the nightly workflow.
7. Zero serious/critical axe violations on the five real routes; jsx-a11y covers `packages/ui`.
8. The capability register is regenerated (`pnpm docs:capability-register`) and no row claims
   `real` without executable evidence that a reviewer can re-run.

## Risks

- **Phase 0 will surface a large backlog of pre-existing failures** that were hidden behind four
  red jobs. Budget for triage, not just repair. Land 0.1–0.3 first so the real failures are visible.
- **WCAG 2.2 AA on 28 unchecked components is the largest single chunk of work** and will likely
  find more than the five defects listed in 3.2. Consider 3.1 landing alone, immediately — it is
  cheap and will name the rest for free.
- **Real-PostgreSQL and k6 on shared runners introduce flake** that the PGlite suites do not have.
  This is exactly why decision 5 stages them; promoting early would reproduce the red-gate problem
  in a new place.
- **Fixing coverage exclusions can move the ratchet floor down.** `coverage-ratchet.mjs` fails on
  regression, so any newly-measured file must be genuinely covered on the same PR, not lowered to
  make room.
- **The capability register will need updating** in the same PR as any status change, per its own
  evidence rules.

## Open questions

1. Should `auth.sessions` be promoted from `mock` to `real`? It is `mock` because two-instance and
   retention evidence are missing, and decision 2 removes the two-instance half. Retention
   (expiry sweep, audit retention at `AUDIT_RETENTION_DAYS`) is testable single-node — confirm
   whether that is enough to graduate it.
2. Is the 5-second unconditional poll in `useRuns.ts:107` intended product behavior, or should
   error-aware backoff be a product fix under decision 3?
3. `packages/ui` sits at a 59% coverage floor — the lowest of any UI-facing package and the layer
   every screen renders through. Should Phase 3 raise it, or is the axe gate the better use of the
   same effort?
