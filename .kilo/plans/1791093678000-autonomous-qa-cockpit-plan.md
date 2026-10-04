# The autonomous QA cockpit

**Status:** plan of record. Supersedes nothing; `1791062000000-qa-cockpit-minimal-plan.md` is
landed and this plan builds on it.

**Shape:** five waves, ordered. Two of them cannot deliver their requirement until work that is
not in this plan exists, and §7 says which rather than implying otherwise.

**What a ponytail pass cut from the first draft**, because the shape of the work matters more than
its size: a fourth table became one column on `projects`; a `src/stack/` directory of three modules
became one file; a second web component with one caller was deleted; a second vocabulary
(`skipped`) became the copilot's existing `notSuggested`; a hand-maintained 13-route state matrix
became generated output; a sixth ledger row restating an open one was folded into it; and one
autonomy item nobody asked for was deleted. Net: **one wave and roughly 300 lines.** The analysis
survived intact — the blockers, the two progress modes, and the detection-not-copilot call. The
design-language-over-glass call was among them and has since been **superseded by decision**, in
`1791096500000-full-glassmorphism-plan.md`; §3.6 carries the correction. None of the rest was
decoration.

---

## 0. What this plan is, and what it refuses

Four requirements were asked for: a brand in the top-left, a Netflix-grade interface, a fully
autonomous dashboard, a Play/Pause/Stop control with a real progress bar on every tool, and a
one-time onboarding flow with a free-tier recommendation engine.

Read against this tree, **two of those are blocked on rows this repository already records as
un-landed.** That is the most important sentence in the document, so it is first rather than
buried in a risk section:

| Requirement | Blocked by | Row |
| --- | --- | --- |
| "Fully autonomous — all matrices and metrics update automatically" | The three runner Dockerfiles are **stubs**. `runners/k6/Dockerfile` builds `grafana/k6:0.57.0` with an entrypoint of `k6 version`; `runners/zap/Dockerfile` builds the ZAP base with `zap.sh -version`. Nothing in this repository has ever produced a summary for an adapter to read. | `tool.k6` = `missing`, `tool.zap` = `missing`, `runner.oci` = `mock`, `tool.playwright` = `mock` |
| "Real-time progress bar on **every** integrated tool" | Per-test events are emitted by **one** reporter, `apps/runner/src/playwright-reporter.ts`. JUnit, k6 and ZAP arrive through the upload door and are parsed *after* the run finishes. | — |
| "Pause" | Does not exist anywhere. `rg '\bpause\b'` across every `.ts` finds only GC-pause prose in a doc comment. The control vocabulary is `run.start` + `run.stop` only. | — |
| "If a public repository with 10+ stars, suggest CodeRabbit" | Reading stars needs the GitHub API. `connectors.core` is `mock`: *"Bounded adapters and SDK tests exist, but API composition, durable credentials, approvals, and artifacts are not wired."* | `connectors.core` |

So the plan delivers all four, and it delivers **honest partials where the honest partial is the
truth**:

- **Pause** lands for every tool, as a durable job state. The process-level stop is best-effort and
  the UI says so (§3.1).
- **Progress** is per-test where per-test events exist, and an explicitly **indeterminate**
  phase bar everywhere else — never a synthesised percentage (§3.2).
- **Autonomy** extends to everything above the runner: the dashboard refreshes itself, quarantined
  fingerprints re-run themselves. It does **not** extend to tool execution, because a self-driving
  loop over a stub measures nothing and reports green (§3.3).
- **Stars** degrade to `unknown`, and `unknown` does not evaluate the rule as false (§3.4).

Everything else in the request lands as asked.

---

## 1. Decisions

Two questions were blocking and both are now answered.

**D-1 — the brand.** `Cockpit` goes top-left; `Automate` stays the product wordmark. One brand per
slot, each answering a different question: *where am I* (left, the navigation target) and *what am I
using* (right, the product). No rename, so `README.md`, `site/guide/design-language.md` and
`scripts/lib/product-name.test.mjs` are untouched.

**D-2 — controls and progress.** Pause for every tool; progress honest per tool. The reasoning that
makes this the right call rather than the convenient one is in §3.2: a progress bar that invents its
denominator is the same defect as the cockpit colouring a cell it never measured.

---

## 2. What already exists, stated so it is not rebuilt

Every item below was read in the tree on 2026-10-04. Re-deriving any of it would be the
`no-second-authority` failure the repository already has rows for.

