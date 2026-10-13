# QA Cockpit Completion Plan

**Plan id:** 1791696954697-qa-cockpit-completion-plan.md
**Status:** implementation-ready
**Scope:** finish the Automate web cockpit — managerial insights/KPIs/charts/findings, real test
execution (run/stop/queue) from the app, in-app repository loading, and a production-grade
toolbox (tool detection + full FREE/PAID catalog).

---

## 1. Goal

An operator who loads a repository into the app sees, without leaving the browser:

1. **The cockpit** (`/dashboard`) — every parameter a QA lead / SDET manager needs: KPIs with
   deltas, charts, the ranked gap queue, flaky tests, quarantine, pyramid + coverage matrix,
   health score, live runs and queue depth.
2. **Execution** — pick a detected command, press Run, watch it stream live, press Stop and the
   process actually dies. Multiple concurrent runs with a queue view.
3. **Repository loading** — add / switch / re-detect repositories from the UI (no curl, no API
   restart).
4. **The toolbox** (`/dashboard/tools`) — an advisory stack-health bar (100% once ≥1 tool is
   detected), and a grid of every testing tool (≈50), all categories, split FREE / PAID /
   freemium, with deep per-tool content — not one-liners.

## 2. Non-goals (explicit)

- No scheduling / cron / CI triggering from the UI (worker `pollSchedules` stays server-side).
- No multi-tenant auth work — the install is open (ADR-006, ledger `OPEN-1` fixed).
- No OpenAPI document (ledger `RF-11` stays open; not required to ship this).
- Closing `PERF-1` / `RF-9` (render/performance baselines need reference hardware — a
  self-hosted single-node install, not a dev host).
- No OCI runner, no browser devtools click-inspector, no agent/LLM conversation surface
  (deferred by `1791093678000-autonomous-qa-cockpit-plan.md` W8–W14).
- No new database tables or migrations.

## 3. Verified premises (read this before writing code)

Facts verified against the tree on 2026-10-11. Each task below depends on them.

