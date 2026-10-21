---
title: How this project is maintained
description: The findings ledger, dependency policy, review passes and the recurring cadence.
outline: deep
---

# How this project is maintained

Maintenance here is a record, not a feeling. Each part below has a file that holds the
state and a command that checks it.

## The findings ledger

`docs/quality/findings-ledger.json` holds every confirmed defect: its band (Blocker,
Critical, Major, Minor), how it was found, what was observed, and the test that proves the
fix. `pnpm findings:check` makes it more than a document:

- a `fixed` row whose evidence file no longer exists fails — the proof was deleted;
- a status moving backwards, or a row disappearing, fails;
- a Blocker or Critical may never be recorded as `debt`;
- `debt` needs an owner and a removal condition that could actually happen;
- a row an automated sweep produced cannot be closed until a human has read the code;
- every test cited as evidence must be run by something, or the row could stay `fixed`
  while the regression returns.

The generated [findings page](/pages/quality/findings) publishes the ledger, so the public
site cannot claim more than the ledger does.

## Dependencies

- Shared versions live once, in the `catalog:` block of `pnpm-workspace.yaml`.
  `pnpm deps:policy` reports a package that declares its own range for a catalogued
  dependency, an unused dependency, and a resolved version nobody reviewed.
- `docs/quality/dependency-baseline.json` records each direct dependency's reviewed
  version. A bump is a reviewable line in a diff, not a lockfile side effect.
- Every `overrides` entry names the advisory it exists for and a review date.
  `pnpm deps:policy` expires an override on that date.
- The package manager refuses a release published in the last day, so a same-day malicious publish
  cannot reach the lockfile. `pnpm audit --fix` exempts a security patch from the wait.
- Majors move one per pull request, each behind the full gate chain. A major that is
  deliberately held back has an open ledger row naming what it waits for.

## Code review

Changes are reviewed against `.github/review-rules/rules.json`, whose categories map onto
the reviewer personas in `.github/agents/`. `pnpm review:pr --base main` runs the rules
against a diff. Periodically the whole tree is read package by package — the API, the web
console, the runner and worker, the shared packages, then the gate scripts — and every
defect found becomes a ledger row with a failing test before it is fixed.

## The cadence

| When      | What                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------- |
| Every PR  | `pnpm verify` in CI; a ledger row for any defect found or fixed.                                      |
| Nightly   | `pnpm quality:baseline`, the load thresholds, and the slower scans.                                   |
| Weekly    | `pnpm outdated -r` and `pnpm audit`; Dependabot pull requests reviewed.                               |
| Monthly   | Override review dates in `pnpm-workspace.yaml`; `debt` rows re-read against their removal conditions. |
| Quarterly | A package-by-package review pass, and a deliberate look at which held-back majors can now move.       |

## Releases

`CHANGELOG.md` records each release. A release is tagged only from a `main` that passes
the full chain, and its notes list the ledger rows it closed.
