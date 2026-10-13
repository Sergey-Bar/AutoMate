# QA Copilot Command Center — product spec and implementation plan

Extend **Automate** (`package.json:6` — "AI-Orchestrated QA Platform") from a self-hosted
single-repo gate runner into a multi-repo QA command center: a terminal client, a generic
run engine for arbitrary customer repositories, a derived QA Health Score, a command-center
dashboard, and an AI copilot that proposes actions with evidence.

This file is both the product specification (sections 1–6) and the implementation plan
(decisions, task list, validation, risks, open questions).

---

## Context — what already exists, and what does not

Cross-checked against the tree, not assumed.

| Requirement | Existing surface | Gap |
| --- | --- | --- |
| Run execution | `apps/runner` (Playwright-specific), `apps/worker` lease loop, `RUN_PHASES` (`packages/db/src/schema/dashboard.ts:29`) | No generic command spawn, no foreign repo support |
| Result ingest | `packages/reporter` with `junit-xml` + `playwright-json` adapters, `ProducerContext.projectId?` (`packages/reporter/src/adapter.ts:16`) | No k6 / ZAP / coverage adapters; `projectId` is a dangling column |
| Progress | `runs.total/passed/failed/flaky/skipped/blocked/unknown`, `phase`, `outcome` | No per-test streaming to a client; `packages/realtime` SSE exists but the TUI does not |
| Analytics | `apps/web/src/routes/dashboard/analytics.tsx`, `run-detail.tsx`, `quarantine.tsx` | No cross-project rollup, no score |
| Multi-tenancy | `WORKSPACE_ID` only; `users`/`roles`/`api_keys` dormant "because the install is open; there is no login" (`docs/quality/capability-justification.md:68`) | No project registry — `runs.project_id` has no table |
| Terminal | none — no `ink`, `blessed`, `commander`, or `prompts` anywhere | `apps/tui` does not exist |
| AI | `apps/api/src/routes/chat.ts`, `routes/agents.ts`, `packages/automation` gateway ports, `shared-contracts/schemas/ai.ts` | Nothing consumes run/score state |

**The seam that makes this cheap:** `runs.project_id` (`dashboard.ts:165`) already exists and
is indexed. This plan adds the missing `projects` table rather than inventing a concept.

---

## Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | Extend Automate in place; it becomes the multi-repo product | Avoids a second authority for scores that `coverage:ratchet` and `performance-gate` already own |
| D2 | Execution is a **host-side rootless child process**, leased from `apps/worker`, per-project workspace dir | Same posture as today's runner; no image resolution, no container runtime, works offline |
| D3 | `apps/tui` is a thin typed client over the existing HTTP API + SSE | Every screen is backed by a route the web tests already cover; a contract break fails typecheck in both clients |
| D4 | Health Score is a **derived view, never a persisted number** | A stored total is a fourth blocking number that must agree with the coverage floor, the perf threshold, and the gate tier |
| D5 | Single-operator, N projects. No login, no per-user credentials | Multi-tenant is a separate product; the install stays closed and secrets stay on the host |
| D6 | v1 detection matrix is **8 ecosystems wide**; artifact ingestion is one **universal JUnit-XML path** + 2 rich native adapters | This is the only reading of "broad multi-language in v1" that ships. 8 bespoke native adapters is ~4x the surface before anything user-visible works. Flagged as OQ1 |
| D7 | **No raw shell passthrough.** The terminal exposes a typed command registry | A terminal that runs arbitrary strings in a multi-repo install is an RCE surface for whoever holds it (see R1) |
| D8 | Detection **never installs anything**. The first run tells the operator the install command | `npm install` inside a customer's tree is a supply-chain action the operator did not ask for |
| D9 | Stdout is **evidence, never results**. Results come only from declared artifacts | A regex over a child's stdout is a second parser to drift; JUnit is already parsed and tested |

---

## 1. Core functionality and terminal interface

