# Contributing

This repository has one rule that matters more than the others. Everything else is
ordinary engineering.

## Write the test, watch it fail, then fix it

Not "add a test". **Watch it fail.**

1. Write the test that describes the correct behaviour.
2. Run it **while the defect is still in the code**.
3. Confirm it fails — and confirm it fails _for the reason you expect_, not some other
   reason.
4. Fix the code. Confirm the same test now passes.
5. Say in the PR description what the failure looked like. "It failed before the fix" is
   the evidence; without it, nobody can tell your test from one that was written to match
   the code it shipped with.

### Why this is not bureaucracy

Three times during the last remediation programme, a suite was green while checking the
wrong thing. None was found by careful reading.

- **`packages/connectors/sdk`'s suite tested `dist/index.js`, not `src/index.ts`.** Twenty
  tests, all passing. Five separate mutations of the retry policy — ignoring the manifest's
  idempotency, never retrying, mis-stamping the attempt count — left it fully green. The
  only honest signal in the whole report was a coverage line reading `index.ts 0%`.
- **`apps/web/src/route-manifest.test.ts` validated the navigation manifest against a
  predicate defined in the same file.** So a route could be registered in the router and
  unreachable from the sidebar, with every test passing.
- **A commit was merged that passed over a live defect the same day.** One of the fixes
  in this repository is the fix for that commit, not for the defect the issue described.

In all three cases the tests were numerous, the suite was green, and the code was wrong.
A passing suite is a claim, not a fact — and the only thing that makes the claim
trustworthy is having seen it break.

### "Fail for the right reason" is the load-bearing clause

A gate can fail for a reason that has nothing to do with what you are testing, and a
failing gate looks exactly like a working one. During this programme a coverage gate went
red with `no coverage provenance` — a real refusal, and the wrong one. It was nearly
recorded as proof that a different check worked.

When a check fails, read what it said. An exit code is not a result.

### If the test cannot fail

Do not add a loop or an assertion whose only purpose is to move a coverage number. Either
the code is doing something untested — in which case it is unverified and should say so —
or the branch is unreachable, in which case **delete the branch**. An unreachable guard is
either untested or tested by a construction that cannot happen, and both are worse than
no test. This repository has removed several on exactly that reasoning, and each removal
is recorded in the ledger rather than done quietly.

## Before you open a pull request

```bash
pnpm --filter <package> test   # per-package, writes coverage provenance
pnpm typecheck
pnpm lint
pnpm complexity                # cognitive complexity must not increase
pnpm coverage:ratchet          # floors only ever go up
pnpm findings:check            # if you changed a findings row
```

`pnpm verify` runs the whole chain. Two caveats that are not yours to solve:

- `pnpm security:static` **hangs on a Windows host**. Run it on CI or in WSL. Do not
  weaken the ruleset to make it work on one machine.
- The **coverage ratchet and the complexity ratchet are floors that only go up.** If a
  change fails one of them, the correct response is to write the test or to lower the
  complexity — not to move the floor. A ratchet that was made convenient is not a ratchet.

`apps/web` sits at a coverage floor with roughly one line of margin, so a change there
without its own covering test will fail the ratchet. That is the gate working, not a
budget you may spend.

## Working on a findings row

`docs/quality/findings-ledger.json` is the machine-checked scope: 119 rows, currently
**75 fixed, 39 open, 4 refuted, 1 debt**. Read the row's `summary` — it names the files and
lines — and then **read the code it points at**, because roughly a third of the rows were
wrong when last read.

If you fix a row:

1. Add a test, and calibrate it (above).
2. Update the row: `status: "fixed"`, `evidence[]` with a path that exists, and
   `confirmed: true` with `confirmedOn` / `confirmedBy` if it was a `sweep` row.
3. Run `pnpm findings:baseline` once, after the status genuinely changes — never as a way to
   quiet a failing check.

`pnpm findings:check` fails if a `fixed` row's evidence file has been deleted, so the
proof has to be a file that exists.

## Picking up an open issue

The tracking issue is
[#6](https://github.com/Sergey-Bar/AutoMate/issues/6), and it names the three rows nobody
can close from a laptop, the one that needs a maintainer's decision, and the ones that are
feature builds rather than fixes. Read the **do not start these alone** note on it before
picking anything: three open rows want to edit the same 2 119-line file, and two of them
are incompatible without coordination.

If a row turns out to be wrong, that is a useful result. Say so, with the file and line
that refutes it — eleven rows were found wrong when the backlog was re-read, including
one whose headline claim was arithmetically impossible.
