# Contributor readiness

**Started 2026-09-28.** Succeeds `1790582734810-findings-remediation-plan.md`, which is
closed by its own numbers: 75 rows fixed, all 44 unconfirmed `sweep` rows dispositioned,
and the remaining work no longer fits "remediate findings".

This is a three-task plan. It produces no product change by design — it makes the
repository legible to someone who has never seen it, which is the gap the previous plan
left open.

## Why this plan exists

The previous plan's instructions are now outnumbered by its history. A contributor opening
it today reads 26 KB to learn that a dozen things are already fixed, and the three rules
that actually matter are scattered through commit messages rather than stated anywhere a
newcomer will look.

The programme's own evidence for this is uncomfortable and worth stating plainly. Three
separate times in this programme, a suite was green while checking the wrong thing:

- `packages/connectors/sdk`'s suite ran `dist/index.js` instead of `src/index.ts`.
  Twenty tests. Five mutations of the retry policy left it fully green. The only honest
  signal was a coverage line reading `index.ts 0%`, in a report where every other package
  was measured.
- `apps/web/src/route-manifest.test.ts` compared a manifest against a predicate defined in
  the same module, so `/dashboard/quarantine` could be registered in the router and
  unreachable from the sidebar with nothing failing.
- `tests/contract`'s commit was built by another reviewer who had **passed over a live
  defect the same day**; one of the fixes here is the fix for that commit, not the defect
  the row described.

None of these were found by a reviewer reasoning carefully. All three were found by
something refusing to look right — a coverage number, a calibration that came back green
three times, a test that passed a fixture it should have rejected.

## The three tasks

### Task 1 — Make the open issues match reality

Five `good first issue` issues are open (#7 P-62, #8 P-63, #9 P-72, #11 W-7, #12 F-6).
Before anyone picks one up, each must be re-checked against the current tree, and any
question it leaves open must be **decided**, not handed on.

The one that genuinely needs a decision is **#11**. Its three copies of `formatDate` have
different signatures *and* different empty-state text — `'Not started'` in one,
`'UNKNOWN'` in another, and no fallback in the third. A contributor who "deduplicates"
them naively changes what two screens render, and would not find out from a failing test.

**Done when:** every open issue has been re-read against the code it names, and every
issue that leaves a decision to the contributor has the decision written into it.

### Task 2 — Say what not to start alone

**C-4** records that `drizzle-execution-store.ts` is 2 166 lines with two functions over the
complexity ceiling, and wants it split. Six other open rows want to edit that same file.
A contributor who picks Q-49 or Q-51 and refactors the file around their change will
collide with the C-4 split, and neither of them is wrong.

The repository has no place to say this. The ledger records each row independently, which
is correct for a machine and useless for a person.

**Done when:** the tracking issue names the shared file, the rows that touch it, and what
"coordinate first" looks like in practice.

### Task 3 — State the fail-before rule in one place

`AGENTS.md` already has the principle —

> A test that cannot fail is worse than no test.

— but not the practice, and the practice is the part that is easy to skip:

> Write the test. Run it against the code **with the defect still present**. Watch it fail
> **for the right reason**. Only then fix it, and confirm the same test now passes.

"Fail for the right reason" is the clause that carries the weight. During this programme a
gate failed with `no coverage provenance` — a real refusal, and the wrong one — and was
nearly recorded as proof that a different gate worked. An exit code is not a result.

The test file is the natural home for this: it is the file every contributor opens before
writing a test, so the rule is read by the person who needs it, at the moment they need it.

**Done when:** a contributor who has never seen this repository, and is about to write a
test, cannot fail to read it.

**Correction, made while doing the task.** The paragraph above proposed putting this in
`apps/api/src/test-support/README.md`, on the reasoning that a test-support module is where
someone goes before writing a test. That file does not exist, and more to the point the
reasoning was weak: it is not where a newcomer looks. `CONTRIBUTING.md` is rendered on the
repository page by GitHub, it is the conventional entry point for a new contributor, and
this repository had none. So the rule went to `CONTRIBUTING.md`, which also carries the
gate list, the ratchet caveat, and how to pick up a row. Recording the correction rather
than quietly changing the plan, because "the plan said X and I did Y" is exactly the
pattern this repository is trying to stop.

## Explicitly not in this plan

- **The 26 tractable rows.** Separate wave, separate plan.
- **X-4, O-3b, O-4b, O-5b, C-6** — feature builds and one decision wave. Not fixes.
- **RF-5, RF-9, PERF-1, G-4b** — blocked on a database, on reference hardware, and on a
  Windows shell, respectively. No repository change closes them.
- **Lowering a floor, or widening a threshold to make a gate pass.** Two of the three
  gates in this repository are ratchets; the value of a ratchet is that it is
  inconvenient, and a ratchet that was made convenient is not a ratchet.

## Definition of done

All three tasks complete, `pnpm verify`'s gate chain green, and the tracking issue
(#6) reflects the state. No product code changes, so the coverage and complexity floors
are expected to be untouched — if either moves, something in this plan was not supposed
to change code.
