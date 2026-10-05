---
name: gate-tiering
description: 'Use when adding or changing any gate, script, CI job, or workflow in this repository — including a new pnpm script, a new binary requirement, a tier change, a baseline writer, or a job addition. Enforces scripts/gate-tooling.json and scripts/lib/gate-tooling.test.mjs: every script has a tier, every tool is installed by the job that needs it, every job has a timeout, every workflow has concurrency, and verify stays inside its 20-step budget.'
---

# Adding a gate without breaking CI

This repository has a recorded history of gates that were red **by construction**. Four of the nine jobs in `unified-ci.yml` failed on their first step for the whole history of the repo — four failures stacked on one `install` line, each hiding the next — because they ran `pnpm security:verify` with no `semgrep` and no `gitleaks`. `test:performance` was wired into no workflow at all, so it had never run.

`scripts/gate-tooling.json` exists so that class of mistake is a **failing test** rather than a permanently red job.

## Every change needs three things

### 1. A tier in `scripts/gate-tooling.json`

Every root script carries a tier. `scripts/lib/gate-tooling.test.mjs` fails if a script has none.

| Tier | Meaning |
|---|---|
| `pr-blocking` | A red job stops the merge. |
| `pr-reporting` | Runs on every PR, uploads its report, blocks nothing. |
| `nightly` | Too slow, too flaky, or needs a database a PR does not have. |
| `release` | `verify:release` only. |
| `never-in-ci` | Deliberately run by hand. |

### 2. The external binary it needs, and who installs it

`"requires": ["semgrep", "gitleaks"]` plus `"installedBy": ".github/actions/install-scanners"`. Use `a|b` for either/or (`"docker|podman"`). Mark a tool the runner image already ships with `"preinstalledInJobImage": true`, which is why `oci:build` needs no install step.

If your script is dependency-free, say so: `"requires": []` with a `why` sentence. That sentence is what stops someone re-adding a dependency later — `findings:check` records its own reason as *"deliberately so: the ledger gate is the one that must never be the step that cannot run."*

### 3. `timeout-minutes` and `concurrency`

Every job needs a `timeout-minutes`. Every workflow needs a `concurrency` block. Both are enforced by the test.

## Choosing a tier honestly

**A required check that can never pass blocks every pull request and teaches reviewers to read red as noise.** That is the reason two gates are deliberately weaker than you would guess:

- **`security:static` is `pr-reporting`** with 543 blocking findings recorded per rule as SEM-2. It ran for the first time on 2026-09-30 and reported 1137 findings; one structurally broken rule accounted for ~1100 and is fixed, leaving 543 across six rules, 464 from `no-hardcoded-secret-literal`. The remedy for a security gate is **not** to stop running it — the job still runs and the tier still reports, and SEM-2 states the number. What changes is that the number is visible instead of hypothetical. Graduation condition: zero blocking findings, with the triage recorded per rule.
- **`test:render` is `pr-reporting`** because `performance/rendering-budget.json` has no recorded run, so the job measures four routes and compares nothing. See `perf-baseline` below.
- **`test:e2e` is `pr-reporting`** until the last two of nineteen cases pass, named with their causes in E2E-3.
- **`review:pr` is `pr-reporting`** because its ledger half fails today: RF-5 is an open Blocker.

**Graduating is one commit with two parts.** Record the real run *and* raise the tier. For `test:render`, `scripts/lib/render-gate-phase.mjs` derives the permitted tier from the data and `gate-tooling.test.mjs` fails until the manifest agrees **in both directions** — so `recorded: true` beside invented numbers cannot become a gate that is permanently green and unenforced.

## `never-in-ci` is a fifth value, not a compromise

It marks a script run by hand:

- `dev`, `db:migrate`, `db:generate`
- every `*:baseline` writer — `render:baseline`, `complexity:baseline`, `coverage:baseline`, `findings:baseline`, `docs:capability-register:baseline`
- `migrate:apply` — never in `verify` **and** never in a workflow. CI has no persistent database, so applying a migration there proves nothing about the migration and leaves a schema nobody keeps.
- `migrate:rehearse` — a rehearsal needs a live second database and CI has none. Running it there proves `pg_dump` is installed, which is not what D1 is for.

**A baseline writer in a workflow is how a gate starts agreeing with the tree instead of with the code.** That is why all five of them are hand-run.

## The budget

`verify` may grow from 15 to **at most 20 steps** (plan D6). Past that it goes nightly, and `gate-tooling.test.mjs` enforces the count. `test:render` is deliberately **not** in `verify`: it needs a browser and a database.

## The one permitted way around a scanner

On a host where the static scanners cannot run, `AUTOMATE_HOST_SCANNERS=unavailable` — set for you by `pnpm verify:local` — records `not_configured` and exits 0. The boundary is narrow and machine-checked by `scripts/lib/host-scanners.mjs`:

- a scanner that **ran** and reported something still fails, with or without the flag;
- a scanner **killed at the ceiling** counts as unavailable, never as clean, so a ten-minute stall cannot become a green security gate;
- `AUTOMATE_SCAN_TIMEOUT_MS` is clamped to [1 min, 1 h], because a ceiling small enough to guarantee a kill is the same defect by another route;
- **no file anywhere under `.github/` may set it**, composite actions included — `auditRepository` reports that as a finding.

Extending the opt-in is a change to `scripts/lib/host-scanners.mjs`, not to a workflow.

## `perf-baseline`-style graduation, for reference

When you record a real baseline, three things must move together or the gate is worse than no gate:

1. the numbers, committed and reviewed as a diff;
2. the tier, raised in the **same commit**;
3. the rule that derives the tier, which must agree in both directions.

A GitHub runner is not the reference hardware — the ceilings describe a self-hosted single-node install (D10), which is why `pnpm render:baseline` has to run there.

## Checklist for a new gate

- [ ] `pnpm` script exists in `package.json`
- [ ] a tier in `scripts/gate-tooling.json` → `tiers`
- [ ] `requires` and `installedBy` if it needs a binary, with a `why` sentence
- [ ] the job installs every tool it requires, or the job is red by construction
- [ ] the job has `timeout-minutes`; the workflow has `concurrency`
- [ ] the tier matches whether the gate can actually pass today
- [ ] if it is a baseline writer, it is `never-in-ci`
- [ ] `verify` is still within 20 steps
- [ ] `pnpm gate-tooling` — or the test behind it — passes

```bash
pnpm review:rules
pnpm test:integration
```