### 1.1 Package

New `apps/tui` (Node 24, ESM, strict TS), Ink added to the pnpm catalog with a `catalog:`
specifier like every other shared dep. Sibling of `apps/web`, not a fork of it.

It is a **client only**: HTTP for commands and queries, the `packages/realtime` SSE stream
for run progress, Zod schemas from `packages/shared-contracts` for every payload. It holds
no database handle and no filesystem handle. If the TUI can do something the dashboard
cannot, that is a bug in the API, not a feature of the TUI.

### 1.2 Command registry, not a shell

`packages/shared-contracts/src/schemas/tui-commands.ts` declares every verb as a
discriminated union: `{ verb, params }` → `{ ok, result | error }`. Verbs for v1:

| Verb | Effect |
| --- | --- |
| `project.list`, `project.add`, `project.rescan`, `project.profile` | Registry and detection |
| `run.start`, `run.stop`, `run.list`, `run.tail` | One-click Play/Stop |
| `score.get`, `score.diff` | Derived score and input-level attribution |
| `report.<name>` | §4 reports, all of which are projections of stored rows |
| `triage.quarantine`, `triage.reinstate` | Existing `quarantine` table |
| `copilot.ask` | §5, over the existing agent/chat route |

An operator wanting a command not in the registry adds it here and to the API. An
`exec.raw` escape hatch is **not** in v1 (OQ2).

### 1.3 Screens

`projects` (registry + score per project) → `project` (matrix, pyramid, risk queue,
provenance) → `run` (live) → `report:<name>`. A command palette (`:`) is the only input
surface; a keybinding is an alias for a verb, never a second code path.

### 1.4 Play / Stop and real progress

**Progress is a phase ladder plus counters — never stdout parsing (D9).**

`RUN_PHASES` is already the right ladder: `queued → assigned → preparing → running →
collecting → normalizing → analyzing → gate_evaluation → complete`, with `cancelled`,
`timed_out`, `runner_lost`, `infra_failed`, `config_failed`, `partial` as the failure
shapes. The bar renders:

- **Determinate phase** (9 phases) from the SSE `run.phase` event — index over the ladder.
- **Within-phase counts** from `runs.total/passed/failed/flaky/skipped`, which the
  reporter pipeline already maintains. Before `collecting` the count is 0 and the bar is
  an **indeterminate spinner**, and says so. A progress bar that invents a percentage for
  a phase that cannot have one is the single most common lie in this product category.
- **Per-test rows** once `collecting` starts, streamed as canonical results land.
- **Terminal failure phases get a named cause**, not a red bar: `runner_lost` renders
  "runner lost", not "0/412".

**Stop** is `run.stop` → lease release → SIGTERM, then SIGKILL after a grace window →
run lands in `cancelled`, and partial results are **kept**. A cancelled Playwright run
still tells you which 38 tests had already passed; discarding that is throwing away the
most expensive thing the run produced.

### 1.5 Tasks

1. `apps/tui` package: `package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`,
   `ink` + `react` in the catalog, entry `src/main.tsx`, one smoke test per screen.
2. `tui-commands.ts` in shared-contracts + a `index.test.ts` that round-trips every verb.
3. `commands/` — one module per verb, each a thin `fetch` + Zod parse, no logic.
4. `useRunStream` — SSE with the existing reconnect logic from `packages/realtime/src/reconnect.ts`.
5. `components/` — `PhaseBar`, `CounterGrid`, `TestTable`, `ScoreMatrix`, `PyramidChart`,
   `RiskQueue`, `CommandPalette`. No component reads a store other than the hook above.
6. Keybindings: `space` play/stop, `1-5` jump to category, `q` quit, `:` palette. Document
   them in the TUI's own `--help` and on the projects screen footer.

---

## 2. Deep repository integration and analysis

### 2.1 Detection

`packages/projects/src/detect/` — a pure function, `(repoRoot) => DetectedProject`, no I/O
beyond reading manifests. v1 matrix:

| Ecosystem | Manifests read | Framework signals | Coverage format |
| --- | --- | --- | --- |
| Node | `package.json`, lockfile (pnpm/npm/yarn/bun) | `scripts.test*`, deps: vitest, jest, mocha, playwright, cypress, ava, node:test | lcov, cobertura, Istanbul JSON |
| Python | `pyproject.toml`, `requirements*.txt`, `setup.cfg`, `tox.ini` | pytest, unittest, nose, playwright-python, locust | coverage.py, cobertura |
| Java | `pom.xml`, `build.gradle(.kts)` | surefire, failsafe, testng, junit5 | jacoco (xml) |
| .NET | `*.sln`, `*.csproj` | xunit, nunit, mstest | cobertura, coverlet |
| Go | `go.mod` | `go test` | `go test -coverprofile` |
| Ruby | `Gemfile`, `*.gemspec` | rspec, minitest | simplecov |
| Rust | `Cargo.toml` | `cargo test`, nextest | llvm-cov |
| PHP | `composer.json` | phpunit, pest | clover |

Each ecosystem contributes: `language`, `packageManager`, `frameworks[]`, `candidateCommands[]`
(with an evidence path per candidate), `artifactGlobs[]`, `coverageFormats[]`, `confidence`,
`detectorVersion`.

**The output is a proposal, never the authority (D8 + `no-second-authority`).** Detection
writes a `ProjectProfile` onto the `projects` row. A checked-in `automate.config.json` in the
customer repo **overrides** it, and the run uses the override. The UI shows
"detected: `pnpm test` — use this / override", and the override is recorded in `runs.configuration`
so a run can always be explained.

Detection is versioned and its version is stored on the profile. A profile with
`detectorVersion` 2 is never silently read as version 1.

### 2.2 Execution

```
run.start → lease (apps/worker) → apps/runner generic mode
  → mkdir <workspaceRoot>/<projectId>/<runId>
  → spawn(detected-or-declared command, { cwd: repoRoot, env: scrubbedEnv, detached: false })
  → stdout/stderr tee'd to <runDir>/combined.log  (evidence, D9)
  → poll declared artifactGlobs for expected artifacts, bounded by runs.timeoutMs
  → hand artifacts to packages/reporter adapters with a full ProducerContext
  → canonical_run_results; runs.total/passed/failed/flaky updated; phase advances
  → score recomputed (derived, D4)
```

- **Scrubbed env**: pass through a named allowlist (`PATH`, `HOME`, `CI`, plus project-declared
  keys). Everything else is dropped. A customer test process must not inherit the install's
  `DATABASE_URL` or `INSTALLATION_SECRET`.
- **Workspace root** is configurable, defaults to a path outside the install; the run directory
  is deleted after artifact upload, keeping only the log and the canonical results.
- **Log retention** lands on the existing `readAt` evidence column on `runs`, not a new table.
- **`infra_failed` vs `failed`**: a run that died for non-test reasons lands in `infra_failed`
  and is **excluded from the score's pass rate**. Mixing the two is how a QA dashboard starts
  lying about a team, and it is the most common defect in this product category.

### 2.3 Tasks

7. `packages/db` migration: `projects` table (id, workspace_id, name, repo_path, profile jsonb,
   detector_version, created_at, updated_at) + FK from `runs.project_id`; add it to
   `tests/integration/src/migrations.test.ts` column assertions and to the migration graph.
8. `packages/projects` package: `detect/` (8 ecosystems), `profile.ts`, `config.ts` (override merge).
9. Extend `quality_gate_config` semantics per project rather than adding a thresholds table —
   the table is already read and written; per-project scoping is a column.
10. `apps/runner`: `generic` execution mode alongside the Playwright mode. One protocol, two
    spawn strategies — the Playwright path must keep passing unchanged (regression proof).