| Need | Already built | Where |
| --- | --- | --- |
| Detect which tools a repository uses | `detectProject()` returns `frameworks: FrameworkSignal[]` **per ecosystem**, each with `ecosystem`, `primary`, `families`, `signals`, `coverage`, `notes` | `packages/projects/src/detect/detector.ts:30`, `types.ts:158` |
| Recommend what to do about a gap | `answer(question, score)` — a **pure** `QaScore → CopilotAnswer` derivation, deliberately not a model | `apps/api/src/services/copilot-service.ts:69` |
| Cite evidence for every suggestion | `CopilotSuggestionSchema.evidence` is `z.array(...).min(1)` — *"a suggestion that cannot cite a row does not render"*, enforced in the schema | `packages/shared-contracts/src/schemas/copilot.ts:20` |
| Play and Stop | `run.start`, `run.stop` | `packages/shared-contracts/src/schemas/tui-commands.ts:55` |
| Durable jobs with leases and fencing | `execution_jobs` with `state`, `leaseId`, `fencingToken`, `heartbeatAt` | `packages/db/src/schema/execution.ts:166` |
| Per-test events | `test.queued` / `test.started` / `test.completed` in the versioned event union | `packages/shared-contracts/src/schemas/execution.ts:454` |
| **Emit** per-test events | Playwright only, via an NDJSON reporter | `apps/runner/src/playwright-reporter.ts:20` |
| Event storage with replay | `run_events` with `sequence`, `hash`, `version`, `receivedAt` | `packages/db/src/schema/execution.ts:222` |
| One shared SSE connection | `subscribeToRunEvents`, reference-counted | `apps/web/src/lib/api.ts:418` |
| Where glass is decided | the token authority, the lint ban and the readability floor | `packages/ui/src/tokens/theme.css`; `eslint.config.js:30`; `1791096500000-full-glassmorphism-plan.md` |
| Register a folder at boot | `discoverProject` + `discoverProjectAtBoot`, opt-in via `AUTOMATE_PROJECT_ROOT` | `apps/api/src/services/project-registry-service.ts:319` |

**The one that matters most for §4:** the detector already knows which tools the repository uses, and
it already knows it **per ecosystem**. Onboarding's "scan the repository to identify existing tools"
is not new work, and building a second scanner would be the exact class of defect `REG-1` is an open
row about.

---

## 3. Architecture

### 3.1 Pause: a durable job state, not a signal

The insight that makes this small: **`claimJob` already selects
`inArray(executionJobs.state, ['queued', 'requeued'])` and `reapExpiredLeases` already filters
`state = 'leased'`** (`apps/api/src/execution/drizzle-execution-store.ts:1056`, `:1943`). A job in a
new `paused` state is therefore invisible to both, with **no change to either query**.

```
POST /api/v1/jobs/:jobId/pause     leased → paused      (sets pausedAt)
POST /api/v1/jobs/:jobId/resume    paused → queued      (clears pausedAt)
```

- `'paused'` is added to `EXECUTION_JOB_STATES` and to the
  `execution_jobs_state_check` constraint. `pausedAt timestamptz` is the only new column.
- **The runner learns to stop from the heartbeat it already sends.** `heartbeatJob` filters
  `state = 'leased'`, so the first heartbeat after a pause returns `activeJobIds: []`. That is the
  signal to `SIGSTOP` the child. **No new RPC, no polling loop, no second connection** — and a
  paused job stops heart-beating by construction, so its lease cannot expire and the reaper cannot
  requeue it behind the operator's back.
- `job.paused` and `job.resumed` join the event union, and `EXECUTION_EVENT_VERSIONS` goes to `'2'`.
  The realtime boundary is versioned and a client that has never seen `job.paused` must be able to
  say so.
- `TUI_CAPABILITIES` gains `pauseJobs`. Declared, not implied — the same pattern as the existing
  capability list, whose whole point is that the UI cannot offer a verb the API does not have.

**What Pause is not, and the UI must say it.** Pause is durable *at the job level* and best-effort
*at the process level*. If the runner dies, the child dies, and the job stays `paused` until someone
resumes it — at which point it is re-claimed and **restarted, not continued**. A control labelled
Pause that silently becomes Restart is worse than no control, so `ToolControlBar` renders
`paused · the runner must still be alive to resume this` whenever the runner has not heartbeated
since the pause. Ledger row `PAUSE-1` records this and stays open until the runner-side path has a
test of its own.

