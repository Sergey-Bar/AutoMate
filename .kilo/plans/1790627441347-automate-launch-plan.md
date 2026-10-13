# Automate — launch plan: sweep, build, and make it legible

**Started 2026-09-28.** Succeeds `1790620936254-contributor-readiness.md`.

The findings programme is done and the repository is calm: 121 rows, 81 fixed, 4 refuted,
35 open, 1 debt, clean tree, a gate chain that fails on a regression. What is missing is
not correctness — it is **finish**. 35 rows nobody closed, five GitHub issues describing
code that is already fixed, a README whose quick start does not work, zero screenshots, a
13-line changelog, an empty repository description, and no website at all.

**Ordered because of dependencies.** Phase 0 exists because nothing after it can be
verified without it. Phase 4 is worth as much as 1–2, because a correct project nobody can
run is not a working one.

---

## Decisions taken

| Question | Decision | Why |
| --- | --- | --- |
| Website | VitePress in `site/`, new Pages workflow | Fits pnpm + Vite 6 + TS 5.9; builds under turbo; real search and dark mode |
| Site content | Curated pages hand-written in `site/`; long-form reference docs **read from `docs/` at build time** | One source for reference material, full design control for landing pages |
| Claim posture | Evidence-backed upgrade only | The register is machine-checked; claiming more than the gates prove puts the README in contradiction with the repo's own gate |
| Local gates | `security:static` degrades to a recorded `not_configured` under an explicit opt-in env; CI never sets it | Keeps "an unrun gate is not a pass" intact in CI while making `verify` completable on this Windows host |
| `tool-sdk` | **Contracts-only leaf.** Types and interfaces only, depending on `@automate/shared-contracts`. `apps/runner` implements it | The interface is already named in the plan of record; a leaf cannot import persistence, which is dependency rule 11 |
| Engines | One real (Playwright), four bounded adapters that return a structured `not_supported` | A refusal with a reason is a product decision; a 501 is the absence of one |
| C-6 | Write a justification per table; drop nothing | Dropping 25 tables needs a forward migration, and the repo has no rehearsal harness yet (RF-5) |
| X-4 | Minimal API-only chat; **no web UI** | Closes a Critical row with two routes; the tables and the SSE boundary already exist |
| Duplicate Playwright parser | Differential test + new ledger row | Makes the drift a checked invariant without rewriting a live ingestion path |
| Sweep scope | Every row closeable from inside the repo, plus the deferred product work | Rows blocked on external facts get a written disposition, never a fake close |

**Non-negotiables carried forward.** No coverage floor is lowered. No threshold is widened
to make a gate pass. Every closure ships a fail-before record. Every capability claim names
the executable command that proves it.

**Budget facts.** `verify` is **13** steps today (`gate-tooling.test.mjs` counts them);
adding `docs:check` makes it 14, against a hard budget of 20. `apps/web`'s recorded
coverage is 96.18/88.47/96.34/98.23 — floors only move up.

---

## Phase 0 — Make the gates runnable (blocks everything after)

The pip-installed `semgrep.exe` never returns on this host, so `security:static` →
`security:verify` → `verify` cannot complete locally. Everything downstream is unverifiable
until this is fixed.

### 0.1 Opt-in host degradation

- `scripts/static-analysis.mjs` gains `AUTOMATE_HOST_SCANNERS=unavailable`. When set **and**
  a scanner is missing, it prints
  `Static analysis: not_configured — semgrep unavailable on this host (AUTOMATE_HOST_SCANNERS); enforced in CI`
  and exits **0**. Absent the env var, behaviour is unchanged (still exit 1). A scanner that
  *ran* and found something still fails even with the env var set. The structural config
  check keeps running either way.
- New root script `verify:local` = the `verify` chain with the env var set, named so nobody
  runs it and believes they ran `verify`.
- `scripts/lib/gate-tooling.test.mjs` asserts **no workflow sets `AUTOMATE_HOST_SCANNERS`**
  and that `verify:local` is tiered `never-in-ci`.

### 0.2 Workspace prep for `site/`

Do this before any site file exists, so the first commit does not make five gates red.

- `pnpm-workspace.yaml`: add `site/*`. Verified safe — `unify-preflight.mjs` only asserts
  the *presence* of the five existing globs, never forbids an extra.