11. `run.stop`: SIGTERM → grace → SIGKILL, partial results preserved, phase `cancelled`.
12. `packages/reporter` adapters: `k6-json`, `zap-xml`, `coverage-lcov`, `coverage-cobertura`,
    `coverage-istanbul`, `coverage-py`. JUnit-XML dialects (Gradle, Maven surefire, NUnit,
    phpunit, RSpec, gotestsum) as fixtures against the **existing** adapter, not new code.
13. `scripts/lib/findings-ledger.mjs` untouched; no new dormant table. If a proposed table has no
    reader by the end of the wave, it does not ship — that is the rule
    `docs/quality/capability-justification.md` exists to enforce.

---

## 3. Advanced analytics and the QA Health Score

### 3.1 The matrix

**Categories (rows, 5 required):** unit, integration, e2e, performance, security.
**Surfaces (columns, 3):** backend, frontend, platform (unattributable, or spanning both).

15 cells. "Backend score" and "frontend score" are the column rollups you asked for; the
category rollups are the row rollups. Project config may mark a cell `n/a`, which excludes it
and renormalises weights — **without this a frontend-only repo scores 0 forever**, which is the
single fastest way to lose a user's trust in the number.

### 3.2 Cell sub-score

Each cell is in `[0,1]`, from four components:

- **presence `P`** — `1` iff a suite for that cell completed at least one successful run in the
  window. Multiplicative: an absent category is `0`, not a small number.
- **depth `D`** — `0.5 · min(1, executedTests / targetTests) + 0.5 · min(1, surfaceCoverage / coverageTarget)`.
  Both targets come from the project config, which is the authority.
- **stability `S`** — `1 − flakeRate` (definitions below).
- **signal `Q`** — mean per-test value score; hollow tests contribute `0`.

```
cell = P · (0.4·D + 0.4·S + 0.2·Q)
```

Weights are project config, not constants in code.

### 3.3 The general score — a weighted geometric mean

```
score = 100 · Π sᵢ^(wᵢ)      over included rows, Σwᵢ = 1
```

Rows are the 5 category scores plus a 6th, `pyramid-shape`, default weight `0.10` with the
others rescaled to `0.90/5` each.

**Geometric, not arithmetic, and this is the load-bearing choice of the whole section.** An
arithmetic mean lets five perfect categories average away a Security score of `0` and print
`78/100` next to a repository with no security testing at all. A geometric mean cannot
dilute a zero, which is the behaviour that makes the number worth defending in a review.

The cost of that choice is that the number alone is undiagnosable, so **the UI must always
render the capping cell** — "62 · capped by Security (0)". A geometric score without its
limiting term is a worse lie than an arithmetic one.

### 3.4 Pyramid shape

Observed share vector `(unit, integration, e2e)` over executed tests, against a per-project
target (default `0.70 / 0.20 / 0.10`).

```
pyramid = 1 − min(1, ½ · ‖observed − target‖₁)
```

Reported as a **shape**, not a gate, by default. A pyramid target is a heuristic borrowed from
one blog post, and a gate built on it will be gamed by writing unit tests for their own
sake — which raises the score while lowering the value of the suite. The dashboard shows drift
over releases; only a project that opts in gets it as a threshold.

### 3.5 Metrics: passing, failing, hollow, structural

**Outcome** — `passRate`, `failRate`, `skipRate`, `blockedRate`, `flakeRate`, `unknownRate`.
`infraFailedRate` is reported **separately** and never folded into `failRate`.

**Flaky**, two definitions because they mean different things:
- *strong* — same `fingerprint` and same `commitSha`, different outcome. Unambiguous.
- *weak* — ≥3 outcome flips across the last 10 runs of one fingerprint regardless of commit.

A test is quarantined only on *strong* evidence or operator action. Guessing wrong here
hides a real defect, and a hidden defect is the one failure mode this product cannot have.

