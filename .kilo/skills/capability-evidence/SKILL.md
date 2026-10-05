---
name: capability-evidence
description: 'Use when adding or changing a row in the capability register, when someone claims a capability is real when it is a mock, or when a test, module, or route that a capability claim names gets deleted or renamed. Explains why the register status is hand-asserted and how to give a row a command that decides it instead.'
---

# A capability claim needs a command, not a status

## What the register is, and what it cannot do

`pnpm docs:capability-register` builds a table of 42 capability rows and checks that **every cited path exists** and that the baseline is a real commit. That is worth having: a claim pointing at a file that was renamed should not read as authoritative.

**It cannot judge whether a capability is `real`, `mock`, `missing`, `deferred` or `obsolete`.** The script says so itself. Those five statuses are a human judgement recorded in a file, and nothing recomputes them. Today: 16 real, 14 mock, 8 deferred, 2 missing, 2 obsolete.

That is the whole problem, and it is the same one the repository has already recorded twice. `P-6` was three startup-policy authorities. `P-5` was two `gate_status` lists that disagreed **in both directions** — the database rejected three values the contract defined and accepted one no client could send. In both, the fix was structural: one source, derived rather than restated.

A status in a JSON file that a human typed and no tool re-checks is exactly that shape. It will be true on the day it was written.

## The rule

**A row may assert `real` only when it names a command whose failure would make it false.**

Without one, the row is a claim. With one, it is a measurement. `real` is then the *output* of a command rather than an opinion in a file, and the failure mode inverts: a command that cannot run is `not_configured`, and the row is `unverified` — never `real`.

## Writing the evidence command

A row's command has to be **specific enough that it can fail, and cheap enough that you would actually run it.**

Good:

```bash
pnpm --filter @automate/api exec vitest run src/routes/execution.test.ts
```

Bad, and each for a named reason:

- `pnpm test` — passes while the specific capability is a mock. It runs the suite, so it says nothing about this row.
- `pnpm verify` — also far too slow to run per capability, so nobody will.
- A command that always exits 0 — worse than no command, because it looks like evidence.

Prefer a command that exercises the capability's **own** path. A mock usually lives behind a route that returns a fixture or an empty array, so a test asserting the real shape is what decides it.

## The state transitions

| Observed | Status |
|---|---|
| the command exits 0 | `real` |
| the command exits non-zero | `mock` — the capability is claimed but does not work |
| the cited path is gone | `missing` |
| the capability is planned and not started | `deferred`, with the reason |
| the capability was removed on purpose | `obsolete`, with what replaced it |
| the command cannot run here | `unverified`, with the command that would decide it |

**`unverified` is not in the vocabulary today, and that is a gap rather than a decision.** Without it there are only two honest options — say `real` without evidence, or say `mock` and be wrong. Adding the status is a change to `STATUSES` in `scripts/capability-register.mjs` and needs its own gate so it cannot be added without the mechanism to populate it.

## What deleting a test must do

The requirement is that deleting the test **flips the row**. Concretely:

1. The row names a command, not a description.
2. The command depends on the file the claim rests on.
3. Delete the file → the command fails to resolve → the row is `unverified` or `missing`.
4. A gate reads the register and fails while a row asserts `real` whose command does not pass.

Steps 3 and 4 do not exist yet. **Until they do, a deleted test leaves a row claiming `real`, and the register still verifies** — because it only checks that the *path* exists, and a sibling test file happily does.

That is the honest state of the mechanism. Say `unverified`, not `real`.

## Working a row

1. Read the row. If it asserts `real` and names no command, it is a claim — treat it as `unverified` until one exists.
2. Run the named command. Report its exit code, not your impression of the code.
3. If it fails, the row is `mock` whatever the summary says. A `mock` row with a detailed `real`-flavoured summary is worse than an obviously unfinished one, because a reader trusts the detail.
4. If you promote a row, record the command in the same edit that changes the status. A status change without a command is the defect this skill exists to prevent.
5. Do not improve a `mock` row's prose. Fix the capability or downgrade the claim; the description is not the work.

## The other half: `docs:check`

`pnpm docs:check` fails when a document claims a capability the register marks `missing` or `obsolete`, and when a document cites a path that does not exist. It does **not** verify that a row marked `real` is real — that is the missing half, and it needs an evidence command per row before it can be closed.