Pause is **per job, not per run.** A run may have several attempts and several jobs, and "pause the
run" has no single answer. The control is rendered on the tool card because that is where the job is.

### 3.2 Progress: two modes, and the second one is not a worse first one

`RunProgress` is a **projection over `run_events`**, not a new table. It is derived on read, so it
cannot disagree with the event log.

```ts
{ jobId, runId, mode: 'per-test' | 'phase',
  // per-test:            phase: 'queued' | 'running' | 'analyzing' | 'uploading' | 'completed',
  completed, discovered, started, failures,
  // phase:               startedAt, elapsedMs }
```

`mode` comes from the runner's own manifest — `runners/playwright/manifest.json` declares
`progress: 'per-test'`, `runners/k6` and `runners/zap` declare `progress: 'phase'`. **The manifest is
the authority, so a tool cannot acquire a progress bar it has no events for**, and adding one is a
manifest row rather than a UI change.

- **`per-test`** needs a denominator. The Playwright reporter counts `test()` occurrences and emits
  the total as a `test.queued` batch, so `discovered` is known before `completed` is. Until that batch
  lands the bar is indeterminate and says *counting* — because `3 / 0` is worse than no bar, and a
  percentage computed from a count of zero is the exact lie the cockpit's `unmeasured` cell exists to
  avoid.
- **`phase`** renders an **indeterminate** bar naming the phase and the elapsed seconds. It is not a
  degraded per-test bar and it is not a spinner over a guess: it reports precisely what is known,
  which is that k6 is in `running` and has been for 41 seconds.

`ProgressBar` takes `mode` as a required prop and renders `data-progress-mode`, so a test asserts
which of the two a given tool got. One test per mode; the assertion is that the phase bar's DOM
contains **no percentage at all**.

### 3.3 Autonomy: above the runner, never through a stub

Four things become automatic, and each names the trigger rather than a timer:

1. **The cockpit refreshes on completion.** The shared `EventSource` already carries `run.completed`
   for the visible project; the cockpit's five reads re-fire on it. **Not a global 5-second poll** —
   `useRuns` already owns that one, and a dashboard that re-reads five endpoints every five seconds
   for ever is a number nobody can hold still long enough to read.
2. **A registered folder is detected at boot.** Landed in the previous plan.
3. **An already-registered folder is re-detected at boot.** Landed. A `package.json` that gained a
   runner yesterday shows up today with nobody pressing anything.
Three, and each names its trigger rather than a timer. A fourth was drafted — *a quarantined
fingerprint re-runs on the next commit* — and **cut**: nothing asked for it, and it would mean
extending `schedules` (which C-6's resolution records as raw SQL in
`apps/worker/src/postgres-store.ts:388,467,590`) into a second dialect to express a semantic that
does not exist yet. That is a speculative feature wearing a small diff.

**What does not become automatic:** tool execution. `runners/*/Dockerfile` are stubs, so an
autonomous loop over them produces green from nothing. `AUTO-1` records this as a Blocker on the
*requirement*, not on the code — the code is correct and the inputs are absent.

### 3.4 The recommendation engine: detection-time, and deterministic

Two things must not happen here, and both are named because both are tempting.

**It is not a second copilot.** The copilot derives from `QaScore` — it needs *runs*. Onboarding
happens at registration, when there are **zero runs and therefore no score**. Different input,
different evidence, different lifetime. They get different contracts and different endpoints, and
the reason is stated in both files so nobody merges them later as a cleanup.

**It does not call a model.** `copilot-service.ts:14` already settled this: *"Routing any of them
through a language model would add a place for the answer to be wrong… and make the same question
have a different answer each time, which is the one property a QA number cannot afford."* A
recommendation list that reshuffles on every page load is worse than no list.

**Input:** the `DetectionReport` the detector already produced. `frameworks` is read across **all**
ecosystems, never just `primary` — a monorepo with a Node app and a Python service has both, and
reading only the primary would recommend Playwright over an existing `pytest` suite. That is the
most likely bug in this whole feature and it gets a named test.

**The catalogue is data, and it lives beside the code that reads it.**
`packages/projects/src/stack-catalogue.json` — one row per tool per category. Not `docs/quality/`:
a package reaching into `docs/` is a layering inversion, and the site's own rule is that it
"consumes only the generated register, never hand-typed numbers", so the docs side is a *reader* of
this file rather than its owner.