| # | Premise | Evidence |
|---|---------|----------|
| P1 | A cockpit already exists: `components/Main.tsx` (1,546 lines) reads 7 endpoints in parallel, derives 7 insights, renders pyramid, matrix, gap queue, quarantine and a QA-stack section. | `apps/web/src/components/Main.tsx:307-396` |
| P2 | Its logic is **triplicated**: `deriveInsights` in `Main.tsx:154` and `InsightsPage.tsx:129`; `analyzeStack`/`ToolTable` in `Main.tsx:1096` and `QAToolsPage.tsx`. | `routes/dashboard/insights/InsightsPage.tsx`, `routes/dashboard/tools/QAToolsPage.tsx` |
| P3 | **`run.start` never runs the picked command.** It stores `configuration: { commandId }`; the runner reads `configuration.command` (`argv` object). Every run from the cockpit falls back to the Playwright `smoke-pass` fixture. | `apps/api/src/index.ts:571-586` vs `apps/runner/src/runner-service.ts:369` → `readGenericCommand` (`execution-router.ts:52-70`) |
| P4 | The argv **already exists** server-side: `listCommands` returns `RunCommand` with `argv`, `artifactGlobs`, `env`, parsed through `RunCommandSchema`. Nothing puts it into `configuration.command`. | `apps/api/src/services/project-registry-service.ts:239-257` |
| P5 | **The runner honors cancellation but is never told.** `runner-service.ts:305-307` cancels on `response.cancelledJobIds` / `cancelRequestedJobIds`; the API's `RunnerHeartbeat` has no such field and `heartbeatRunner` returns none. The spawned child keeps running. | `apps/runner/src/runner-service.ts:296-308`; `apps/api/src/execution/types.ts:251-257`; `drizzle-execution-store.ts:1000-1025`; `in-memory-execution-store.ts:431-451` |
| P6 | **The run deadline is the first lease.** `deadlineMs = Math.min(claim.timeoutMs, remainingLeaseMs)` computed once at claim; the heartbeat renews the lease server-side but the runner never re-arms the child timer, so any run longer than the initial lease (~30 s default) is killed `timed_out`. | `apps/runner/src/runner-service.ts:374-384`; `generic-spawn.ts:235-238`; renewal at `drizzle-execution-store.ts:1012-1021` |
| P7 | A run created without capabilities defaults to `requiredCapabilities: ['playwright']`; `claimJob` requires job capabilities ⊆ runner capabilities, so a runner configured without `playwright` never claims it. | `drizzle-execution-store.ts` `createRun` + `claimJob` capability filter (`:1065`) |
| P8 | Two competing stop doors. `POST /runs/:id/cancel` sets `cancelRequestedAt` on the run and flips jobs to `cancelled` **clearing the lease** (so the heartbeat can no longer see the owner); `POST /runs/:id/stop` is a raw Drizzle UPDATE on `runs` only, drops the `reason`, touches no job, publishes no event. The worker's reaper requeues a cancelled job unless `execution_jobs.cancel_requested_at` is set. | `drizzle-execution-store.ts` `cancelRun` (`:809-844`); `services/qa-score-service.ts:270-295`; `apps/worker/src/postgres-store.ts:383` |
| P9 | Tool detection is a **hard-coded 10-path literal** in the client, and the code says so: "the production client would replace it with a real API read". The static catalog (`lib/qa-tools.ts`, 23 tools) has one-line descriptions. | `Main.tsx:1090-1146`; `apps/web/src/lib/qa-tools.ts` |
| P10 | Repository registration has **no UI**: boot discovery via `AUTOMATE_PROJECT_ROOT` or `POST /api/v1/projects` by curl. `Main.tsx:295` silently takes `projects[0]`. The onboarding screen documents the curl in prose. | `Main.tsx:1514-1546`; `apps/api/src/index.ts:601` |
| P11 | Dormant API with no web route: `GET /dashboard/tests`, `/dashboard/suites`, `/dashboard/runs/:runId/tests`, `GET /reporting/runs/:runId`, `GET /reporting/kpis`, `GET/POST /dashboard/quality-gates`, `GET /projects/:id/qa/score/diff`, `qa-client.startRun` and `askCopilot` (never called). | `apps/api/src/modules/dashboard/tests.ts`, `routes/reporting.ts`, `apps/web/src/lib/qa-client.ts` |
| P12 | The canonical route manifest test does not mount the projects/agent-registry routes, so those 14 endpoints are live but unlisted. New endpoints must be added to that list. | `apps/api/src/route-manifest.test.ts:52-120` |
| P13 | **`pnpm findings:check` is currently red** — five `fixed` rows cite `apps/web/src/components/Cockpit.tsx` as evidence; the file is now `Main.tsx`. Also `e2e/accessibility/routes.spec.ts:428` asserts `cockpit-queue` while the component renders `main-queue`. | `docs/quality/findings-ledger.json:3861,3865,3953,3980,3984`; `e2e/accessibility/routes.spec.ts:428`; `Main.tsx:847` |
| P14 | Coverage ratchet floor for `apps/web` is 96/88/96/98 (statements/branches/functions/lines). Every new screen must arrive genuinely covered. | `coverage-baseline.json` |
| P15 | House rules that gate the UI: no literal hex (every utility must compile — `theme-resolution.test.ts`), no `backdrop-filter` outside `GLASS_BACKDROP_UTILITIES`, no `lucide-react` import from `apps/web` (icons come from `@automate/ui`; `packages/ui/src/icons.ts` is a decision list), one `<h1>` per screen, `max-w-measure` on prose, `numeric` on figure cells, `tabular-nums` on `toFixed`. | `AGENTS.md`; `apps/web/src/Composition.test.tsx`; `theme-resolution.test.ts` |
| P16 | No chart library exists and none is wanted: "Inline SVG, and no chart library. Fifteen cells and one sparkline do not justify a 200 kB dependency." | `Main.tsx:708-714` |
| P17 | Analytics aggregation deliberately lives in the repository layer (one query, `FILTER` aggregates) to avoid the N+1 the ledger recorded as `Q-47`. Extend that pattern for KPI windows. | `apps/api/src/repositories/drizzle-run-repository.ts:207-235` |

## 4. Locked decisions

