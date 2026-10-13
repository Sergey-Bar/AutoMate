# Finish Automate — practical path to a stable, honest v1.0.0

**Date:** 2026-09-30 · **Baseline:** `02313bc`, tree clean, `pnpm verify:local` green in 13 steps, `pnpm audit --audit-level=high` clean, 33 of 121 ledger rows closed.

---

## First, the honest reading of "10/10"

The roadmap this repository grew defines 10/10 as **twelve falsifiable points**
(§17 "Definition of done"), not as a feeling. Against the current tree:

| # | Point | State | Cost to close |
| --- | --- | --- | --- |
| 1 | Every gate passes / fails / `not_configured` with a printed reason; no CI job deterministically red | **Close** — this session closed the security gate's silent pass | ~2h audit |
| 2 | `pnpm verify` and `pnpm verify:release` complete | **Close** — `verify:local` green; `verify:release` needs one `oci:verify` run | ~1h |
| 3 | Durable path proven by a required E2E, no in-memory store | **Partial** — `vertical-slice` project exists; the full chain (migrate → auth → enqueue → execute → stream → evidence → cancel/retry → lost-lease → gate) is not one required test | **2–3 days** |
| 4 | World-class evidence console: axe zero both themes, every state, zero dead components | **Partial** — one SSE, one date layer, one theme fixed this session; the rest is a redesign programme | weeks |
| 5 | Quality measured not asserted: complexity ≤10, duplication ≤3%, **mutation ≥75% on five packages**, fuzz suites, generated authz matrix | **Mostly undone** | weeks |
| 6 | Instrumented: correlation id, structured logs, health/readiness, **metrics endpoint**, run-diagnostics | **Partial** — correlation id, logger and readiness are done; metrics is not | ½ day |
| 7 | Every capability claim has a passing evidence command; deleting a test flips its row to `unverified` | **Undone** | 1–2 days |
| 8 | Evidence and audit chain complete; vault binds ciphertext to row identity | **Done** — AAD binding landed | — |
| 9 | Every schema change additive and proven | **Close** — additive-first, migration graph tested on PGlite | ~1h |
| 10 | No doc claims a capability the register marks `not_configured`; `docs:check` across links, ports, env vars, capability claims | **Partial** — paths and unused-claims are checked; **capability claims are not** | **~2h** |
| 11 | `pnpm review --base main` is a real merge gate, zero Blocker/Critical | **Undone** — only `review:rules` exists | 1 day |
| 12 | Public site live, passing all ten site-doctor checks | **Undone** — site builds, workflow exists, never deployed, no site-doctor | 1–2 days |

**The honest total: three points close, five are partial, four are substantially
undone.** That is a multi-month programme read literally. The rest of this plan is
how to be *finished and stable* anyway, which is a different and much smaller
thing.

---

## The insight that makes this tractable

The roadmap's own §5.3 is the **three-outcome rule**:

> Every gate, every capability row, and every evidence field resolves to exactly
> one of: **pass** (checked, and held) · **fail** (checked, and did not hold,
> named reason) · **`not_configured`** (not checked, with a printed reason for
> *why* and for *which parts did run*). **Never a pass, and never silent.**

That rule is what makes 10/10 falsifiable — and it means **`not_configured` is a
legitimate shippable state, not a defect.** The register already says so in its own
`reason` fields, and D15 states the product thesis: *"the site sells the evidence
guarantee, not the feature count … the capability table shows real rows **and**
honest `not_configured` rows."*

So the thing standing between this tree and a claim of 10/10 is **not** the four
unfinished points. It is **anything that lies**: a gate that passes without
checking, a doc claiming a capability the register marks deferred, a metric that
is invented. A product that ships 8 labelled `deferred` rows is the product this
repository designed. A product with one silent pass is not.

**Therefore: do not build your way to 10/10. Audit your way to it, then close the
cheap findings and defer the expensive ones on the record.**

---

## The plan

### Track 1 — Make the twelve points a measurement (1 day, highest value)

One script, `pnpm status:10`, that reports each of the twelve points as
`pass` / `fail` / `not_configured`, each with a command or file that decides it.
Output is a markdown table the site publishes and the release notes quote.