```json
{ "id": "trivy", "name": "Trivy", "category": "security",
  "licence": "Apache-2.0", "freeTier": "unlimited",
  "runnerCapable": true, "needsCredentials": false,
  "why": "SAST and dependency scanning over the filesystem and the image.",
  "install": "…a reviewable document, never a shell line" }
```

`runnerCapable` is the load-bearing column, and it is a statement about **this product**: whether a
runner image can execute the tool. It is not the same as "is the tool free".

| Category | Tools | `runnerCapable` | Note |
| --- | --- | --- | --- |
| Unit / integration | Vitest, Jest, `go test`, pytest, JUnit | mixed | usually already present; suggested only when absent |
| E2E | **Playwright**, Cypress, Selenium | Playwright `true` | the requested rule |
| Static analysis | SonarQube Community Build, ESLint, Ruff | ESLint/Ruff `true`, SonarQube `false` | needs a JVM and a server; Community Build also does not cover every language |
| Security | **Trivy**, Semgrep, CodeQL | Trivy/Semgrep `true` | |
| Mutation | **Stryker** | `true` | see below |
| AI review | **CodeRabbit** | `false` | hosted service, no self-hosted tier |
| Load | k6 | `true` | image is a stub today |

**Every rule the user named, with its trigger and its failure mode:**

| Rule | Trigger | Fails when |
| --- | --- | --- |
| CodeRabbit | `stars >= 10` | Stars need the GitHub API and `connectors.core` is `mock`. So `stars: number \| 'unknown'`, fetched opportunistically, and **`unknown` does not evaluate the rule as false** — it produces a `skipped` row saying the star count could not be read. A rule that silently skips on an API error is a rule that fires on some installs and not others with no way to tell which. |
| SonarQube | no detected static-analysis tool | Must say *Free Tier / Community Build* and note the language limits, or it recommends something that will not analyse the user's stack. |
| Trivy | no detected SAST or dependency scanner | Must note it also scans dependencies and images, not just source. |
| Stryker | no detected mutation tool | **This one is not only a suggestion.** `W11.5` condition (b) asks for a `mutation-baseline.json` with a ratchet of the same shape as `coverage-baseline.json`. So Stryker lands as *the product's own gate* — which is the first time in this programme a customer-facing suggestion and an internal debt row are the same piece of work. |
| Playwright | **no e2e family in any ecosystem** | Evaluated over all ecosystems, not `primary`. |

**Output:** `GET /api/v1/projects/:id/stack` → `{ confirmed, suggested, notSuggested }`.
`notSuggested` is the **copilot's own field name and its own meaning** — reused rather than
re-invented, because a second vocabulary for "here is why I am not saying it" is a second authority
and it exists already. It exists for the copilot's reason: a statement with nothing behind it is
indistinguishable from a guess.

Every suggestion cites `evidence: min(1)`, reusing the copilot's schema rule rather than restating
it.

### 3.5 Onboarding once, and what "configurable" has to mean

**No new table.** An earlier draft specified `project_stack_decisions` with four columns — and
`projects` already carries `settings jsonb`, `repositoryUrl` and `detectorVersion`
(`packages/db/src/schema/dashboard.ts:131`). "Has this project been onboarded" is a property of the
project, so it goes on the project:

| Field | Home | Why there |
| --- | --- | --- |
| `onboardingCompletedAt timestamptz` | a real column | the "once" is then `IS NULL`, which is a `WHERE` clause rather than a JSONB probe — worth one column and one migration |
| `completedVersion int`, `confirmed[]`, `dismissed[]` | `projects.settings.onboarding` | nothing queries these; `settings` exists for exactly this shape |

That removes a schema block, a table migration, a `docs/quality/tenancy-scope.json` row and a
cross-workspace isolation test — and `projects` already has an isolation test, so there is nothing
left to write. **`tenancy:check` is satisfied by not adding a table**, which is the cheapest possible
way to satisfy it.

- **The trigger is free.** `discoverProject` at boot and `POST /api/v1/projects` both already
  produce a `DetectionReport`. The onboarding decision is **returned by the same call**, not computed
  by a second scan. This is the single most important structural decision in the feature.
- **"Configurable via settings" means versioned re-prompting.** `completedVersion` records which
  ruleset the operator answered. Bumping it re-prompts once. That is the honest reading: an operator
  can re-run onboarding deliberately, and cannot re-run it by accident. A boolean `onboardingDone`
  with no version makes the second question — *"why is it asking again?"* — unanswerable.