**Hollow** — passing, contributing nothing. Any of:
- zero assertions **and** zero snapshots **and** no `rejects`/`toThrow` expectation;
- 30 consecutive passes on a test whose assertions are all `expect(true)`/`assert.ok(true)`;
- median duration < 50 ms with no network, file, or DB interaction in the trace.

**Structural** — the highest-value signal in the product, and the one nobody ships:
- *green but empty*: `presence = 1` and `depth = 0` — a suite exists, runs, passes, covers nothing.
- *uncovered surface*: a module with zero tests in any category.
- *single-layer dependency*: an E2E suite that asserts what a unit test should assert, so the
  fast feedback loop is missing and the suite is slow for no coverage gain.
- *dominant-cell*: >80% of a category's tests in one cell, which usually means the matrix is
  fiction.

### 3.6 Authority

`score(projectId, at)` is a **pure function** in `packages/projects/src/score/`, reading
`canonical_run_results`, coverage artifacts, `projects.profile`, `quality_gate_config`, and
`known_failures`. There is **no `health_scores` table** in v1 (D4).

A materialised `health_snapshots` cache is permitted later **only** with a provenance column
recording the exact inputs it read, and only if deleting the table changes no gate and no
verdict. `docs/quality/docs-drift.mjs` and the ledger ratchet are the pattern to copy.

Component tests are the proof: for a hand-built fixture project, each sub-score is asserted
against a value computed by hand, and the geometric-mean property is asserted — *a zero in any
row forces the total to zero*. That test is the reason to trust the number.

### 3.7 Tasks

14. `packages/projects/src/score/`: `cell.ts`, `geometric.ts`, `pyramid.ts`, `flaky.ts`,
    `hollow.ts`, `structural.ts`, `index.ts` (`score(projectId, at)`). Pure, no I/O beyond the
    repository port.
15. Contracts: `qa-score.ts` — `QaScore`, `ScoreCell`, `ScoreProvenance`, `Gap`, each cell
    carrying its own inputs so a score can always be explained without re-running the function.
16. Tests first, red-first per `AGENTS.md` / `CONTRIBUTING.md`: write `geometric.test.ts`,
    run it against an arithmetic implementation, watch it fail for the dilution reason, then fix.

---

## 4. Dashboard and reporting

`apps/web`, extending the existing `dashboard/` route family. Five zones:

1. **Verdict bar** — general score, the capping cell, backend and frontend scores, gate state.
2. **Category matrix** — 6×3 heatmap, cell = value, opacity = inputs, click = provenance.
3. **Live run strip** — active runs, phase ladder, Stop.
4. **Risk queue** — flaky, hollow, structural, ranked by `score impact ÷ remediation effort`.
5. **Provenance** — detector version, adapter version, config hash, commit, workspace.

Reports, each with a verb that acts on it:

| Report | Answers | Act |
| --- | --- | --- |
| Automation gap | Which missing category, and the cheapest suite that closes it | `run.start` a scaffold |
| Flaky inventory | Which fingerprints flip, and at what cost in CI minutes | `triage.quarantine` |
| Hollow tests | What passes without proving anything | open in editor, or quarantine |
| Pyramid drift | How the shape moved release over release | — |
| Suite-to-source map | Which modules nothing touches | `copilot.ask` for a draft suite |
| Score provenance diff | **Not** "the score fell 4 points" but "Security `D` fell because 3 target files gained no coverage after commit `abc`" | — |

That last row is the product. A score with no attribution is a mood ring.

Task 17: `apps/web/src/routes/dashboard/score.tsx`, `gaps.tsx`, `hollow.tsx`, `flaky.tsx`, each
with a colocated test, consuming the §3 contracts through the existing `src/lib/api.ts` wrapper.

---

## 5. AI copilot intelligence

Reuses `apps/api/src/routes/chat.ts`, `routes/agents.ts`, and `packages/automation`. The copilot
is a **client of the score, never its author** — D4 depends on this.