**Why this is first and why it is not over-engineering:** it is the only artifact
that makes "10/10" a claim rather than an assertion, and it costs less than a day.
It also immediately tells you which points are cheap, which are expensive, and
which are lying — before you spend a week on the wrong one. Without it, "10/10" is
the one number in this repository that is not measured, which in a repository
whose whole thesis is *evidence over assertion* is the most embarrassing gap left.

Cost: a few hundred lines of `.mjs` reading files and running commands, plus the
site page that renders it. **No new dependency, no framework, no plugin system.**

### Track 2 — The durable path, as one required test (2–3 days)

Point 3 is the only unfinished point that is *the product working* rather than
*the product being measured*. Everything else is instrumentation around it.

One Playwright spec, `durable-path.spec.ts`, tagged `pr-blocking`, that walks the
chain the definition of done names: migrate → authenticate → enqueue → execute
worker→runner → stream durable events → normalized evidence → cancel/retry →
lost-lease recovery → release gate. Against a real PGlite-backed API, with the
in-memory store asserted *off*.

**Why one test and not a framework:** the current suite has the pieces; what is
missing is the single test that proves they compose. Twelve separately-green specs
do not prove a chain works, and a failure halfway through a chain is the one
failure mode a dashboard product cannot have.

**The single most valuable assertion in it:** the in-memory store must be
*unreachable* on this path. `AGENTS.md` already records that a missing
`DATABASE_URL` makes the E2E suite "fall back to the in-memory store and the suite
report success without PostgreSQL ever being involved". Closing that is worth more
than three points of polish.

### Track 3 — The cheap remaining points (2–3 days)

| Point | Work | Cost |
| --- | --- | --- |
| **10** | Extend `docs:check`: a doc naming a capability the register marks `deferred`/`missing` is a finding. The gate that already caught `Toast` and `vitest-axe` — pointed at the register instead | **2h** |
| **11** | `pnpm review:pr` — branch name, conventional title, changed-line budget, a test per behaviour change. `review:rules` is already the engine | **1 day** |
| **12** | `site-doctor` — the ten checks as a script; deploy `docs.yml` to Pages | **1 day** |
| **6** | `/metrics`: `prom-client` + a route in the canonical manifest + run outcomes, gate verdicts, queue latency, runner health. Or, if observability is not a release criterion, a `debt` row saying so | **½ day** |
| **1, 2, 9** | Audit: confirm no CI job is deterministically red; run `verify:release` once; confirm the migration gate | **½ day** |

**This is where most of the remaining 10/10 lives: three days, not three months.**

### Track 4 — Defer the rest on the record (½ day, and it is the point)

Points **4**, **5** and **7** are programmes. Close them the way `D-4` was closed
this session: a `debt` row with a **named owner** and a **checkable removal
condition**, not an `open` row that implies someone owes a fix nobody scheduled.

- **4** — the evidence-console redesign. Owner: the console work. Removal: a route
  with axe zero serious/critical in both themes *and* a loading/empty/error state
  per route, asserted by the site-doctor's axe check.
- **5** — mutation testing on five packages, fuzz suites, generated authz matrix.
  Owner: the quality work. Removal: a `mutation-baseline.json` with a recorded
  score and a ratchet, the same shape `coverage-baseline.json` already has.
- **7** — evidence commands per capability row. Owner: the register. Removal:
  `pnpm capability:evidence` exists and **deleting a test flips the row to
  `unverified`**.

**This is not giving up.** It is the distinction the ledger's own `debt` status
exists to record: *accepted, with a condition for revisiting*. An `open` row is a
defect; a `debt` row is a decision. Leaving four of them `open` is what makes the
ledger unreadable, and it is the last thing between this repository and its own
standard.

### Track 5 — The nine open rows (1 day, mostly bookkeeping)

Supersedes the earlier `v1-finalisation` plan where they overlap; kept short
because four of them are decisions rather than code.