- `turbo.json`: add `site/.vitepress/dist/**` to `build` outputs.
- `eslint.config.js`: `site/**/*.ts` currently gets the base, sonarjs, and security blocks
  automatically. Add a minimal scoped block for `site/**`; do **not** add it to the
  type-aware glob (that uses `projectService` and would start failing on a package outside
  its tsconfig).
- `.jscpd.json`: no change needed — `**/dist/**` already covers the build output.
- `scripts/static-analysis.mjs`: add `site/.vitepress` to the explicit semgrep scope list.
  The list is written out precisely so a new surface cannot be silently unscanned.
- **Do not** create `site/vitest.config.ts`. `coverage-ratchet.mjs` derives members from
  `apps|packages|tools|tests` roots; a site package with a vitest config and no
  `coverage-baseline.json` entry fails with *"has tests but no entry"*.
- `site/` is not scanned by `complexity-gate.mjs` and that is fine — a clean site costs
  nothing. Do not add it to that argv list.

**Done when:** an empty `site/` package is committed and `pnpm verify:local` is still green.

---

## Phase 1 — The bug sweep

One reviewable PR per group. Each closure follows the four-step procedure in
`CONTRIBUTING.md`. Run `pnpm findings:baseline` **deliberately** at the end of a group,
never as a side effect of a failing check.

### 1a. The shared-file wave — do first (Risk R1)

Six rows plus C-4 all want `apps/api/src/execution/drizzle-execution-store.ts` (2 166
lines). Fix before the split, not after. Re-read the file's current length first — the
ledger's line numbers are from a prior tree.

| Row | Fix |
| --- | --- |
| Q-50 | `.limit()` on `listArtifacts` / `listPolicies`; stop concatenating the unbounded legacy `listRuns()` into the paged response at `runs.routes.ts:78` |
| Q-49 | One `UPDATE runs` per batch item, not two inside one transaction |
| Q-51 | Add a `lease_owner`-leading index; the `run_id` half is already served by `execution_jobs_run_attempt_unique` and closes with a `refutedBy` note |
| Q-47 | One `inArray` batch query in the dashboard aggregation; bound the outer `listRuns()` |
| C-4 | Split the store into focused modules. **Last in this group** |
| S-2 / S-5 / S-6 / S-7 | Session retention: write `lastUsedAt` through and onto `SessionRecord`; implement `deleteExpired` on both backends; consume `sessionRetentionDays` in the worker sweep. `S-2` and `S-7` are one feature and cannot close apart |

### 1b. API correctness and observability

- **O-5b** then **O-4b** — surface `durable-realtime-bus.ts`'s `lastError`/`lastSweepError`
  through a real health seam first, so `/metrics` has readiness state to report. Hand-rolled
  Prometheus text, one file, counting what already exists: run outcomes, gate verdicts,
  queue latency, runner heartbeats.
- **O-3b** — add `apps/api/src/observability/logger.ts`; construct the error boundary with
  it; replace the 8 bare `console.error` sites and the `console.warn`.
- **Q-53** — `pbkdf2Sync` → async `crypto.pbkdf2` with identical parameters; assert the LRU
  hit path. (The row's two headline claims are already refuted — the cache is wired, and a
  fresh salt per seal is the security property working.)
- **S-1** — index the in-memory session service; it HMACs and scans the whole map per request.
- **F-8** — calibrate the `encodeURIComponent` proof test. The fix is already in the tree; the
  row is open only because the test was removed. Build the fixture from what `collectSpecs`
  actually walks, watch it fail, land it.
- **P-72b** — make bootstrap key derivation explicit and opt-in outside development. The
  row's four open questions are decisions: answer them in the row, and in
  `docs/architecture/` if they move a boundary.
- **C-1** — add the missing evidence paths for the plan's unevidenced fixed rows, or refute
  the ones that were never real.
- **F-4 data defect** — the row carries a duplicated `band` key (`"Major"` then `"Minor"`);
  JSON parsers take the last one. Remove the duplicate.
- **`agents.ts` domain/action duplication (new, not in the ledger)** —
  `apps/api/src/routes/agents.ts:3-4` hand-writes
  `new Set(['browser','api','load','security','mobile'])` × `new Set(['generate','run','scan'])`,
  duplicating `AgentDomainSchema` in `packages/shared-contracts/src/schemas/agents.ts:17`,
  which the route serving it never imports. Derive both sets from the schemas. This is the
  same defect class the repo has already fixed twice ("the event allowlist is derived").