### 3.6 The interface: glass, and the floor it has to clear

The request asks for Netflix-grade. Netflix's signature visual move is `backdrop-filter`. This
repository had made it an ESLint **error** with a written, measured reason, and Phase 2's allowlist
was gated behind `PERF-1`.

**Superseded while this plan was being written.** `1791096500000-full-glassmorphism-plan.md` records
G-1 and G-2: glass is permitted **over data** as well as chrome, and the allowlist opens with the
rendering budget uncalibrated and that gap recorded in `PERF-1`. The argument below is kept because it
is the record of what was decided *against*, and because the cockpit is the first screen glass lands
on — but the conclusion no longer holds. **The visual target is the glass design language**, and the
cockpit's first obligation under it is §3's readability floor, because the limiter headline is a
number somebody has to be able to read.

"World-class" is then expressed as four things this repository can actually check:

1. Every route has **loading, empty, error and partial** states — `W11.4` removal condition (b).
   `/dashboard` already has six: loading, report, five-reads-failed, registry-error, onboarding, and
   the project named with no path recorded. The others do not. → `docs/quality/state-matrix.md`.
2. **axe zero serious and zero critical on every route in both themes** — `W11.4` condition (a).
   **Done.** `e2e/accessibility/routes.spec.ts` exists, generated from
   `apps/web/src/route-manifest.ts` so the list cannot drift from the routes, covering all
   eleven paths in both themes and in four forced data states — 66 tests, its own Playwright
   project, green against a real PostgreSQL and a real browser. `pnpm status:10` point 4 now
   finds the file. What it found was not a contrast failure but a **blank page**:
   `RunDetailPage` returned `null` while a run was loading, so the loading state of the most
   consequential route in the product rendered an empty `<main>`. Ledger row `GLASS-2`, fixed,
   and its cause was a superseded refresh clearing a shared loading flag. Condition (b) — the
   state matrix — is still open and still depends on `BK-1` shipping a domain.
3. Every colour, type, elevation and motion utility resolves against a real Tailwind compile. The
   gate exists (`apps/web/src/theme-resolution.test.ts`) and already scans both trees.
4. The wordmark placement of D-1, with a test per slot.

---

## 4. The waves

Each wave is one commit series with one gate, and each opens with its ledger rows so the state is
recorded before the code moves it.

### W0 — Re-derive `W11.4`, and record what this plan is blocked on

`W11.4`'s deferral argument is *"a console with nothing behind it is a design decision nobody has
made yet… A redesign before BK-1 lands is the redesign of an empty screen."* **That argument is now
partly stale.** `/dashboard` has five real reads, a limiter headline, a ranked queue, a pyramid
strip, and six distinct states. The row's own removal condition (b) asks for a state matrix, and one
route can now be written into it.

`REG-1` is an open row about exactly this shape — a status asserted against a tree that had since
moved, with every gate green. So the row is re-derived rather than quietly reinterpreted, and the
re-derivation is recorded in the row.

- **Gate:** `pnpm findings:check`, and `pnpm status:10` reporting no *new* fail.
- **Files:** `docs/quality/findings-ledger.json` only.

### W1 — Brand, states, and the axe spec

- `apps/web/src/components/NavBar.tsx` — the left slot stops being a `text-sm font-semibold` nav
  link and becomes a wordmark. `Cockpit` left, `Automate` right, one job each.
- `apps/web/src/components/NavBar.test.tsx` — **red first.** Asserts each name appears exactly once,
  and that the left one is the link to `/dashboard` with `aria-current="page"`. The existing test
  asserts `Automate` appears once and that `Release Command Center` is absent; both survive.
- `docs/quality/state-matrix.md` — **generated, not hand-written.** `W11.4` condition (b) names a
  matrix, so one exists; but 13 routes × 4 states kept in step by hand is a document that drifts the
  week after it lands. The axe spec below already enumerates every route and every state it visits,
  so the matrix is emitted from that list. Nothing to maintain, nothing to disagree with.
- `e2e/accessibility/routes.spec.ts` — NEW, `W11.4` condition (a), both themes. It is the matrix's
  only writer, which is why there is no second list.
- **Gate:** `pnpm status:10` point 4 flips `fail` → `pass` on the accessibility clause; axe zero
  serious and zero critical on all 13 routes in both themes.