1. **Repositories:** full in-app management — add (name/slug/path), switch, re-detect. Boot
   discovery stays as-is.
2. **Execution:** run/stop on the local host through the existing runner, **plus multiple
   concurrent runs and a queue view** (runner slots + the worker's existing quotas). No CI,
   no scheduling from the UI.
3. **Charts:** dependency-free chart primitives added to `packages/ui`, token-coloured, fed by
   existing endpoints plus one new windowed KPI aggregate.
4. **Toolbox:** catalog grows to ≈50 tools across all 16 categories with deep content, rendered
   as an icon grid (typographic monogram tiles — no brand logos, no new dependency), split
   FREE / PAID / freemium; detection is server-side; the health bar is advisory and reaches
   100% once ≥1 tool is detected.

### Technical decisions taken by this plan (reversible, recorded here)

- **One authority for executables.** `run.start` resolves `commandId` → `listCommands()` →
  `configuration.command`. The comment at `index.ts:567-570` ("not resolved here… a second
  place where an executable could enter the system") is honoured by resolving **inside the
  registry service**, never in the route and never in the client.
- **One stop door.** `POST /runs/:id/stop` delegates to the store's `cancelRun(reason)`;
  `cancel_requested_by` carries the reason. The raw Drizzle UPDATE is deleted.
- **One catalog.** The tool registry moves to `packages/projects/src/tool-catalog.ts` (pure
  data, zero Node imports) behind a new browser-safe subpath export
  (`@automate/projects/tool-catalog`). The API probes with it; the web renders it. A
  boundary test fails the subpath if it ever imports a Node built-in.
- **Any runner may claim a cockpit run.** `run.start` creates runs with
  `requiredCapabilities: []` and `labels: []`; confinement is the runner's own (no shell, cwd
  inside `repoRoot`, env allowlist).
- **Run trend comes from the runs table.** No score-history snapshots are persisted; the
  managerial trend chart is run outcomes per day + KPI window deltas. `qa/score/diff` powers
  the "since <instant>" comparison card instead.

## 5. Backend critical path (must land before any UI is trusted)

### 5.1 Make the picked command runnable — defect P3/P4

- `services/project-registry-service.ts`: add `resolveRunCommand(options, projectId, commandId, timeoutMs?)`
  → `RunCommand` (throws `NOT_FOUND` with the profile-correction sentence the route already
  uses). This is the single resolver; the route's existing 404 check stays.
- `apps/api/src/index.ts:571-586`: `startRun` calls the resolver and creates the run with
  `configuration: { command: { argv, artifactGlobs, env }, commandId }`, plus
  `requiredCapabilities: []`, `labels: []`, `timeoutMs` from the command/body. Keep the
  idempotency key semantics unchanged.
- `apps/runner`: no change needed — `readGenericCommand` already reads `configuration.command`
  (`{argv, workingDirectory?, artifactGlobs?, env?}`). Do **not** add a `commandId` fallback
  path in the router.
- **Operational:** the generic adapter confines cwd to `RUNNER_REPO_ROOT`, so a run of a
  registered project requires the runner's `repoRoot` to be (an ancestor of) the project path.
  Set `RUNNER_REPO_ROOT` in `docker-compose.unified.yml` (mount the repo) and document it in
  `.env.example` + the docs site. This is the one deployment prerequisite; put it in the plan's
  rollout notes.

### 5.2 Make stop real — defects P5/P8

- `execution/types.ts`: `RunnerHeartbeat` gains `cancelledJobIds: string[]` and
  `leaseExpiresAt?: string`.
- Both stores (`drizzle-execution-store.ts`, `in-memory-execution-store.ts`):
  `heartbeatRunner` computes `cancelledJobIds` = ids of jobs whose **run** has
  `cancelRequestedAt IS NOT NULL`, joined by `runId`, restricted to `leaseOwner = runnerId`
  regardless of job state (a cancelled job's lease must survive until the runner reports).
- `cancelRun`: instead of flipping `execution_jobs` to `state='cancelled'` and clearing the
  lease, set `execution_jobs.cancelRequestedAt` (column already exists and is already honoured
  by the worker reaper) and leave the lease live. The runner then completes the job as
  `cancelled` with `RUNNER_CANCELLED` — which `runner-service.ts:423-437` already does.
- `POST /runs/:id/stop` → `store.cancelRun(runId, reason, workspaceId)`; persist the reason in
  `cancel_requested_by`; delete `services/qa-score-service.ts:270-295`'s raw update. The
  outbox row + `run.completed` event the store already emits give the UI its live update.
- Tests: (a) a heartbeat for a runner holding a job whose run was cancelled returns that job
  id — in both stores; (b) the reaper does **not** requeue it; (c) `stop` persists the reason;
  (d) runner-side: `generic-spawn.test.ts` / `runner-service` test proving cancel aborts the
  child (the plumbing exists; assert the API side that was missing).

### 5.3 Make long runs survive — defect P6

- `apps/runner`: `ExecutionContext` gains `renewDeadline(): void`. `generic-spawn`'s
  `awaitChild` timer is stored per child and re-armed by it (bounded by the claim's
  `timeoutMs`).
- `runner-service.heartbeat()`: after a successful heartbeat, for every active job call
  `job.renewDeadline?.()`. The heartbeat response's `leaseExpiresAt` (added in 5.2) is the
  signal that the server renewed; if absent, do not re-arm.
- Tests: a job whose heartbeat renews twice completes past the initial lease; a job whose
  heartbeat fails does not re-arm; the `claim.timeoutMs` ceiling still kills.

### 5.4 New API surface (all workspace-scoped; add every row to the canonical manifest test)

| Method | Path | Purpose | Notes |
|---|---|---|---|
| GET | `/api/v1/projects/:id/toolchain` | Probe the repository for installed QA tools: per-tool `{toolId, detected, evidence, version?}` plus runtime-tool availability. | Repository via `viewFor(repoPath)`; probes `node_modules/.bin`, manifest deps/scripts, config files from `detectPatterns`; PATH binary check via `spawnSync(..., ['--version'])` with a short timeout. Presence only — never executes a suite. |
| GET | `/api/v1/jobs` | Paged queue: job state, run, lease owner, fencing token, attempt, `availableAt`, priority. | `state=queued,leased,requeued` filter; cursor in header, like `/runs`. |
| GET | `/api/v1/runners` | Runner health, slots, active jobs, last heartbeat. | Powers the "capacity" card. |
| GET | `/api/v1/dashboard/kpis?from&to&bucket=day` | Windowed KPIs: runs, pass rate (0–100), completed, avg/p50/p95 duration, per-day buckets `{day, passed, failed, cancelled, infra}`, flake-count if cheap. | One aggregate query in the repository (P17 pattern). Units documented in the response (`passRate` 0–100 — see ledger `GLASS-3`). |
| POST | `/api/v1/projects/:id/run.start` | **Changed body handling only** (still `{commandId, timeoutMs?, idempotencyKey}`) — now resolves argv per §5.1. | |
| POST | `/api/v1/runs/:id/stop` | Delegates to `cancelRun(reason)` per §5.2. | |
| GET | `/api/v1/projects/:id/qa/score/diff` | Already exists — add a web route + client method. | `?from&to` instants. |

Also fix `route-manifest.test.ts` to mount `createProjectsRoutes` (and keep both-direction
assertions), so the 14 project endpoints are canonical.

### 5.5 Catalog package changes

- `packages/projects/src/tool-catalog.ts`: the registry — `id, name, category (16), tier
  (free/paid/freemium), licensing (one-line, concrete), description (deep), whenToUse,
  whenNotToUse / alternatives, installCommand, detectPatterns, packageNames (for manifest
  probing), binaryName?, learningCurve, maintenanceStatus, homepage, docs, verifiedOn`.
  Pure Zod schema + data; **no Node imports**.
- `packages/projects/package.json`: add `"./tool-catalog"` export (types + import) and keep
  `.` unchanged. `apps/web/package.json` gains `"@automate/projects": "workspace:*"`.
- `packages/projects/src/tool-catalog.test.ts`: schema validity, unique ids, every
  `detectPattern` non-empty, every category referenced by ≥1 tool, free+paid both present per
  major category, and a source-level assertion that the module imports no Node built-in
  (same trick as `scripts/lib/test-support-boundary.test.mjs`).
- Tool count: the existing 23 + the notable additions per category, ≈50 total — test
  frameworks/runners (WebdriverIO, Selenium, node:test, pytest, JUnit, RSpec, MSTest, Cucumber,
  TestNG), API (Postman/Newman, REST Assured, Karate, httpx+responses?), mobile (Appium,
  Maestro, Detox, Espresso, XCUITest), performance/load (Grafana k6 Cloud, Locust, Gatling,
  JMeter), security (Semgrep, gitleaks, OWASP ZAP, Trivy, Snyk, npm audit), a11y (Pa11y,
  Lighthouse CI), visual (BackstopJS, Applitools), contract (Schemathesis, Spring Cloud
  Contract, Dredd), chaos (Gremlin, Toxiproxy, Chaos Mesh), mocking (WireMock, Mockoon, Nock),
  test data (Fishery, Factory Bot), reporting (ReportPortal, Allure, JUnit/XUnit readers),
  CI (GitHub Actions, Dagger, Jenkins?), management (TestRail, Xray, Zephyr — paid). Each new
  row must have `verifiedOn` set to the date its upstream docs were actually read.

## 6. Frontend architecture

### 6.1 Consolidation first (removes the triplication, then build on one copy)

- `apps/web/src/lib/insights.ts` — `deriveInsights(input)` moved verbatim from `Main.tsx:154`
  (the tested copy), plus its existing tests re-homed from `Main.test.tsx`.
- `apps/web/src/lib/qa-stack.ts` — `analyzeStack`, `groupByCategory`, `ESSENTIAL_TOOL_IDS`,
  tier/category labels moved from `Main.tsx:1096`; it now takes **server detection** as input
  (`ToolchainProbe`) instead of the hard-coded file list (P9).
- `apps/web/src/lib/qa-tools.ts` — deleted; imports repointed to `@automate/projects/tool-catalog`.
- `routes/dashboard/insights/InsightsPage.tsx` and `routes/dashboard/tools/QAToolsPage.tsx` —
  deleted after their unique additions (severity StatCards, `PyramidBars`) are re-home onto the
  new pages. They have no tests today; deleting them raises coverage, not lowers it.
- Dead code: `components/RunList.tsx`, `components/ThemeToggle.tsx`,
  `components/dashboard/RunExplorer.tsx` (+ their tests and their axe-sweep entries) — delete
  **after** the new screens cover what their tests covered; re-run the ratchet.
- Stale test id: `e2e/accessibility/routes.spec.ts` `cockpit-queue` → `main-queue`
  (and the seeded-project helper comment's `Cockpit.tsx` reference).
- Fix the ledger evidence paths (`Cockpit.tsx` → `Main.tsx`) so `pnpm findings:check` is green
  **before** new rows are added (P13).

### 6.2 Project context

- `apps/web/src/project/ProjectProvider.tsx` + `useSelectedProject()`: selection persisted in
  `localStorage`, defaults to `projects[0]`, mirrors to `?project=` in the URL so every deep
  link is shareable. All QA reads (`score`, `gaps`, `hollow`, `flaky`, `structure`,
  `toolchain`, `commands`) hang off the selected id — no more silent `projects[0]`.
- `qa-client` gains `createProject`, `refreshProject` (the rest exist).
- `components/ProjectSwitcher.tsx` — a `Select` in the shell header; a repositories page owns
  add/re-detect.

### 6.3 Chart primitives in `packages/ui` (no new dependency)

- `TrendChart` — line + optional area, `points: {x: ISO, y: number}[]`, token strokes only
  (`stroke-[var(--accent)]`-style utilities or the token classes the theme already defines),
  `aria-label` + `<title>`, an `unmeasured` state like `Meter`'s three cases.
- `StackedBars` — per-bucket stacked segments (passed/failed/cancelled/infra) with a legend and
  a `numeric`/`tabular-nums`-compliant axis.
- `DonutShare` — single-value share ring (e.g. free vs paid tooling) reusing `Meter`'s
  three-state discipline.
- All three: tests for render, empty, single point, `unmeasured`, keyboard/axe, and inclusion
  in `theme-resolution.test.ts`'s compile sweep.

### 6.4 Routes (add to `route-manifest.ts` **and** `router.ts`; both are asserted in both directions)

| Route | Content |
|---|---|
| `/dashboard/repositories` | Repo list (name, slug, path, ecosystem, commands count, detector version), add form (name/slug auto/path), re-detect button, "open" → selects the project. |
| `/dashboard` (MAIN, rewritten) | Time-range selector (7d/30d/all) driving every read; KPI row with deltas vs the previous window (pass rate, runs, active, queue depth, gaps, quarantine, health score, flake rate, detected tools); run-outcome trend chart; duration p50/p95 trend; insight list (shared engine); pyramid strip; coverage matrix; ranked queue; quarantine suggestions **wired to the real POST**; run panel (command list + Run/Stop); runners/capacity card; links to every deep dive. |
| `/dashboard/runs` (existing) | Add the launch form wired to `run.start` by `commandId` (replace the raw `createRun` form), active/queue highlight, link to queue page. |
| `/dashboard/queue` (new) | Queued/leased/requeued/running jobs from `GET /api/v1/jobs`: state badge, wait age, attempt, runner, priority, the run link, and a Stop action per running run. |
| `/dashboard/tests` (new) | Dormant endpoints wired: test-level failures across runs — status filter (failed/flaky/all), suite filter, duration, error message, run link. This is the tester's "findings" surface. |
| `/dashboard/suites` (new) | Suite listing + per-suite pass/fail history from `/dashboard/suites`. |
| `/dashboard/quality-gates` (new) | Gate list + create (existing endpoints). |
| `/dashboard/insights` (rewritten) | The full insight list with severity cards, evidence and actions — one screen, shared engine, no duplication. |
| `/dashboard/tools` (rewritten) | The toolbox (below). |
| `/dashboard/analytics` (rewritten) | KPI drill-down: windowed KPI table, both trend charts, top failing suites/tests. |
| `/dashboard/runs/:runId` (existing) | Add: live log tail from SSE events, per-run KPI readout from `/reporting/kpis?runId=`, quality-gate card, wired Stop (reason dialog), Retry. |
| `/dashboard/score/:projectId`, `gaps`, `hollow`, `flaky`, `structure` (existing, unlinked) | Link them from MAIN and the sidebar; add the score-diff card (`?from&to`) to the score page. |

### 6.5 Toolbox page spec (`/dashboard/tools`)

- **Health bar (advisory):** `Meter` with `role="meter"`, variant `success`, value =
  `detectedCount >= 1 ? 100 : 0`, labelled *"Advisory: the stack reports ≥1 installed tool"*, with
  a one-line statement that it is advisory and never a gate. The empty state explains what would
  change it.
- **Grid:** every catalog tool as a tile — monogram tile (tool initials, token-bordered square,
  category icon from `@automate/ui` beside it), name, tier badge (FREE / PAID / FREEMIUM),
  category, one-line hook, detected marker with its evidence. Filters: tier, category,
  detected-only, text search. Grouped by category with section headings.
- **Detail:** `Drawer` with the deep content — what it is, what problem it solves, when to
  choose it, when not to / alternatives, licensing and cost concretely, install command (copy
  button), how detection works and what evidence this repo gave, learning curve, maintenance
  status, homepage/docs/repo links, last verified date.
- **Data:** `GET /api/v1/projects/:id/toolchain` for detection; catalog from
  `@automate/projects/tool-catalog` for content. The join is `tool.id`.

### 6.6 Execution UX

- Run panel (MAIN + runs page): the project's commands from `GET /projects/:id/commands`
  (`label`, `argv` joined with spaces for display only, category, confidence, evidence).
  Run button → `POST /projects/:id/run.start` with `{commandId, idempotencyKey}` (a
  client-generated UUID per press; reuse the existing `Idempotency-Key` discipline from
  `api.ts`).
- Stop button on any non-terminal run → `POST /runs/:id/stop` with a **required reason**
  (dialog, 1–500 chars, matching `RunStopBodySchema`).
- Live updates: the existing shared `EventSource('/api/v1/events')` + `useRuns` SSE projection;
  the run detail timeline already accumulates events. The `cancel` event must refresh the run
  (the store's outbox + `run.completed` publication make this work once §5.2 lands).
- Queue page: poll interval 5 s while the SSE stream is down only — same rule as `useRuns.ts:127`.

## 7. Task list (ordered; each wave leaves the tree green)

### W0 — Gate repair and de-duplication (no product change)
1. Fix the five ledger evidence paths → `Main.tsx` / `Main.test.tsx`; `pnpm findings:check` green.
2. Fix `e2e/accessibility/routes.spec.ts` `cockpit-queue` → `main-queue`; seeded-project helper comment.
3. Extract `lib/insights.ts` + `lib/qa-stack.ts` (move, don't copy); repoint `Main.tsx`; keep
   `Main.test.tsx` passing unchanged where possible.
4. Delete `InsightsPage.tsx`, `QAToolsPage.tsx` (after W6 re-homes their unique bits — if W6 is
   far away, keep them but stop rendering… **no**: delete now and re-home in W6; the sidebar
   entries for both disappear until W6 lands).
5. Delete `RunList.tsx`, `ThemeToggle.tsx`, `RunExplorer.tsx` + tests + axe-sweep entries.
6. Mount `createProjectsRoutes` in `route-manifest.test.ts`; both-direction assertions stay green.
7. `pnpm findings:check`, `pnpm test:integration`, `pnpm --filter @automate/unified-web test`
   green; ratchet not regressed.

### W1 — Catalog package (server authority)
8. Write `packages/projects/src/tool-catalog.ts` (≈50 tools, deep content, `verifiedOn`);
   subpath export; `apps/web` dependency.
9. Catalog tests (schema, uniqueness, coverage, Node-import boundary).
10. Probe module `packages/projects/src/toolchain.ts`: `probeToolchain(view, env)` → per-tool
    detection with evidence and optional version; literal-view tests for detected / missing /
    manifest-declared-but-not-installed / version-parsing cases.
11. `GET /api/v1/projects/:id/toolchain` route + route tests (workspace scoping, unknown
    project 404, probe failure = `infra` answer not a 500) + manifest row.

### W2 — Execution critical path
12. §5.1 command resolution + `startRun` configuration; route test asserting the created run's
    `configuration.command.argv` equals the profile command (this is the test that would have
    caught P3 — write it first and watch it fail against `{commandId}`).
13. §5.2 cancel plumbing (types, both stores, `cancelRun` job marking, one stop door, reason
    persisted); runner-side test that the heartbeat answer aborts the child.
14. §5.3 deadline re-arm (runner context + heartbeat); long-run test past the initial lease.
15. `GET /api/v1/jobs`, `GET /api/v1/runners` + tests + manifest rows.
16. Compose/env: `RUNNER_REPO_ROOT`, `RUNNER_SLOTS` (default 1 → keep, document how to raise),
    `.env.example`, docs. An integration test proving run → claim → complete through the real
    path on PostgreSQL (extends the durable-path spec; ledger `RF-6e` is adjacent — do not
    claim to close it without its own evidence case).

### W3 — Repositories and project context
17. `ProjectProvider` + `useSelectedProject` + `ProjectSwitcher`; `qa-client` create/refresh.
18. `/dashboard/repositories` page (list, add, re-detect) + tests; onboarding screen replaced by
    the add form.
19. Every existing QA read re-homed onto the selected project (Main, score, gaps, hollow,
    flaky, structure pages) — one context, no `projects[0]`.

### W4 — Chart primitives
20. `TrendChart`, `StackedBars`, `DonutShare` in `packages/ui` + tests + theme-resolution
    inclusion + axe pass.
21. `GET /api/v1/dashboard/kpis` + repository aggregate + tests (window boundaries, empty
    window, unit documentation in the response schema — `passRate` 0–100).

### W5 — Cockpit rewrite
22. MAIN rewritten per §6.4 (time range, KPI deltas, trend charts, shared insights, pyramid,
    matrix, queue, quarantine wired, run panel, capacity, links).
23. `/dashboard/runs` launch form → `run.start`; `/dashboard/queue`; run-detail stop/log/KPI.
24. Analytics page → KPI drill-down; insights page → single shared screen.
25. Toolbox page per §6.5 (health bar, grid, filters, drawer detail) consuming W1's probe.
26. Wire dormant surfaces: `/dashboard/tests`, `/dashboard/suites`, `/dashboard/quality-gates`,
    score-diff card.
27. Link every `visible: false` deep route from MAIN/sidebar; `route-manifest.ts` + `router.ts`
    + `route-manifest.test.ts` both directions.

### W6 — Tests, e2e, gates
28. Per-screen tests (loading/empty/error/list + the three screen states), hook tests for new
    client methods, contract tests for new endpoints, cross-workspace isolation tests for every
    new workspace-scoped read.
29. E2E: extend `e2e/product` with repo-add → detect → run → stop, and the toolbox grid;
    update `e2e/accessibility/routes.spec.ts` for the new routes (4 states × 2 themes) and the
    stale ids from W0.
30. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:contract`, `pnpm test:integration`,
    `pnpm coverage:ratchet`, `pnpm findings:check`, `pnpm build`, `pnpm compose:config`,
    `pnpm smoke:local` (against a running stack), `pnpm security:verify` (host-dependent —
    `verify:local` where semgrep/gitleaks are unavailable).
31. New ledger rows for every defect fixed in W2 (P3/P5/P6/P8 as one execution row each, with
    the failing-test-first evidence per `evidence-test`), and for the triplication removal.

## 8. Risks

| Risk | Mitigation |
|---|---|
| The runner's `repoRoot` ≠ the registered project → `resolveInside` refuses cwd, every run `config_failed`. | W2 step 16 + an integration test that runs a **trivial real command** (e.g. `node --version`) through the whole path before any suite run. |
| Renaming/deleting screens breaks the e2e route sweep and the coverage floor. | W0 deletes before W5 adds; ratchet run after each wave, not at the end. |
| New charts break the theme-resolution compile gate (token-only colours). | Use existing token utilities only; `theme-resolution.test.ts` updated in the same PR as the primitive. |
| Windowed KPI query is slow on a large `runs` table. | One aggregate query with `FILTER` (P17 pattern), index-only scan as in `getAnalyticsSummary`; assert `EXPLAIN`-level cost only if the integration suite already does so. |
| Detected-tool probing is host-dependent (PATH differs from repo `node_modules`). | Probe both, report **which** one proved presence (`evidence` field), never a bare boolean; version is best-effort and nullable. |
| Cancel storm: run cancelled while artifacts are uploading. | 5.2 keeps the lease live until the runner reports completion; the existing fencing-token check already rejects a stale completion. |
| Multiple runs saturate one runner slot and look hung. | Queue page shows state/age/attempt; runner card shows slots/heartbeat; document `RUNNER_SLOTS`. |

## 9. Validation (run in this order, per wave and at the end)

```
pnpm findings:check        # must be green before W1
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contract
pnpm test:integration
pnpm coverage:ratchet
pnpm build
pnpm compose:config
pnpm smoke:local           # against a running stack
pnpm verify:local          # full chain on this host (scanners not_configured)
```

Manual acceptance for the finished product: add a repo from the UI → see the cockpit populate →
press Run on the unit command → watch the run stream live and finish → press Stop on a long run
and watch the child die within one heartbeat → the toolbox bar shows detected tools with
evidence and the grid opens a deep tool page.

## 10. Ledger rows this plan must add or update

- New rows (red-first, per `evidence-test`): `run.start` never resolved argv; stop never reached
  the runner; run deadline bound to the first lease; the two stop doors; the hard-coded
  detection list; the insight/toolbox triplication; the missing repo-loading surface.
- Update, do not re-open: `X-3` (agent routes 501) is untouched by this plan; `C-6` (dormant
  dashboard schema) shrinks as the tests/suites/reporting surfaces are wired — close it only
  when the dormant third is genuinely served.
- Explicitly still open after this plan: `PERF-1`, `RF-9` (baselines need reference hardware),
  `RF-11` (OpenAPI), `RF-6e` (worker→runner→API proof — this plan's integration test is
  adjacent evidence, not the row's own case).
