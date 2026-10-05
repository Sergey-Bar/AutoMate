---
name: ledger-row
description: 'Use when adding, editing, confirming, refuting, or closing a row in docs/quality/findings-ledger.json — also when asked to record a finding, file a defect in the ledger, triage a sweep row, or close/defer one. Enforces the ratchet in scripts/lib/findings-ledger.mjs: evidence paths that must exist, provenance, confirmation, bands, debt fields, wave gates, and the ratchet direction.'
---

# Writing a row in the findings ledger

`docs/quality/findings-ledger.json` is the machine-checked record of every confirmed defect, and `pnpm findings:check` is what makes it more than a document. Every rule below is enforced by `scripts/lib/findings-ledger.mjs`. Read that file when a rule here and its message disagree — the script is the authority.

**A claim about defects that nothing checks is a document.** That is the whole reason this skill exists.

## The fields, and what fails without each

| Field | Required | What the gate does without it |
|---|---|---|
| `id` | yes | Duplicates fail. |
| `title` | yes | A row that does not say what it is cannot be closed. |
| `band` | yes | Must be one of `Blocker`, `Critical`, `Major`, `Minor`, `Nit`. |
| `provenance` | yes | `hand` or `sweep`. |
| `status` | yes | See the status rules below. |
| `summary` | yes | Says what was confirmed and where. |
| `evidence[]` | for `fixed` | Each entry has a `path` and an `asserts`. **The path must exist** — a `fixed` row whose evidence path no longer exists fails, because the proof was deleted and the claim is open again. |
| `wave` | for open Blocker/Critical | An open blocking-band finding that no wave owns fails. |
| `owner`, `removalCondition` | for `debt` | Both must be filled, and the condition must name a thing which could happen. |
| `refutedBy` | for `false-positive` | Required. "False positive" with no pointer is indistinguishable from a row nobody wanted to fix. |
| `confirmed: true` | before closing a `sweep` row | See below. |
| `blocksWave`, `removalCondition` | for a gating row | Read by `wave-gates.json` handling. |

## Status rules

- **`open`** — an open `Blocker` or `Critical` must name a `wave`.
- **`fixed`** — every evidence path must exist on disk.
- **`debt`** — forbidden in the two blocking bands (plan §1). Needs `owner` and `removalCondition`. "In the future" is not a removal condition.
- **`false-positive`** — needs `refutedBy` naming the `file:line`, commit, or observation showing the defect is not there. **Do not delete a refuted row**: the ratchet fails on vanished rows, which is what makes deletion impossible and therefore correct.

## The confirmation rule — the one with the most weight

`provenance` says how a row got here. **`hand`** means a human read the code. **`sweep`** means an automated sweep produced it and nobody has read it since.

**No `sweep` row can be closed while it is still `sweep`.** It needs either:

- `confirmed: true` with `confirmedOn` and `confirmedBy` naming who read it and against what, or
- `status: "false-positive"` with a `refutedBy` note.

A row nobody has read is a claim produced by a script, and a claim nobody has read cannot be closed.

## What fails that is not a per-row rule

- **A status moving backwards fails.** A `fixed` row does not become `open`.
- **A row disappearing fails.** Do not delete rows — including refuted ones.
- **An empty ledger fails.** A check that measured nothing is not a pass.
- **A row that goes stale fails.** Staleness is why `P-18` is interesting: the finding cited `packages/auth/src/session.ts:21-23`, that file does not exist, and the defect had already been fixed by an earlier change nobody recorded against the row.

## Before you write the row

1. **Search the ledger first.** `pnpm findings:baseline` regenerates the status snapshot; `pnpm findings:check` tells you what is already wrong. A duplicate row is a gate failure.
2. **Read the code.** For `provenance: "hand"` you must have actually read it. A summary that could have been written from the finding's title alone is a `sweep` row wearing a `hand` label.
3. **Check whether the defect is still there.** Stale rows are the recorded failure mode of this ledger.
4. **Decide whether a gate should exist rather than a row.** A row records a defect that was fixed. A gate prevents the next one, and it needs a tier in `scripts/gate-tooling.json` — see the `gate-tiering` skill.

## Writing `evidence`

Each entry is a `path` and an `asserts` sentence. The `asserts` is what a reader checks against the code, so write it as a claim a test could contradict:

- Good: `` "`executeWithRetry` takes `idempotent` and `options.idempotent === true` is one of the two ways a retry is permitted — the other being a `ConnectorRejectionError`. Absent is treated as false, so an adapter that forgets to pass the manifest loses the retry rather than gaining a duplicate." ``
- Bad: "`retries.ts` was fixed." — a label, not a claim.

Prefer naming the test that fails without the fix. That is what makes the row survive the proof moving.

## Writing `summary`

The house style for a summary is: what was confirmed, what turned out to be true that the row did not say, what the fix is, and **what it does not close**. Long is correct here. A short summary that reads like a label is the failure `scripts/review/ruleset.mjs` guards against for review rules with its 20-character `rationale` minimum, and it applies here for the same reason — a rationale nobody can question is a rationale nobody trusts.

Record the correction when the row's premise was wrong. `P-20`'s summary says the finding reads as though `schedules` had a `workspace_id` column the query merely forgot to filter on, and then says it did not: the tenant was never a column. That correction is the most useful sentence in the row.

## After you write it

```bash
pnpm findings:check
```

Run it. A row that passes the shape check and fails the evidence check — because the path does not exist — is the exact failure this gate exists to catch.