- **`workspaces` (new, investigation item)** — `AGENTS.md` calls `WORKSPACE_ID` the only
  tenancy boundary, but `workspaces` has no product writer; only ~12 test fixtures insert
  into it. Establish whether the boundary is an enforced FK or a bare column value, and
  write the answer down either way. If it is unenforced, that is a security finding and it
  outranks most of this list.

### 1c. Web

**Constraint governing the whole group:** `apps/web` sits at its ratchet floor with about
one line of margin, and row **W-5**'s fix was already written and **withdrawn** for exactly
that reason. Write the covering test *first*, in the same commit as the fix. If a floor
must move, it moves **up**.

- **W-3** — replace the module-level auth singleton with a context-provided store; remove the
  `window.location.assign` workaround in `lib/api.ts`.
- **W-4** — compare registrations by a stable key, not object identity; stop the
  deregister-then-reregister double notify.
- **W-5** — split the component so `useRuns` is not called before the `<Outlet />` early return.
- **W-6** — replace the bare `return null` with a real not-found state.
- **W-7a** — one locale- and time-zone-explicit `formatDate`. Accept that rendered bytes change.
- **W-9** — `addEventListener('change', …)` on the colour-scheme media query; remove the
  unchecked `as Theme` cast; guard storage access; add a pre-hydration theme script to
  `index.html` so there is no flash.
- **C-2** — resolve the `tool.playwright` / `quality.browser` contradiction and the two
  `real` rows citing dead evidence. Add a `quality.mobile` row for the new tool-sdk.

### 1d. Metadata, docs, and process

- **C-6** — write `docs/quality/capability-justification.md` covering all 25 dormant tables:
  planned (with capability and phase), dead, or boundary. `workspaces` is stated explicitly
  as the tenancy FK parent of `runs` and `runners`. `schedules` is live — the row's claim
  otherwise is wrong.