- **Risk:** if a route genuinely lacks a state, this wave *adds* the state rather than recording a
  blank. That is the intended work; recording blanks would make the matrix a document nobody reads.

### W2 — Pause

Order within the wave: contract → schema → migration → store → route → runner → UI. Each step
red-first, and the runner step is the one that must not be skipped.

- `packages/db/src/schema/vocabularies.ts` — `'paused'`.
- `packages/db/src/schema/execution.ts` — `pausedAt`, and the `execution_jobs_state_check` constraint.
- `pnpm db:generate` for the migration. **Not in `verify` and not in a workflow** — CI has no
  persistent database, so applying a migration there proves nothing (the `migrate:apply` precedent).
- `packages/shared-contracts/src/schemas/execution.ts` — `JobPauseBodySchema`, `job.paused` /
  `job.resumed`, `EXECUTION_EVENT_VERSIONS` → `'2'`.
- `apps/api/src/execution/drizzle-job-control.ts` — NEW, holds `pauseJob` / `resumeJob`.
  **`drizzle-execution-store.ts` is not grown:** it is 2 166 lines and holds two of the top complexity
  offenders, which is open row `C-4`. Two more methods on it would make that row worse.
- `apps/api/src/routes/execution/jobs.routes.ts` — the two routes.
- `apps/runner/src/execution.ts` — `SIGSTOP` on losing the lease, `SIGCONT` on re-claim.
- `packages/shared-contracts/src/schemas/tui-commands.ts` — `pauseJobs`.
- `apps/web/src/components/ToolControlBar.tsx` — NEW: **Play / Pause / Stop and the progress bar, one
  component, used by every tool card.** The standardisation is the component being single, not a
  repeated markup pattern. `ProgressBar` is a local function inside it rather than a second file —
  two modes and an indeterminate case do not need their own module, and `apps/web` is already at its
  coverage floor, so every extra file is another file that needs a real test to stand still.
- **Gate:** `pnpm test:runner` green; `pnpm migrate:validate`; an isolation test per new transition.
- **Ledger:** `PAUSE-1`, open, Major.

### W3 — Progress

- `runners/*/manifest.json` — `progress: 'per-test' | 'phase'`. **Playwright only is `per-test`.**
- `apps/runner/src/playwright-reporter.ts` — emit the `test.queued` total.
- `apps/api/src/routes/execution/progress.ts` — NEW, a pure projection over `run_events`, unit-tested
  with no database. Worth its own file precisely because it is the one piece of W3 that can be proved
  on a host with no PostgreSQL.
- `GET /api/v1/jobs/:jobId/progress`; the bar itself renders inside `ToolControlBar`, with `mode`
  required and `data-progress-mode` in the DOM.
- **Gate:** two tests, one per mode. The phase test asserts the rendered DOM contains **no
  percentage**, which is the assertion that fails if someone later helpfully adds a fake one.
- **Ledger:** `PROG-1`.

### W4 — Autonomy

- `apps/web/src/components/Cockpit.tsx` — re-read on `run.completed` for the visible project only.
- `apps/web/src/lib/api.ts` — subscribe on the **existing** shared connection. A second
  `EventSource` is exactly the leak the previous plan closed.
- **Gate:** `pnpm --filter @automate/unified-web test` — and the coverage floor holds at **96/88/96/98**
  without lowering it. One new web file here, so one real test.
- **Ledger:** `AUTO-1`, **Blocker**, and the title says what it is: *autonomy stops at the runner
  image*.

### W5 — The stack engine, and onboarding once

Both halves, because both touch `project-registry-service.ts` and both are driven by the same
`DetectionReport` that register and boot-discovery already produce. Splitting them was an artefact of
drafting them separately.

- `packages/projects/src/stack-catalogue.json` — NEW, the table in §3.4.
- `packages/projects/src/stack.ts` — NEW, one file. It is a pure derivation over `DetectionReport`,
  which is what this package already owns, and it is unit-testable with **no database** — which
  matters, because this host has none. An earlier draft specified a `src/stack/` directory of three
  modules and a loader; one function over one JSON document does not need a barrel file.
- `packages/shared-contracts/src/schemas/stack.ts` — NEW + test. A wrapper, not a redefinition: the
  suggested row **is** the catalogue row, so only `confirmed` and `notSuggested` are new shape.
