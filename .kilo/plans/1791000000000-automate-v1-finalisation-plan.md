# Finish Automate v1.0.0 — the last nine rows, sequenced

**Date:** 2026-09-30
**Baseline:** `02313bc` on `main`, 37 commits, tree clean, `pnpm verify:local` green in 13 steps, `pnpm audit --audit-level=high` clean.
**Goal:** a stable v1.0.0 in which every ledger obligation is either discharged, out of scope by a recorded decision, or a `debt` row with a checkable owner — and no row left `open` that is not a defect in shipped code.

---

## The framing, which is the whole plan

There are **9 open rows**. They are not nine units of work, and "close all nine"
is both slower and *less* stable than the path below. They fall into four
structurally different classes, and the mistake the previous sessions kept making
was to treat them all as defects:

| Class | Rows | What actually closes it |
| --- | --- | --- |
| **A. Defects in shipped code** | `C-4`, `RF-10`, `RF-11` | Real work |
| **B. A decision, not work** | `C-6`, `RF-5` | A recorded scope call |
| **C. Product deferred by the plan of record** | `O-4b` | A `debt` row with an owner |
| **D. Waiting on a measurement** | `RF-9`, `PERF-1` | **One** run on reference hardware |

Two facts make the sequence below much faster than it looks:

1. **`RF-9` and `PERF-1` batch into a single hardware visit.** Each row's own
   `summary` states its own close condition and both are "run the command on
   reference hardware, review the diff, commit". `RF-5` is a third measurement
   in the same category. Three rows, one trip. The rows are already written to be
   closed this way — `PERF-1` literally says "one deliberate human run of
   `pnpm render:baseline` on reference hardware … together with raising
   `test:render` from `pr-reporting` to `pr-blocking` **in the same commit**".
2. **`RF-5` does not block v1.0.0.** It blocks **W7**, the tenancy wave, which
   is post-v1.0.0 by the plan of record. It is currently a `Blocker`, and the
   ledger forbids a `Blocker` from becoming `debt` — so the only way to clear it
   is a **scope decision**, and that decision is free. This is the single
   highest-leverage hour in the whole plan.

**Definition of "stable" used throughout:** `pnpm verify:local` green, a green
`unified-ci.yml` on the commit, no coverage floor moved down, and no ledger row
whose status was changed without evidence. Every phase below ends with that, and
the phases are ordered so the *irreversible* one (`C-4`) is last and isolated.

---

## Phase 0 — Scope decisions (90 min, zero code)

Nothing in this phase can break the build, and it clears 2 of 9 rows. Do it
first, because the rest of the plan is only correct once the scope is written
down.

### 0.1 Declare W7 out of v1.0.0, which unblocks `RF-5`

`docs/migration/unified-repository-migration.md` already places BK-1 (the five
execution engines) out of v2.0.0. W7 is the same shape and is not written
down. Add it to §14 "Explicitly out of scope":

```
- Multi-instance tenancy hardening (W7): the ten irreversible tenancy
  migrations. Blocked behind one rehearsal run against a real installation
  (ledger RF-5), which is scheduled as part of that work rather than before it.
```

Then move `RF-5` from `open` to `debt`, with `owner` = the tenancy wave and a
`removalCondition` naming the exact run that discharges it
(`pnpm migrate:rehearse` against a real source/restore pair, whose report
`rehearsalPerformed: true`). The Blocker-band restriction does not bite because
the *row* is the blocker on the wave, not on the release.

**Done when:** `pnpm findings:check` passes, and the open count is 8.

### 0.2 Decide `C-6`: justify, do not build

`C-6` demands "a reader, writer, route, UI and test, **or** a written
justification in `docs/quality/capability-justification.md`" for 25 dormant
tables. Building 25 tables is 25 features — that is BK-1-scale work, not a defect
fix. The honest and fast path is the justification, which the row already offers.

Write `docs/quality/capability-justification.md`: one row per dormant table, each
classified as **reserved** (schema kept, deliberately unwritten, with the v1.0.0
feature that will use it) or **divest** (no consumer, scheduled for a drop
migration). The four that have *test-only* access — `samlConfig`, `apiKeys`,
`generatedTestSuggestions`, `workspaces` — are neither: they have readers and
should be recorded as live-with-test-only-coverage, which is a finding of its own.

Add a gate so it cannot rot: `docs/check` fails when a table in
`schema/dashboard.ts` is neither read nor written anywhere and has no row in the
justification file. That converts the row from a one-time audit into an enforced
invariant.

**Done when:** `C-6` closes with the justification file as evidence, and the new
gate fails when a table is added without a justification row.

---

## Phase 1 — Tracking completeness (30 min, zero code)