| Row | Action | Cost |
| --- | --- | --- |
| `RF-5` | Declare W7 out of v1.0.0 in §14, then `debt` with the rehearsal run as the removal condition | 30 min |
| `C-6` | Write `docs/quality/capability-justification.md` — 25 tables classified **reserved** or **divest**. **Do not build them.** Add a gate so an unjustified table fails | 3h |
| `RF-6` | Four rows for W14, W15, W17's untracked gate obligations | 30 min |
| `RF-10` | WebKit project, matrix split by trigger | ½ day |
| `C-4` | Split the 2,166-line store. One method group per commit, no logic edits, suite green between. **Last, alone** | 1–2 days |
| `O-4b`, `RF-9`, `PERF-1` | `debt` rows with owners, or the measurement when hardware exists | 1h |

---

## Order

```
Track 1  status:10          1 day    makes 10/10 measurable — do this first
Track 5  the 9 rows         1 day    4 decisions, 1 refactor, 4 deferrals
Track 3  the cheap points   2–3 days  points 10, 11, 12, 6 + the audit
Track 2  durable path       2–3 days  the product actually working
Track 4  defer 4, 5, 7      ½ day    decisions, honestly recorded
                          ─────────
                    ~8 working days
```

Track 2 is last because it is the one that will surface surprises, and a
surprising failure is worth having **after** everything else is green, when the
diff is the only thing under review. Track 4 is last because a deferral is only
honest once everything closeable has actually been closed.

---

## What "stable" means here, checkably

Not "it feels solid". The four properties below are all machine-checkable, and
three of them already exist:

1. `pnpm verify:local` green — **13 steps, exists**.
2. `unified-ci.yml` green on the commit — **exists**.
3. `pnpm audit --audit-level=high` clean — **exists, currently 0 highs**.
4. **No silent pass anywhere** — `pnpm status:10` reports twelve verdicts and none
   of them is a pass without a command behind it. **This is Track 1, and it is the
   one that does not exist yet.**

**Definition of done, restated honestly:** when `pnpm status:10` prints zero
`fail` and every `not_configured` carries a reason and a register row, the
repository may say it is 10/10 **under its own rule** — which is a claim anyone can
check in one command. It does not have to be ten of ten in the sense of "ships
every planned feature", because the roadmap's own §5.3 says `not_configured` is a
first-class outcome and D15 says the guarantee is the product.

---

## What I would explicitly not do

This is the over-engineering list, and it is longer than the work list:

- **Do not build the 25 dormant tables.** `C-6` offers a justification and the
  justification is the honest answer. 25 tables is 25 features.
- **Do not build the five execution engines for v1.0.0.** The plan of record
  defers them to v2.0.0 as BK-1, and the agent routes answer an explicit,
  documented 501 that names the domain and the action. That is the
  `not_configured` outcome working.
- **Do not do mutation testing on five packages.** One day to stand it up, then
  a permanent fight with the score. Baseline it and ratchet it, or leave it to v2.
- **Do not do the glassmorphism redesign.** It is a month of visual work that
  changes no verdict.
- **Do not add a metrics framework, a plugin system, a test framework, or a
  dependency that is not already in the tree.** `prom-client` is the one exception
  worth making, and only if Track 3's point 6 is in scope.
- **Do not close a row by writing a resolution that agrees with its title.** Five
  rows closed in this session were partly wrong about their own subject. The close
  criterion is: *the thing the row says is true now, and the evidence names a file
  or a command.*

---

## Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| The durable-path E2E finds a real defect | **High, and that is the point** | It runs after everything else is green; the diff is the only thing under review |
| `status:10` reports more `fail` than expected | Medium | It is a measurement, not a gate, on day one. Make it a gate once the fails are zero — which is the honest way to add a required check |
| `C-4` introduces a behaviour change | Medium | One method group per commit, no logic edits, full suite plus PGlite integration green between |
| Deferring 4, 5, 7 reads as giving up | Medium | Every deferral names an owner and a checkable condition, and `status:10` still prints them as `not_configured` with the row — visible, not hidden |
| The "10/10" claim is read as marketing | Low | It is falsifiable by one command, which is the whole point of Track 1 |
