---
description: 'Decide which gate applies to a change and whether that gate can actually pass today. Prints each gate tier and its required tools from gate-tooling.json.'
---

# Which gate does this change need, and can it pass?

For `$ARGUMENTS`. The failure this prevents is the one this repository already recorded: **four jobs in `unified-ci.yml` were red by construction**, running `pnpm security:verify` with no `semgrep` and no `gitleaks`, stacked on one `install` line so each failure hid the next.

Load the `gate-tiering` skill. `scripts/gate-tooling.json` is the authority for every tier and every required binary; never answer a tier question from prose.

## 1. What kind of change is this?

| The change touches | The gates that decide it |
|---|---|
| `packages/db` schema or a migration | `db:check`, `migrate:validate`, `tenancy:check` |
| `apps/api` routes or services | `test`, `coverage:ratchet` |
| `apps/web` components | `test`, `test:render` (reporting only) |
| `scripts/**` or `package.json` scripts | `review:rules`, `lint`, `typecheck` |
| `.github/workflows/**` | `review:rules` — every job needs `timeout-minutes`, every workflow needs `concurrency` |
| `docs/**`, `AGENTS.md`, a persona, a `SKILL.md` | `docs:check`, `skill-scan` |
| `docs/quality/findings-ledger.json` | `findings:check` |
| a schema contract in `shared-contracts` | `test:contract` |

## 2. Report each gate's tier, and say whether it can pass today

This is the part worth doing carefully. Read the tier from `scripts/gate-tooling.json` and state it plainly:

- **`pr-blocking`** — a red job stops the merge.
- **`pr-reporting`** — it runs and uploads a report, and blocks nothing.
- **`nightly`**, **`release`**, **`never-in-ci`** — hand-run or scheduled.

Then say whether it can be green as things stand. Four are deliberately weaker than you would guess, and reporting any of them as a passing check would be a false statement:

- `security:static` — `pr-reporting`, 543 blocking findings recorded per rule as SEM-2.
- `test:render` — `pr-reporting`, because `performance/rendering-budget.json` has no recorded run, so it measures four routes and compares nothing.
- `test:e2e` — `pr-reporting` until the last of nineteen cases pass.
- `review:pr` — `pr-reporting` because its ledger half fails today: RF-5 is an open Blocker.

**A gate that has never been observed green must not be described as a check this change passes.** It is a harness with no evidence behind it.

## 3. If the change adds a gate or a script

Adding a gate is a two-sided edit, and the `gate-tooling.test.mjs` failure tells you which side you forgot:

1. a tier in `scripts/gate-tooling.json` → `tiers`
2. `requires`, and `installedBy` if it needs a binary — or `requires: []` with a `why` sentence
3. the job installs every tool it requires, or the job is red by construction
4. `timeout-minutes` on the job, `concurrency` on the workflow
5. `verify` still within its 20-step budget (D6)

A `*:baseline` writer — `render:baseline`, `coverage:baseline`, `findings:baseline`, `db:migrate`, `migrate:apply`, `migrate:rehearse` — is `never-in-ci`. A baseline writer in a workflow is how a gate starts agreeing with the tree instead of with the code.

## 4. Report

A table: gate, tier, can-it-pass-today, and the command that would decide it. Then run the ones that can, and give each an exit code. Name anything you could not run as **not_configured** rather than leaving it implied.