- `apps/api/src/routes/projects.ts` — `GET /:id/stack`.
- `apps/api/src/services/project-registry-service.ts` — carry the onboarding decision out of
  `discoverProject` and `registerProject`, and write it to `projects.onboardingCompletedAt` +
  `projects.settings.onboarding`.
- `packages/db/src/schema/dashboard.ts` — one column; `pnpm db:generate` for the migration.
- `apps/web/src/routes/onboarding.tsx` — NEW, and the **only** new web file. Built from the existing
  `Card` / `Button` / `Table` / `Badge` in `packages/ui`; a `StackConfirmation` component with one
  caller would be a file whose only job is being imported.
- `packages/connectors/github/` — `stars: number | 'unknown'`, opportunistic, never blocking.
  `projects.repositoryUrl` already exists, so there is no new plumbing to find the repository.
- **Named test:** *a monorepo with an existing `pytest` suite is not recommended Playwright* — because
  the rule reads every ecosystem, not `primary`.
- **Named test:** *an unreadable star count produces a `notSuggested` row, not a silent absence.*
- **Gate:** `pnpm tenancy:check` (satisfied by not adding a table), `pnpm migrate:validate`, and the
  `projects` isolation test still green.
- **Ledger:** no new row. The catalogue's hand-asserted `runnerCapable` column is `REG-1`'s existing
  class, so it is **added to `REG-1`'s scope** rather than restated as a row of its own.

---

## 5. New ledger rows

| Row | Band | What it records |
| --- | --- | --- |
| `AUTO-1` | Blocker | Autonomy stops at the runner image. Three Dockerfiles are stubs, so the "fully autonomous" requirement has no inputs. The code is correct; the absence is the finding. |
| `PAUSE-1` | Major | Pause is durable at the job level and best-effort at the process level. A resumed job is a restart. Open until the runner-side SIGSTOP/SIGCONT path has its own test. |
| `PROG-1` | Major | Progress is per-test for Playwright and phase-level for every other tool. Nothing derives a percentage from a count that was not measured. |
| `W11.4` | — | **Re-derived, not closed.** The "empty screen" argument is partly stale for `/dashboard`; conditions (a) and (b) stay. |

**No row for the stack catalogue.** `runnerCapable` is hand-asserted, and that is exactly what
`REG-1` is an open row about. A second row restating an open row's class is how the ledger gets
diluted; this one goes into `REG-1`'s scope instead.

---

## 6. Risks

1. **The two stub runner images make every "it works" claim on this host unrepresentable.** W2 and W3
   are provable against the control plane and the event log without them; W4's end-to-end story is
   not. Stated in W4 rather than discovered in review.
2. **`apps/web` coverage is at its floor.** 96/88/96/98, ratcheted. Two new web files
   (`ToolControlBar`, `onboarding.tsx`) each need a real test or the ratchet fails — and lowering a
   floor to make room is the failure `AGENTS.md` names explicitly. This is also why the draft's three
   web components became two.
3. **`C-4` is open on `drizzle-execution-store.ts`.** W2 adds a sibling module rather than growing it.
   If that module grows past the complexity ceiling, the gate says so and the row gets worse; the
   ceiling is not raised to accommodate this plan.
4. **The event-union version bump touches every SSE consumer.** `EXECUTION_EVENT_VERSIONS` → `'2'` is
   correct and load-bearing, and it means `packages/realtime`'s replay has to be re-proved for the new
   types. That proof belongs in W2, not after it.
5. **`stars` depends on an API that is not wired.** `skipped` carrying the reason is the whole
   mitigation. A suggestion list that is silently shorter on some installs is indistinguishable from
   one that found nothing.

---

## 7. What this plan does not decide

- **Whether the runner images get built.** That is the unblocking work for `AUTO-1` and it is not
  here. Everything above the runner is.
- **The `since` control and `ChangePanel`**, which the previous plan sequences as a follow-on. Unchanged
  by this plan; the diff endpoint they would read now genuinely honours `?since`.
- **Whether `Automation` gets an LLM at all.** `automation.chat` is `mock` and the copilot argues
  against it in its own header. This plan follows the existing decision rather than reopening it.
- **The glass allowlist.** Decided while this plan was being written, and not here:
  `1791096500000-full-glassmorphism-plan.md` records G-1 and G-2 — glass is permitted over data as
  well as chrome, and the allowlist opens with the rendering budget uncalibrated and that gap carried
  on `PERF-1`. §3.6 records what that changes for the cockpit, which is the readability floor.