**Hard rule: a recommendation that cannot cite a row does not render.** Every suggestion carries
at least one evidence pointer (a fingerprint, a run id, a project config key, a file path). No
evidence, no suggestion. This is the `capability-evidence` skill applied to the product rather
than to its own repository.

Six capabilities, deterministic-first:

1. **Propose a detection override** — "your `pom.xml` runs surefire, not failsafe; integration
   tests are being collected as unit tests. Add `mvn verify`?" Evidence: the parsed manifest.
2. **Rank gaps by cheapest closure** — the score computes the delta; the model writes the suite
   shape that reaches it. Numbers from the score, prose from the model.
3. **Explain a delta** — read `ScoreProvenance` and narrate it. Deterministic when the diff is
   a single input; the model only when several inputs moved at once.
4. **Propose quarantine** — with the strong/weak flaky evidence attached, and a stated
   consequence. Never auto-quarantine: a wrongly hidden defect is unrecoverable.
5. **Draft a regression suite** from a failure cluster, as a proposal into the customer's repo —
   never merged.
6. **Translate** — a non-technical stakeholder asks why the score is 62; the answer cites cells,
   not adjectives.

Anti-goal, stated because it is the default failure of AI QA tooling: **no chat that reports
numbers the score function did not produce.** Every figure in a copilot answer is traceable to
a contract field.

Task 18: `apps/api/src/routes/copilot.ts` — one route, one tool per capability, each tool
returning `{ suggestion, evidence[] }` with `evidence` required by the Zod schema.
Task 19: an adversarial test that a suggestion with an empty `evidence` array is rejected at the
schema, not merely unrendered in the UI.

---

## 6. Roadmap

Waves, each with an exit criterion and a gate tier. No time estimates.

| Wave | Content | Exit criterion |
| --- | --- | --- |
| **W0** Registry | `projects` table, migration, `packages/projects`, 8-ecosystem detector, config override | A fixture repo per ecosystem detects a language, a framework, and a candidate command; `pnpm db:check` and `db:migrate` green |
| **W1** Run engine | Generic spawn in `apps/runner`, scrubbed env, phase ladder, `run.stop`, partial-result retention | A fixture suite runs, stops mid-run, keeps its partial results, and the Playwright path is unregressed |
| **W2** Ingest | k6, ZAP, 4 coverage adapters, JUnit dialect fixtures | Every adapter has a red-first test against a real-world sample artifact; `adapter-parity.test.ts` extended |
| **W3** Score | `packages/projects/src/score`, contracts, no UI | Hand-computed fixtures agree; the zero-dilution test fails against an arithmetic mean and passes against the geometric one |
| **W4** TUI | `apps/tui`, command registry, phase bar, live stream | Every verb has a test; Stop works from the keyboard mid-run; a contract change fails typecheck in **both** clients |
| **W5** Command center | `apps/web` score, matrix, gap, hollow, flaky, provenance diff | Each report names the rows it read |
| **W6** Copilot | `copilot.ts`, 6 capabilities, evidence schema | The empty-evidence test is red before the schema exists and green after |
| **W7** Breadth | Live-repo dogfood on 3 real non-Node repos; detector tuning | W0–W6 exit criteria hold against repositories nobody wrote the fixtures for |

**Deferred, deliberately:** multi-user auth, cloud hosting, container isolation, native adapters
for the 6 non-Node ecosystems beyond JUnit, and the natural-language query UI (`nl_query_history`
stays dormant until someone writes the reader).

---

## Execution order

Tasks 1–19 above, in that order, are the ordered list. Hard dependencies:

- **W0 gates W1** (nothing to run without a project).
- **W3 gates W5** (a UI over an unauthoritative number is worse than no UI).
- **W2 gates W3's stability and depth components** (flake and coverage need real artifacts).
- **W4 is parallel to W5** after W3 — and is the reason W3 is a contract, not a UI.

