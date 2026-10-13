---
description: 'Close a findings-ledger row, or explain why it cannot be closed yet. Runs every gate that decides the row and refuses on missing evidence.'
---

# Closing a row in `$ARGUMENTS`

A row closes when its **evidence decides it**, never because the work looks done. This command exists because the cheapest way to close a row wrongly is to write `status: "fixed"` and let a review catch it later.

Load the `ledger-row` skill first — it holds the field rules, and `scripts/lib/findings-ledger.mjs` is the authority when the skill and the script disagree.

## 1. Read the row, and refuse to proceed if it is not ready

For `$ARGUMENTS`, report which of these it currently fails, and stop:

- `status` is `open` and `provenance` is `sweep` — it needs `confirmed: true` naming who read it and against what, or `refutedBy` if it was never real. **Nobody has read this row, so nobody can close it.**
- The band is `Blocker` or `Critical` and it names no `wave`.
- The summary describes work that has not happened.

## 2. Verify every evidence path exists — before anything else

```bash
pnpm findings:check
```

This fails when a `fixed` row names a path that no longer exists. That failure is the whole point: **the proof was deleted, so the claim is open again.** Do not work around it by editing the path until the check passes — a path that stopped existing means the fix stopped existing too.

## 3. Check the row is not already stale in the other direction

Read the cited code and confirm the defect it describes is *still* what that code does. `P-18` is the reference failure: the finding cited `packages/auth/src/session.ts:21-23`, that file did not exist, and the defect had already been fixed by an earlier change nobody recorded against the row. A row can be closed twice; the ledger's ratchet does not catch that, a reader does.

## 4. Run the gates that decide this row specifically

Not all of them — the ones whose subject is this row:

| If the row is about | Run |
|---|---|
| a table, a constraint, or tenancy | `pnpm tenancy:check` |
| test quality or coverage | `pnpm coverage:ratchet` |
| a migration or a sealed row | `pnpm db:check`, `pnpm migrate:validate` |
| a gate, a script, a job, or a tier | `pnpm review:rules` and read `scripts/gate-tooling.json` |
| a rule or a CI wiring claim | `pnpm review:pr` |
| anything touching `AGENTS.md`, a persona, or a `SKILL.md` | `pnpm skill-scan` |

If one of those cannot run on this host, say **not_configured** and name the command that would decide it. A gate that did not run is not a gate that passed.

## 5. Only then, write the close

Set `status: "fixed"`, and give every `evidence` entry a `path` that exists and an `asserts` a reader could contradict. Prefer naming the test that fails without the fix.

For an irreversible migration, the rehearsal is owed and it is not optional: `pnpm migrate:rehearse` must have restored a post-migration database **and re-opened every encrypted row** through the product's own `vault-crypto`. **RF-5 is an open Blocker precisely because the tenancy wave landed without it.** A rehearsal in CI is not a rehearsal — CI has no second database, so running it there proves only that `pg_dump` is installed.

## 6. Report

- What was verified, by which command, with its exit code.
- What you could not verify and why.
- The diff to `docs/quality/findings-ledger.json`.

If any step above could not be completed, **leave the row `open` and say so.** A row that stays open is honest; a row closed on a gate that did not run is worse than an open row, because it removes the only signal that the work is unfinished.