- **RF-6** — add ledger rows for the waves carrying a gate obligation and no row (W14, W15,
  W17, and W2's gate).
- **RF-10** — add WebKit and a mobile viewport project to `playwright.config.ts`. The design
  language's `backdrop-filter` is a WebKit-history effect; this is a real coverage hole.
- **RF-11** — generate `openapi.json` from the Zod schemas in `packages/shared-contracts`
  rather than hand-writing it, plus a test that fails when a route exists and no schema does.
- **RF-12** — build the general fix, `docs:check`, in Phase 5. It has live targets already:
  `AGENTS.md:131` cites `src/routes/chat.test.ts` (does not exist) as a command example, and
  `docs/migration/unified-repository-migration.md:67,1086,1215` cite
  `apps/api/src/modules/orchestrator/chat.ts` (does not exist).
- **New: duplicated Playwright parser** — `apps/api/src/routes/reporter.ts:410`
  (`convertPlaywrightJsonToUpload`) hand-rolls the conversion on the live path, while
  `packages/reporter`'s `playwrightJsonAdapter` implements it properly and is imported only
  by `tests/contract`. Write a differential test running one fixture through both and
  asserting they agree on the status ladder, the test set, and the evidence pointers. Record
  a ledger row with a removal condition. Do not refactor the live path in this plan.
- **New: dead `RunnerClient`** — `packages/runner-sdk/src/client.ts` targets
  `/api/v1/runner/v1/enroll` and `/sync`; the runner binary uses its own `apps/runner/src/client.ts`.
  Delete it, or record why it exists.
- **New: migration snapshots stop at 0004** — `packages/db/drizzle/meta/` has snapshots
  only for `0000`–`0004` while the journal runs to `0020`, so `drizzle-kit generate` cannot
  diff from 0005 onward. Establish whether that is expected and write it down.

### 1e. Honest dispositions

**G-4b, D-4, RF-9, PERF-1** do not close. Each gets a disposition naming the external fact,
the exact command that would close it, and who runs it: reference hardware, a different
branch, a different OS. `X-3` closes only in Phase 2, and only against its recorded removal
condition — do not rewrite that condition to match what got built.

---

## Phase 2 — The deferred product work

This is what upgrades the claim, and the part most likely to become vapour. Every item must
end in something a gate can check.

### 2.1 `packages/tool-sdk` — a contracts-only leaf

The plan of record already names the interface
(`docs/migration/unified-repository-migration.md:143,205,1072`): *adapter contracts,
capability manifests, normalized progress, cancellation tokens; tool-specific images must not
import the web app or control-plane persistence.* Five lifecycle verbs —
`validate` / `prepare` / `execute` / `cancel` / `collect`.

Types and interfaces only. One dependency: `@automate/shared-contracts`. No runtime, no
framework, no plugin registry. Model it on the two house-style ports this repo already has —
`ProducerAdapter` in `packages/reporter` and `AiGateway` in `packages/automation`: one pure
interface, N `implements` classes, injectable transport seams, zero implementation deps.

Needs: `package.json` in house style, `tsconfig.json` / `tsconfig.build.json`, a
`coverage-baseline.json` row, and an entry in `infra/docker/api.Dockerfile` if the API
depends on it. `packages/*` is already a workspace glob, so no workspace edit.

### 2.2 One real adapter, four bounded

- **browser/Playwright: real.** `apps/runner/src/execution.ts:68` already has a one-method
  `ExecutionProvider`, and `RunnerService` is already tool-agnostic — the Playwright-specific
  leak is three lines (`runner-service.ts:365-367` reading `spec.configuration`, plus the
  `'succeeded' → 'passed'` remap at `:407`). Generalise those three lines and the seam is
  done. `PlaywrightExecutionAdapter` is the first adapter that `implements` the tool-sdk.
- **api, load, security, mobile: bounded.** Each declares what it can execute, refuses what
  it cannot, and returns a structured `not_supported`. The register says `bounded`, with the reason.
- Capability matching is bare strings (`RUNNER_CAPABILITIES` defaults to `'playwright,chromium'`),
  so each manifest must expose an id the `claimJob` query can match.
- Prove the real adapter by extending `e2e/product/*.spec.ts` with one assertion that the run
  came through the tool-sdk path and not legacy ingestion.

### 2.3 The 501s become decisions

`apps/api/src/routes/agents.ts` answers 501 for all 15 domain/action pairs. Replace the
501 with a routed dispatch: a real result for `browser`, a structured `not_supported` for the
other four. The route's flat body shape is deliberate and documented — 501 is `>= 500`, so
`DomainError.toBody` would blank the message. Keep that shape for the refusal; do not route
it through the error boundary.

Also `/api/v1/features` (`routes/health.ts:72`) currently returns `{ features: {} }` from
a hard-coded literal. Back it with the tool manifest registry so the answer is derived.

### 2.4 X-4 — minimal API-only chat

`packages/automation` is exported, tested, and imported by nothing. **Its summary is
false**: it claims no `package.json` declares the dependency, and `apps/api/package.json:17`
does. Correct the summary; the real defect is *declared but unimported*.

Build `GET /api/v1/chat/models` and `POST /api/v1/chat/stream` over the existing `streamSSE`
boundary, wired to `AiGateway` from one composition root. The `conversations` and `messages`
tables already exist and are already workspace-scoped by migration `0018`. No web UI.

**Update `apps/api/src/route-manifest.test.ts`'s `CANONICAL_API_ROUTES` in the same commit.**
Three tests there fail on any registered-but-unlisted route, and the list is machine-checked
against the router — a new route that is not listed is a red gate, not a missed test.

---

## Phase 3 — Make it work for a stranger

### 3.1 Fix the quick start — it is currently broken

`README.md` tells the reader to set `PORT=3456` and start the web app.
`apps/web/vite.config.ts` hardcodes the dev proxy to `http://127.0.0.1:3000`,
`packages/config` defaults to `3000`, `.env.example` says `3000`, `AGENTS.md` says `3000`.
**Following the README as written produces a dashboard whose `/api` calls go nowhere.**
Also wrong: the sign-in credential (`local-installation-key` vs the value it just told you
to set) and the claim that Vitest uses "package-level thresholds", which `vitest.shared.ts`
explicitly refuses.

Fix by making the web proxy read one source of truth rather than by editing the number — a
proxy target that resolves from the same `PORT` the API reads cannot drift again. Add a test
asserting the proxy target and the API default agree.

### 3.2 Prove the quick start end to end

A test that boots the zero-database sample exactly as the README says, logs in, and asserts
the dashboard renders. If README and running system disagree, the test says which is wrong.
The documented path is the tested path.

### 3.3 Visual evidence

The repo contains **zero images**. Drive the real stack with Playwright and capture the six
real screens — Login, Command Center, Runs, Run Detail, Analytics, Quarantine — at
1440×900, light and dark, into `docs/assets/screens/`. `png`, `gif`, and `mp4` are all in
`secret-scan.mjs`'s binary-skip list, so committed assets are not scanned as text.

`pnpm docs:screenshots` is `never-in-ci`. If a screen is `mock` in the register, its caption
says so — a screenshot of a mock state presented as the product is the exact defect this
repository was built to prevent (Risk R5).

### 3.4 Short demo

A GIF of the run lifecycle: launch a run, watch it move through phases over SSE, open its
evidence. It is an unstarted PRD item and the single highest-leverage asset for a GitHub
page. Record it from the real stack. GIF under ~8 MB, MP4 for anything longer. Capture from
the final build, after Phase 6.

---

## Phase 4 — The GitHub page

### 4.1 README rebuild

Hero + one-line pitch → CI / coverage / release / license badges → a real screenshot → the
problem in two sentences → **what actually works today** → architecture diagram → 60-second
quick start → the gate table → honest boundaries → documentation index → contributing → license.

Rules:

- **The capability table is generated** by a new script that parses the register's 6-cell
  rows (reuse the parsing logic in `scripts/capability-register.mjs`) and checked by
  `docs:check`. A README table that can disagree with the register is the defect class the
  ledger exists to prevent.
- The maturity block survives in a stronger form: instead of "local/sample implementation",
  it names the gates that back the claim and links the live ledger counts.
- Link `CONTRIBUTING.md` — the current documentation table omits it entirely — and keep
  `AGENTS.md` as the engineering handbook.
- Add the missing `apps/worker` row and the ~26 missing commands to the command table.
- The ASCII architecture diagram becomes one shared asset used by README and site.

### 4.2 Repository hygiene

Set the **description** (currently empty) and **topics**; social preview image
(`docs/assets/social.png`, 1280×640); `PULL_REQUEST_TEMPLATE.md` with a mandatory
"what the test failure looked like before the fix" field, the rule `CONTRIBUTING.md` insists
on and nothing currently enforces; `ISSUE_TEMPLATE/` with a bug form and a findings-row pickup
form matching the ledger's fields; `SECURITY.md` — the repo has a serious security posture and
no disclosure policy; `CODE_OF_CONDUCT.md`; a real Keep-a-Changelog built from `git log`
with `[1.0.0]` and `[0.9.0]` sections; `docs/README.md` as an index.

### 4.3 Reconcile the five stale issues

`#7` (P-62), `#8` (P-63), `#9` (P-72), `#11` (W-7), `#12` (F-6) all map to rows the ledger
records as **fixed**. Re-read each against the tree, then close with a comment naming the
commit and the evidence test — not silently. Rewrite tracking issue `#6` to the post-sweep
state, grouping the externally-blocked rows so a reader can see they are blocked on hardware,
not on neglect.

---

## Phase 5 — The website

### 5.1 `site/` — VitePress

Homepage (hero, screenshot, what it is, what actually works, quick start, live status) plus
Architecture, Getting started, Operations, Quality programme, and Contributing. Workspace
package `@automate/docs` with a `build` task turbo picks up.

### 5.2 Generated status pages — the differentiator

A generator (`scripts/docs-check.mjs` or a sibling) reads `findings-ledger.json`,
`findings-status.json`, `capability-register.md`, and `coverage-baseline.json`, and emits
Markdown the site renders:

- **`/quality/findings`** — every row with band, status, provenance, evidence path.
- **`/quality/coverage`** — per-package floors and real measured numbers.
- **`/capabilities`** — the register, with its `real / mock / deferred / obsolete` vocabulary
  defined on the page rather than assumed.

This is what a standout project does and nothing here does: **the site cannot claim more
than the gates prove**, because the claims are generated from machine-checked sources. It
also turns the repo's most distinctive asset from a JSON file into something a visitor reads.

### 5.3 `docs:check` — the drift gate (also closes RF-12)

Plain dependency-free `.mjs` under `scripts/`, JSDoc-typed per the gate-script convention.
Fails when:

- a generated page is stale;
- a capability claim has no executable command behind it (RF-12's durable fix — it already
  has live targets: `AGENTS.md:131`, `unified-repository-migration.md:67,1086,1215`);
- the README's generated capability table differs from the register.

Wiring, all mandatory or a test goes red:

- `package.json`: add `docs:check`.
- `scripts/gate-tooling.json`: `tiers["docs:check"]` — `gate-tooling.test.mjs:332` requires
  a tier for **every** root script. No `scripts` row is needed if it requires no binary.
- `verify` line 50: add the step. 13 → 14, budget 20.
- `.github/workflows/unified-ci.yml`: add to the `quality` job (`timeout-minutes: 20`,
  plenty of headroom), and never set `E2E_ALLOW_IN_MEMORY`.

### 5.4 Pages workflow

`.github/workflows/pages.yml`: build on push to `main` and on tags; upload
`site/.vitepress/dist` via `actions/configure-pages` + `actions/upload-pages-artifact` +
`actions/deploy-pages`, all SHA-pinned, with `timeout-minutes` and a top-level `concurrency`
— `gate-tooling.test.mjs` enforces all three and fails without them. The job must also run
in the PR build check so a broken site is caught before merge. Add `.nojekyll` and set `base`
correctly for a project page. Keep `dist/` git-ignored; the existing `dist/` rule is what
keeps minified output out of the secret scan and the preflight's generated-path check.

---

## Phase 6 — Final gate and claim

1. `pnpm verify:local` green on this host; `pnpm verify` green in CI with scanners installed.
2. `pnpm test:e2e` green against a real PostgreSQL.
3. `pnpm findings:check` green; the open count is the post-sweep number and every survivor
   has a written disposition.
4. `pnpm coverage:ratchet` green with floors **raised or unchanged**, never lowered.
5. `pnpm docs:check` green; generated pages match their sources.
6. Every claim in README and site names the gate or command that proves it.
7. Screenshots and the demo regenerated from the final build.
8. Stale issues closed with evidence; `#6` reflects reality.
9. Tag `v1.0.0` and publish the CHANGELOG.

---

## Risks

**R1 — the shared file.** Six rows plus C-4 want `drizzle-execution-store.ts`, and two
fixes are incompatible in the wrong order. Sequence 1a as written, land C-4 last.

**R2 — one line of web coverage.** W-5 was already written and withdrawn for this. Every
web fix writes its test first, in the same commit.

**R3 — `verify` budget.** 13 → 14 against 20. Anything further goes nightly.

**R4 — the site is a new surface.** `eslint`, `prettier`, and `jscpd` pick `site/` up
automatically; the complexity gate, coverage ratchet, and semgrep scope check do not, and
Phase 0.2 handles that deliberately. A `scripts/` generator tripping the complexity ceiling
of 15 fails `security:verify` on offender count — keep the generator small and split it.

**R5 — screenshots are a lie waiting to happen.** Capture from the real stack against a
real PostgreSQL, and caption any `mock` screen as mock.

**R6 — scope.** Six phases, and Phase 2 is the largest. If it must be cut, cut 2.4 (chat) and
3.4 (demo) — not the sweep, not the quick start, not the README. The claim is worth more
than the feature.

**R7 — the tenancy finding.** If `workspaces` turns out to be unenforced, that is a security
defect in the system's only stated tenancy boundary, and it should jump the queue.

---

## Out of scope

- Closing `PERF-1`, `RF-9`, `G-4b`, `D-4` — reference hardware, another branch, another OS.
  Dispositions, not closures.
- Multi-instance SSE durability and production cutover — gated on the RF-5 rehearsal, which
  needs a second real database.
- Dropping dormant tables (C-6 is justification-only, per decision).
- A web UI for chat (2.4 is API-only, per decision).
- Versioned docs and a blog on the site.

## Open questions for the implementer

1. **The tool-sdk member set.** Read `packages/reporter/src/adapter.ts` and
   `packages/automation/src/ai-gateway.ts` first — those are the house pattern. If a member
   does not obviously serve Playwright *and* the four bounded adapters, leave it out and
   record the open question in the ledger rather than speculating.
2. **Demo format.** GIF under ~8 MB for inline GitHub rendering, MP4 for anything longer.
   Decide when the capture exists, not now.
3. **Chat persistence.** Decide whether `POST /api/v1/chat/stream` writes to the existing
   `conversations`/`messages` tables or is stateless. The tables are already
   workspace-scoped, so writing is the smaller change; stateless is the smaller risk. This
   changes X-4's closure, so decide it before the route lands, not after.