`RF-6` is the cheapest row in the set and it is a *trust* row: it says waves
W14, W15 and W17 carry gate obligations no ledger row tracks, so a wave whose
only deliverable was a gate can be skipped silently. Fixing it makes every later
"we are done" claim checkable.

Add one `debt`-with-condition row per untracked wave — W14 (axe-green in both
themes), W15 (tiering of the eight QA gates inside the D6 budget), W17
(site-doctor's ten checks) — each with the obligation named and the command that
will discharge it. Keep the `RF-6` row itself, closing it with the three new
rows as evidence: the point is that the waves are now visible where a reader
looks for every other obligation.

**Done when:** every wave named in the plan of record has at least one ledger row.

---

## Phase 2 — `RF-10`, a second rendering engine (half a day)

`E2E green` currently means `E2E green in Chromium`. Both Playwright projects set
`devices['Desktop Chrome']`, and the v2 design language's signature effect is
`backdrop-filter: blur(20px) saturate(180%)` — WebKit is the engine with the
longest rendering history for exactly that. This is the highest risk-reduction
per hour of anything left.

- Add a `webkit` project to `playwright.config.ts`.
- **Split the matrix by trigger**, as the row says: PRs run `vertical-slice` +
  a Chrome/WebKit pair; nightly runs the full matrix including mobile viewports.
  A three-project config where only one collects tests is worse than one project,
  because it *looks* like coverage.
- Keep both existing guards: the non-empty-project assertion, and the CI throw
  when `product` matches nothing.
- A spec that asserts the glass effect renders differently — or at all — under
  WebKit, so the new engine is doing work rather than adding a green tick.

**Risk:** CI minutes roughly double on PRs. That is the cost of the claim being
true, and the row already names the trade.

**Done when:** a WebKit project collects tests on PRs and fails on a
deliberately-broken glass style.

---

## Phase 3 — `RF-11`, OpenAPI generated from the contracts (half a day)

A repo-wide search for `openapi` returns prose and no artifact, and BK-5's
recorded entry criterion is "W9.6 OpenAPI document exists" — a criterion gated on
a task that was never written, which the row names as the real defect. The
failure mode it predicts is "someone generating a document by hand to satisfy
the sentence".

- Generate `docs/openapi.json` **from the Zod contracts in
  `packages/shared-contracts`** — they are `real` and are what both the API and
  the client already validate against, so a generated spec cannot disagree with
  the code without a gate firing.
- Add a drift gate: regenerate in a temp copy and diff, exactly the pattern
  `docs:check` already uses for the generated site pages (read-only, so a failure
  leaves the tree alone).
- Serve it from the API at `/api/v1/openapi.json` behind the same auth as the
  rest of the manifest, so a client can fetch what CI checks.

**Done when:** the document is generated, the drift gate is in `verify`, and
editing a schema without regenerating fails CI.

---

## Phase 4 — `O-4b`, decide `/metrics` or defer it (half a day, or 15 min)

Every one of the nine rows that can be closed in this phase is cheaper than this
one: it needs a metrics library the repository does not have, a token
(`metricsToken: undefined` is a vestige in a fixture cast `as never`), and eight
metric families wired through the execution store. Its own row says the
precondition was O-5b — **which this session already closed**, so it is
genuinely next in its own sequence and deserves a real answer.

**Decide, do not drift.** `/metrics` is how a deployment is observed in
production; its absence is a real Major. But it is *not* a defect in shipped
behaviour, and the plan of record does not make it a release criterion. Two
acceptable outcomes:

- **Build it** if observability is a v1.0.0 requirement: `prom-client`, a
  `/metrics` route in the canonical manifest, and a first pass over run
  outcomes, gate verdicts, queue latency, runner health and cancellation counts.
  Half a day at minimum, and it needs a dependency decision.
- **Defer it** as a `debt` row owned by the observability work, with the
  removal condition naming the metrics library and the token.

The failure mode to avoid is leaving it `open` because neither happened, which is
where it is now.

---

## Phase 5 — `C-4`, split the execution store (1–2 days, isolated)

`apps/api/src/execution/drizzle-execution-store.ts` is 2,166 lines and holds two
of the top complexity offenders: `:1357` at complexity 65 and `:1098` at 39.

**This is the only phase that can break shipped behaviour, which is why it is
last and why it must be a pure move.** The row names the correct gate, and the
test suite is the safety net: `apps/api` carries 1,172 tests including a
Postgres-backed integration suite that applies the real migration graph to PGlite.
Split along the seams the complexity numbers already name:

1. Land the split as a **sequence of pure moves** — one method group per commit,
   no signature changes, no logic edits, `pnpm verify:local` green between each.
   A refactor that also fixes something cannot be reviewed as a refactor.
2. Drive the offender count down against `docs/quality/complexity-baseline.json`
   (ceiling 15, count 31) — the row is explicit that this, not a file-length
   number, is the gate.
3. The `findValid` → `touch` shape added in this session is the natural seam: the
   store now has a read path that writes, and that boundary is worth a module.

**Risk:** behaviour change through an accidental edit. Mitigated by the
one-group-per-commit rule, which makes each step reviewable as a move.

**Done when:** no method is over the complexity ceiling, the offender count in
the baseline is lower, and the full API suite plus the PGlite integration suite
are green with no test changed.

---

## Phase 6 — The hardware visit (1 day, unblocks code work)

Three rows close here and **none of them blocks any code phase**, so run this
in parallel with Phase 5 on whoever has the hardware. It is one visit because it
is one machine and one set of commands.

**On reference hardware** (self-hosted single-node, per D10 — a GitHub runner is
not it):

1. `pnpm render:baseline`, reviewed as a diff, then raise `test:render` from
   `pr-reporting` to `pr-blocking` **in the same commit**. Closes `PERF-1`.
2. Measure the k6 scenario, then **tighten** `performance/thresholds.json` to the
   measured values and set `recorded: true`. Closes `RF-9`.
3. `pnpm migrate:rehearse -- --source <url> --restore <url>` against a real
   installation. Closes `RF-5`'s removal condition, and is the evidence W7 waits
   on before it may start.

Each of these is **record-then-tighten**. Committing plausible ceilings and
letting a required job go green is the defect `RF-9` already records, and
`PERF-1`'s row says so in its own words: a gate that can rewrite its own floor
in the same commit is a gate that agrees with the tree instead of the code.

**If the hardware is not available:** all three become `debt` rows with owners and
those exact removal conditions, and v1.0.0 ships without them — which is
honest, because all three are already `pr-reporting` and none is a required
check today.

---

## Order, and why

```
Phase 0  scope decisions      90 min   clears RF-5, C-6     zero risk
Phase 1  tracking              30 min   clears RF-6        zero risk
Phase 2  RF-10 WebKit         half day   clears RF-10        low risk, high value
Phase 3  RF-11 OpenAPI        half day   clears RF-11        low risk
Phase 4  O-4b decide           15 min–½d  clears O-4b        decision first
Phase 5  C-4 split the store   1–2 days   clears C-4         HIGHEST RISK — isolated, last
Phase 6  hardware visit        1 day      clears RF-9, PERF-1, RF-5  parallel, external
```

The cheap-and-clearing phases go first so that the *statement* "the remaining
work is one refactor and one hardware visit" is true by the end of day one. The
big refactor goes last, alone, when everything else is green and the diff is the
only thing under review. The hardware visit is parallel because it touches no
code.

**Total:** roughly **3 days of engineering** plus **1 day of hardware**, with the
release gate green throughout.

---

## What "finished" looks like

`pnpm findings:check` green, and the 121-row ledger containing:

- no `open` row that describes a defect in shipped code;
- every deferred item a `debt` row with a named owner and a checkable removal
  condition;
- one `false-positive` or `fixed` record for each thing that was wrong about
  itself — which, in this ledger, is a category with several members, because
  five of the rows I closed this session were partly wrong about their own
  subject;
- `pnpm verify:local` green in 13 steps, `unified-ci.yml` green, `oci:verify`
  green, `pnpm audit --audit-level=high` clean, no coverage floor moved down.

Then tag `v1.0.0`, which the plan of record's §14 already scopes, and say
plainly in the release notes what the product does **not** do — the capability
register, now 41 rows and generated into the site, is the honest list, and the
tenancy wave and the five execution engines are named as what comes next.

---

## Risks, stated plainly

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| `C-4` introduces a behaviour change | Medium | One method group per commit, no logic edits, full suite green between; the diff is a move or it is reverted |
| `RF-10` doubles CI minutes | Certain | Matrix split by trigger; PRs get Chrome+WebKit, nightly gets the full set |
| The hardware visit does not happen | Medium | All three rows are already `pr-reporting`; they become `debt` and v1.0.0 ships without them, honestly |
| `C-6` becomes 25 features instead of a justification | **High if unattended** | Phase 0.2 is a decision with a written deliverable, and Phase 0.2's gate makes an unjustified table fail the build |
| Another wave of ledger findings appears during Phase 5 | Medium | `findings:check` is in `verify`, so a new row is visible the day it is written rather than at the end |

**One thing I would not do:** close a row by writing a resolution that agrees
with its title. Five rows closed in this session were partly wrong about their
own subject — `Q-53` was wrong that derivation ran per request, `C-2` was wrong
about the register contradicting itself, `W-6` had one stale claim out of three,
`RF-12` had a plan asserting a package was unused that two suites depend on. The
ledger is a record of what is known to be wrong, and a row closed by agreeing
with its own title is a row closed for the wrong reason. The close criterion for
every row in this plan is: *the thing the row says is true now, and the evidence
names a file or a command.*