Repo obligations for every wave:

- `scripts/gate-tooling.json`: add a `tui` row (tier `never-in-ci`; no external binary, so no
  CI install change and no `gate-tooling.test.mjs` failure). Verify `verify` stays ≤20 steps.
- `coverage:baseline` records a **measured** floor for `apps/tui` and `packages/projects` — never
  a hand-written one. `pnpm test:coverage` then `coverage:ratchet`.
- `docs/quality/coverage-exclusions.md` gains no rows for this work. A detector branch that
  cannot be reached is a test gap, not an exclusion.
- `docs/quality/findings-ledger.json`: any defect found while building is a `hand` row with
  `confirmed: true`. A `sweep` row cannot be closed.
- `docs:capability-register` regenerated in the same PR that changes the register.
- Red-first per `AGENTS.md`: write the test, run it with the defect present, watch it fail for
  the expected reason, then fix. `CONTRIBUTING.md` records three occasions a fully green suite
  was checking the wrong thing.
- Commit this plan. `.kilo/plans/` is the one tracked planning system and 17 of its 18 files
  are currently untracked.

## Validation

| Check | Command |
| --- | --- |
| Types, both clients | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Unit | `pnpm --filter @automate/projects test`, `pnpm --filter @automate/tui test` |
| Runner regression | `pnpm test:runner` — the Playwright path must be untouched |
| Migration graph | `pnpm migrate:validate`, `pnpm db:check` |
| Ledger + docs | `pnpm findings:check`, `pnpm docs:check` |
| Gate wiring | `pnpm verify` |
| Manual | Add a repo, Play, Stop mid-run, confirm partial results survive and the score drops by the expected cell |

End-to-end acceptance: register a real repository, let detection propose a command, override
it, run, stop, restart, and read a score whose every cell is traceable to a row — with the
capping cell named.

## Risks

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | **RCE.** D2 + D7 execute customer code with the operator's identity | Rootless, scrubbed env, no raw shell, registry-only verbs, workspace outside the install, log retained as evidence. Container isolation is the W8+ answer if a customer demands it |
| R2 | **Score credibility collapse.** One wrong number and nobody trusts the product | Geometric mean with the capping cell always visible; `n/a` cells; score never blocks anything in v1; provenance diff ships in the same wave as the score, not after |
| R3 | **8-ecosystem detection is read-and-guess.** Wrong `candidateCommands` waste operator time | Detection is a proposal, the override wins, confidence is shown, and every candidate carries the manifest line that produced it |
| R4 | **JUnit dialect sprawl.** 6 ecosystems × divergent XML | One adapter, dialect fixtures, and an explicit `unsupported` path — not six new adapters |
| R5 | **TUI duplicates the dashboard** | The command registry lives in shared-contracts and the API is the only implementation; a TUI-only capability is an API bug |
| R6 | **29 dormant tables and we add three** | The `projects` table ships with readers in the same wave. Any table without a reader by wave end does not ship |

## Open questions

1. **OQ1** — D6 interprets "broad multi-language in v1" as a wide detection matrix over a
   universal ingest path. If you want rich native adapters (mutation scores, per-assertion
   detail) for all 8 ecosystems in v1, say so: that is a materially larger plan and I would
   re-scope W2.
2. **OQ2** — Do you want an `exec.raw` escape hatch for unregistered commands? My
   recommendation is no in v1, and if yes, it must be config-gated, audit-logged to
   `audit_events` (which today has four writers and zero readers — R5 in
   `capability-justification.md:32`), and never reachable from a report's action button.
3. **OQ3** — Should the TUI ship before the web command center? I sequenced W4 before W5 because
   the registry is cheaper to build in one client than to retrofit into two.
4. **OQ4** — Persisted score history for trending. I recommend against it in v1 (D4). If the
   trend chart is a launch requirement, it becomes a materialised cache with provenance, added
   in W5 rather than W3.
