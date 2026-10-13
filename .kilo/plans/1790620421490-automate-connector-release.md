# Automate 3.0 — The Connector Release

**Version intent:** the last version is judged on one thing — a stranger clones this, runs
one command, and within ten minutes sees their own test runs flow into GitHub, Slack, and
Jira. Not on ledger count, not on gate count, not on mock elimination.

**Audience:** self-hosting QA engineers who already run Playwright or JUnit in CI.

**Hero:** a run that ends produces a GitHub check + a Slack summary + a Jira ticket for
each newly-failing test, with no glue config beyond four environment variables.

**Order of work:** Part A (six ledger rows, six PRs) lands **first** and lands on its own.
Part B (the connector release) follows and is unaffected by it. The reason is in A.0:
four of the six rows are not defects, and closing them is cheap now and expensive after a
feature release has moved `apps/api/src/index.ts` and `apps/web/src/lib/` around.

### The promise, written down so it can fail

The version intent above is **"within ten minutes"**, and until this release nothing in the
repository measures it. That is the difference between a plan and a wish, and it is the single
biggest gap in this document. **Define the number before writing any of B, or B has no
definition of done.**

The measurement is already half-built — `test:render` reads `performance/rendering-budget.json`
and `scripts/lib/render-gate-phase.mjs` computes which tier the gate is allowed to have, and
`gate-tooling.test.mjs` fails if `scripts/gate-tooling.json` disagrees. Reuse that machinery
rather than inventing a second one:

| Claim | What must be measured | Where | When it becomes a gate |
|---|---|---|---|
| **Ten minutes, cold** | Clone → `pnpm quickstart` → healthy dashboard, on a machine that has never run this repo | new `performance/quickstart-budget.json` + a script in `scripts/`, wired into `gate-tooling.json` | `pr-reporting` at first, exactly like `test:render` before it graduated |
| **Four env variables** | Count the variables in `.env.quickstart` that a stranger must edit | assert in a test, not in prose | `pr-blocking` — it is a claim in the README |
| **A run produces three artefacts** | GitHub check + Slack message + Jira issue, asserted at the API | `e2e/product/connector-delivery.spec.ts` | `pr-blocking` |
| **Zero manual `.env` editing** | `compose:config` resolves the quickstart file and a cold `up` reaches healthy | B3.1's evidence row | `pr-blocking` |

**The tier discipline in `AGENTS.md` applies here verbatim.** A budget whose first real
measurement has not been taken is `pr-reporting`, not `pr-blocking` — a required check that
can never pass teaches reviewers to read red as noise, which is the exact failure
`test:render` documents. **So: record a real run before the gate is allowed to compare
against it, and raise the tier in a second commit that the tooling test can see.**

**The honest caveat, which belongs in the README too:** the reference for "ten minutes" is a
self-hosted single-node install, not a GitHub runner. Say which machine the number was
measured on, or the number is decoration.

---

## Status — Part A landed 2026-09-28; the corrections below are already in the code

All six rows are closed, in six commits, with the gate sequence green after each. **Three
things in this plan were wrong**, and they are corrected in place below. Two of them would
have shipped broken code, and they are the reason A.0.1's calibration step is not optional:

- **A.5 was going to regress every flaky run.** The "uniqueness check on `testId`" this plan
  specified is impossible: a retried test is one test with several attempts sharing a
  `testId`. The correct rule is per-`testId` attempt ordinals of 1..n. Corrected in A.5.
- **A.3's "type it `ReadonlySet<RunEventType>` and the cast is unnecessary" does not compile.**
  `ReadonlySet<RunEventType>.has(string)` does not narrow. A type predicate is also required.
  Corrected in A.3.
- **A.5's rule immediately found a second, unlisted defect:** `junit-xml.ts` numbered attempts
  with a running ordinal across the whole document, disagreeing with `playwright-json.ts` and
  with what `RunExplorer.tsx:36` renders as "attempt N". Added to A.5 as part of the row.

Two new ledger rows exist because a row's title claimed more than its fix delivered: **W-7a**
(the locale half of W-7, left open) and **P-72b** (P-72's Reading B, left open). Neither
existing row was closed by a change that did not make it.

**Part B has not been started**, and the two open items below are its prerequisites.

---

# PART A — Six findings rows, six pull requests

## A.0 Read this first: what the six rows actually are

Every row was re-read against the code. **Five of the six are already `confirmed: true`**
with `confirmedBy: kilo:fail-before-verification` and a dated reading note. P-72 is the
exception: it is `provenance: "hand"` with no `confirmed` field, and it is the one row
here that is a **decision rather than a fix**.

The rows are not six instances of one thing:

| Row | Band | Actual kind | What the fix is |
|---|---|---|---|
| F-6 | Major | **real defect** (latent) | hardening: bound the accumulation, mark truncation visibly |
| W-7 | Major | **real defect + product decision** | dedupe with a parameterised fallback |
| P-62 | Major | **latent drift, not live** | derive two copies from the contract |
| P-63 | Minor | **consolidation, difference is deliberate** | one builder; keep the two health bodies apart |
| F-4 | Major | **real gap, consequence not demonstrable** | decide whether to close, re-band, or refute the claim |
| P-72 | Major | **an open design question** | pick a reading, then implement it |

Two of these rows carry line citations that will not survive a verifier, and both
corrections belong in the ledger text itself, not only in a PR description:

- **P-72** cites `index.ts:246` and `:231`; the real lines are **`:251`**
  (`displayPrefix: 'dev'`) and **`:236`** (`let sessionBackend;`).
- **P-62** and **F-6** both cite `durable-realtime.ts`, **a file that does not exist**.
  It is `durable-realtime-bus.ts`, and the actual `RunEventTypeSchema.options` derivation
  precedent is `apps/web/src/lib/api.ts:540`, not the file the rows name.
- **F-6** says the adapter has three test-file importers. It has **two**
  (`packages/reporter/src/junit.test.ts`, `packages/reporter/src/adapter-parity.test.ts`).
  `tests/contract/` does not reference junit at all.
- **P-62** says the drift "is already live". It is **latent**: all three lists hold the same
  ten names in the same order today. The defect is what happens to the eleventh.

Recording these is not pedantry. `pnpm findings:check` fails a `fixed` row whose evidence
path does not exist, and an implementer who follows `durable-realtime.ts` finds nothing.

### A.0.1 The rule, and its calibration step

`CONTRIBUTING.md` is explicit and this is the part that is easy to fake:

1. Write the test.
2. Run it **with the defect present**.
3. Confirm it fails **for the reason expected** — not a different reason.
4. Fix. Confirm the same test passes.
5. **Record what the failure looked like.**

Step 5 is the calibration step and it is not optional. A note in every fixed row in this
ledger shows the same pattern: *"Twelve reintroduced defects were each observed turning
the suite red"*, *"a calibration trial that reinstates a per-spec ordinal is confirmed to
turn it red"*. **For each row below, after the fix is green, reintroduce the defect once,
confirm the new test goes red, and restore.** That trial is what distinguishes a test from
a test that was written to match the code it shipped with — and this repository has
already had a green suite testing `dist/index.js` instead of `src/index.ts`.

### A.0.2 The two traps you named

- The ratchets are floors that only go up. `pnpm complexity` must not increase;
  `pnpm coverage:ratchet` fails on regression. If either goes red the answer is a test or
  a refactor. **Never** a moved floor, a raised complexity ceiling, or a widened
  threshold.
- **None of these six rows touches `drizzle-execution-store.ts`.** If any edit reaches
  that file it is out of scope and must be reported: C-4, Q-49, and O-3b all want to edit
  the same 2 119-line file and C-4 wants it split.

---

## A.1 — F-6: uncapped failure-text accumulation in the JUnit adapter

**Row:** `docs/quality/findings-ledger.json:1018-1028`. **Issue:** #12.
**Package:** `packages/reporter`.

Read first, and believe the correction: the code property is real, **the threat model is
not**. `junitXmlAdapter` has **no production call site**. The API's real untrusted JUnit
path is `apps/api/src/routes/reporter.ts:534` `scanTestcases(xml)`, bounded twice
(`MAX_JUNIT_BYTES` at `:538-543`, `MAX_UPLOAD_BYTES` at `:287` via `bodyLimit`) and it
does not accumulate message text at all. Frame the PR as **hardening**, using the
language precedent in row F-7.

**Where the cap goes — `packages/reporter/src/adapters/junit-xml.ts:92-97`**, inside the
two `parser.on` handlers, **not** at `:110`. Capping at consumption leaves the unbounded
string fully materialised in memory, which defeats the point; growth happens at `+=`.

**The trap:** the reset is at `:86-87` inside the `opentag` handler, not in the two
`closetag` branches. A truncated flag must be reset there too, or truncation state leaks
across testcases. State today: `currentText` is per-`<testcase>`, so 10 000 small
testcases are not the vector — a single enormous `<failure>` body is.

**The bar the issue sets: truncation must be *visible*.** There is no existing truncation
convention in the package — no `…`, no `{ truncated: true }`, no `MAX_*` constant anywhere
in `packages/reporter/src`. So the shape must be chosen, and the two candidates are not
equivalent:

- A sentinel suffix on `error.message` — one line, and it makes the string falsely claim
  to be the producer's message.
- **A structured marker: `error.code === 'MESSAGE_TRUNCATED'`.** `AttemptSchema.error.code`
  (`packages/shared-contracts/src/schemas/canonical-reporting.ts:95`) is
  `z.string().min(1).optional()` and **already permits it**. No contract change, and it is
  falsifiable — a consumer can branch on it.

**Take the second.** Silent truncation would be its own defect, and a message that lies
about being the producer's is the same class of problem row F-6's neighbours refuse.

- **Test:** `packages/reporter/src/junit.test.ts` (there is no `junit-xml.test.ts`). A
  fixture with a text node far past the cap must produce a `message` at the cap **and** an
  `error.code` of `MESSAGE_TRUNCATED`; and a normal-length message must come through with
  **no** `code`, so a fix that truncates everything does not pass. Also assert the flag
  does not leak: a truncated testcase followed by a short one in the same document.
- **Calibration:** raise the cap above the fixture and confirm red; drop the `code` and
  confirm red; remove the flag reset and confirm red on the leak case.
- **Ledger:** `status: "fixed"`, `evidence[]` on the adapter and the test, `confirmed`
  already true, and correct the "three test files" claim to two in the summary.

> **Two things the plan did not anticipate, both found by the coverage ratchet.**
> 1. The `append` helper adds a `text`/`cdata` pair and a `truncated` early return. Covering
>    only the `text` path leaves the **CDATA path** able to regrow the unbounded string, and
>    the ratchet caught the uncovered line. Add a CDATA fixture.
> 2. `currentText.trim()` at the `closetag` can shorten a message, so asserting
>    `toHaveLength(MAX_MESSAGE_CHARS)` needs a fixture with no surrounding whitespace. Use
>    `'e'.repeat(200_000)` and keep the fixture size **independent of the exported constant** —
>    a fixture built from the cap fails for the wrong reason when the cap is absent, which is
>    precisely the fail-before evidence you are trying to collect.
>
> Cover the post-cap drop too: a second text event after the ceiling was reached must be
> discarded outright, not appended. That is the assertion that proves the bound is a bound.

## A.2 — W-7: three `formatDate` definitions

**Row:** `:1737-1747`. **Issue:** #11, whose comment carries the mandatory decision.
**Package:** `apps/web`.

The three are genuinely three, and **not interchangeable**:

| file | signature | empty state |
|---|---|---|
| `routes/dashboard.tsx:36` | `(value: string)` | none — cannot be empty there |
| `routes/dashboard/index.tsx:43` | `(value: string \| null)` | `'Not started'` |
| `routes/dashboard/run-detail.tsx:42` | `(value: string \| null \| undefined)` | `'UNKNOWN'` |

`'Not started'` and `'UNKNOWN'` are user-visible claims that mean different things — one
says the run never began, the other says the field is unknown. Conflating them is a
product change disguised as a refactor. **The helper takes the fallback as a parameter.**

- **Helper:** new `apps/web/src/lib/format.ts`. `apps/web/src/lib/` holds only `api.ts`
  and `api.test.ts` today, so this is the only precedent-shaped location and it matches
  `api.ts` being unit-tested alongside.
- **The one call site a straight extraction cannot absorb:** `dashboard.tsx:319` calls
  `formatDate(run.createdAt)` where `createdAt` is a required `string` and there is no
  fallback. Either pass an unreachable fallback or keep a thin non-fallback wrapper. Do
  **not** invent a user-visible string for it; that is the product change the issue warns
  against.
- **Fail-before, per the issue:** assert the helper **forwards** `emptyState` rather than
  hardcoding one. That is the assertion that stops a "fixed" dedupe from quietly turning
  run-detail's `'UNKNOWN'` into `'Not started'`.
- **Byte-identical output:** the issue asks for a snapshot check. There is **no snapshot
  convention in `apps/web`** — no `toMatchSnapshot`, no `__snapshots__`, no inline
  snapshots anywhere, and no existing test asserts any rendered date at all. So do not
  introduce a snapshot framework for this. Assert the helper directly in
  `apps/web/src/lib/format.test.ts`: for a fixed input the output is the same string
  `toLocaleString()` produced, and for each empty value the helper returns the caller's
  fallback rather than any built-in one.
- **Scope fence — not optional:** **leave locale behaviour alone.** Do not introduce
  `Intl.DateTimeFormat` in this PR. It alters rendered output, and bundling it makes a
  pure refactor indistinguishable from a behaviour change while the assertions stop being
  evidence. It is a real improvement and a **separate PR**. The only `Intl.DateTimeFormat`
  in the repository is `apps/worker/src/scheduler.ts:13`, and it sets an explicit time
  zone — that is where the follow-up starts.
- **Coverage:** `apps/web` floor is **96.18 / 88.47 / 96.34 / 98.23** statements/branches/
  functions/lines (`coverage-baseline.json:14-19`). `AGENTS.md` quotes older numbers; the
  ratchet file is the authority. A new `format.ts` must be genuinely covered in this PR.
- **Calibration:** hardcode a fallback inside the helper and confirm the `'UNKNOWN'` call
  site goes red.
- **Ledger:** `status: "fixed"` with evidence on `format.ts` and `format.test.ts`.

> **One thing the plan leaves open, and it is not a detail: W-7's title claims two things.**
> "Three formatDate definitions" and "none of them locale- or time-zone-aware". The dedupe
> lands; **the locale half does not**, and closing the row wholesale records a fix that was
> never made. Split the second half into its own open row (**W-7a**, Minor) and say in W-7
> that the locale change is deliberately deferred. A row is a claim about the code, and a
> title is part of the claim.
>
> The same rule applies to the `dashboard.tsx:319` call site: a local non-fallback wrapper
> is correct, but a test written from the plan's phrase "the helper takes the fallback as a
> parameter" will not compile against it, because that site has no fallback to pass. Pin the
> wrapper's contract too, so the exception is visible rather than looking like a missed
> refactor.

## A.3 — P-62: three hand-maintained event allowlists

**Row:** `:792-802`. **Issue:** #7. **Packages:** `packages/shared-contracts`, `apps/api`.

**This is latent, not live.** All three lists hold the same ten names in the same order
and are not drifted. The defect is what happens to the eleventh.

- Contract: `packages/shared-contracts/src/schemas/execution.ts:459-471`
  (`RunEventTypeSchema`).
- Copy A: `apps/api/src/realtime/realtime-bus.ts:46-56` — a parallel union in
  `CanonicalRealtimeEvent`.
- Copy B: `apps/api/src/routes/execution/schemas.ts:194-205` — `CANONICAL_EVENT_TYPES`,
  typed `ReadonlySet<string>`.

The drift mechanism is exact: `apps/api/src/routes/execution/jobs.routes.ts:71-76` gates
on copy B and then **casts** — `type as CanonicalRealtimeEvent['type']` at `:76`. That
cast exists *only* because copy B is `Set<string>`. Type it `ReadonlySet<RunEventType>`
and the drift becomes a **compile error**. That is the fix.

- Delete the 10-line union in `realtime-bus.ts`; `type: RunEventType`.
- Build copy B from `RunEventTypeSchema.options`.
- Delete the cast at `jobs.routes.ts:76`.
- Keep the `run.phase` → `run.phase_changed` alias at `:71`. Note `run.phase` is **not** an
  enum member, so the membership guard at `:72` is still doing work — do not delete it.

> **CORRECTION — this part did not work as written, and only compiling proves it.**
> "Type it `ReadonlySet<RunEventType>` and the cast is unnecessary" is **not** sufficient.
> `ReadonlySet<RunEventType>.has(string)` does not narrow, so `type` stays `string` and
> removing the cast still fails with `TS2322: Type 'string' is not assignable to type
> RunEventType`. A **type predicate** is required as well:
> `isCanonicalEventType(value: string): value is RunEventType`, because TypeScript only
> narrows through a return type that names the narrowed type. A plain `boolean` return
> leaves the cast necessary and the drift unobservable — the row would read as closed while
> being exactly as unenforced as before.
>
> The fail-before is a **compile error**, not an assertion, and the plan is right that it
> cannot be written as a failing test: remove the cast, watch `tsc` fail, derive the set,
> add the predicate, watch it pass. Do not invent a failing assertion to stand in for it.

**The existing gate cannot catch this and should say so.**
`packages/realtime/src/event-type-ownership.test.ts` is a tree scanner scoped to five
**colon-style** constants read from `schemas/reporter-events.ts`; the dot-style canonical
names are invisible to it. Its own docstring says why: a string is invisible to a
schema-name gate. Extending it is the natural companion and is worth doing in this PR —
with one scoping decision, made during the work:

> **Scope the new gate to the *list* shape, not to every literal.** A gate forbidding every
> dot-style literal outside the contract fails on ~20 files that legitimately construct
> canonical events (the writers in `apps/api/src/execution/`, the runner, the web hooks) —
> that is a different change wearing this one's tests. What made P-62 a defect is not that
> the names appear twice; it is that a **list** of them was maintained by hand beside the
> contract. So: fail on a `new Set([…])` holding two or more canonical names.
>
> **Build that scan without a regex.** `/new\s+Set\s*(?:<[^>]*>)?\s*\(\s*\[/g` is a nested
> quantifier — an unbounded `[^>]*` between two `\s*` runs — and `security/detect-unsafe-regex`
> correctly refuses it. Bounding the inner quantifier does **not** help; the ambiguity is
> between the adjacent `\s*` runs. Use a hand-written walk. It also pushes the file over the
> complexity gate, so split the per-file work into its own function rather than re-baselining.
- **Fail-before, per the issue:** a test that adds a name to the schema and asserts both
  derived values include it. Without the derivation **that test cannot be written**, which
  is itself the proof — record that fact rather than inventing a failing assertion.
- **Ledger:** `confirmed` already true; correct the `durable-realtime.ts` citation to
  `durable-realtime-bus.ts` and name `apps/web/src/lib/api.ts:540` as the real derivation
  precedent.

## A.4 — P-63: duplicated health and agent error bodies

**Row:** `:804-814`. **Issue:** #8. **Package:** `apps/api`.

Two separate duplications, and the second has a trap the issue is explicit about.

**Health (`routes/health.ts:18-24` and `:26-33`).** These differ only by `version: '1'`,
**and the difference is deliberate and test-locked**: `health.test.ts:55-69` asserts
`plain['version']` is `undefined` and `versioned['version']` is `'1'`, with a comment
saying this is stated *so that harmonising them is a decision somebody makes rather than
a diff*. The codebase already knows the pattern at `:35-58`, where the readiness handler
is one function bound to both paths and `health.test.ts:226-230` enforces byte-identical
output.

- **Do not harmonise the two bodies.** Extract one factory parameterised by the version
  flag, so consolidation is a pure no-op and the existing test still passes. If it does
  not still pass, the test caught a behaviour change you did not intend.
- Leave the `timestamp` asymmetry alone for the same reason (`health.test.ts:217-231`).
- Consumers of `/api/v1/health` that would notice a shape change: `playwright.config.ts:119`,
  `performance/smoke.js:53`, `scripts/performance-server.mjs:126`, `infra/compose/compose.dev.yml:92`,
  `apps/api/src/index.test.ts:39-40,419-420`, `apps/api/src/routes/rate-limit-contract.test.ts:67,73`.

**Agents (`routes/agents.ts`).** **Four** literals, not three, in three distinct shapes:
`:21-29` (404 `AGENT_ROUTE_NOT_FOUND`), `:31-41` (501 `AGENT_NOT_CONFIGURED` with
`domain`+`action`), `:46-54` (404 `AGENT_UNKNOWN`), `:55-64` (501 `AGENT_NOT_CONFIGURED`
without `action`).

- **Trap:** these are **flat** — no `error` wrapper, no `requestId`, no nesting. So
  `domainErrorResponse` (`errors/boundary.ts:47-49`) is **not** a drop-in, and using it
  would change the wire shape. It is *also* wrong on status: 501 is `>= 500`, so
  `DomainError.toBody` would replace every message with `'internal error'` and drop
  `details` unless each error is built `callerSafe`. **Use a local `agentError(...)`
  factory**, not the boundary.
- Key order is `status, implemented, code, …` — **not** alphabetical. A builder that
  sorts keys changes bytes.
- `agents.test.ts` asserts status codes and `integrations.length === 5`, never an exact
  body. Nothing in `apps/web` reads these bodies at all. So a builder is free on key
  order, and free on body shape **only** because there is no consumer — which is the
  argument to preserve the shape deliberately rather than "clean it up".
- **Fail-before:** assert the four failures share one builder, and that the two health
  paths differ only by `version`.

## A.5 — F-4: two reporter adapters build test ids from different key pairs

**Row:** `:984-994`. **No issue exists** — issue #6 lists W-8 here, and W-8 is already
`fixed`; F-4 was never opened. **Open one, or do not close the row quietly.**

Read the row's own correction first: the differing key pairs are real
(`junit-xml.ts:121` `${classname}:${name}`; `playwright-json.ts` `${spec.file}:${title}`)
but **the claimed consequence is not demonstrable**. `canonical-run-result.ts:117-131`
maps attempts 1:1, `RunResultSchema.attempts` has no dedup and no `superRefine`, and
**no consumer anywhere groups or de-duplicates by `testId`**. So the real defect is a
**non-unique identity** — a hazard for the next consumer, not a live collision.

Verified, and this shapes the decision:

- `AttemptSchema.testId` is `z.string().min(1)` — floor only, no pattern, no max.
- **No unique index on `test_id` anywhere.** `results` has `results_test_id_idx` and
  `results_run_id_test_id_retry_idx` (`schema/dashboard.ts:380-385`), both plain
  `index`, not `uniqueIndex`.
- `apps/runner/src/playwright-reporter.ts:42,52` uses `test.id` — Playwright's own opaque
  id, so there are **three** vocabularies in play, not two.
- `apps/api/src/repositories/in-memory-run-repository.ts:109-111` keys a Map on
  `` `${testId}::${runId}` `` and its `patchTest` **silently no-ops on a missing key**
  (`:90`) — the one place two same-`testId` rows in a run would already merge.
- `testId` is user-visible: it appears in `run-detail.tsx` test rows and in
  `data-testid={\`test-${testId}\`}`, asserted at `run-detail.test.tsx:59,292,311`.
  Evidence URIs use the ordinal, not `testId`, so they are insulated.

**Recommended, and it is a judgement to state rather than hide: re-band rather than
change the contract.** Making `testId` a namespaced composite buys nothing observable
today, is a visible change to an evidence UI, and the only demonstrated consumer is the
in-memory store's silent no-op. Two honest options, pick one and say which in the row:

- **(a)** Narrow the row to the demonstrated defect — two attempts in one run carrying the
  same `testId` — and record that the reported consequence was wrong, with
  `canonical-run-result.ts:117` as the refuting line. Then either add a `superRefine`
  uniqueness check on `RunResultSchema.attempts` (a real, testable constraint) **or**
  re-band to Minor as an accepted hazard.
- **(b)** Add the uniqueness check only, leaving the key pair alone.

> **CORRECTION — the "uniqueness check" in (a) and (b) is not implementable as written, and
> it would have shipped a regression.** Both options specify uniqueness on `testId`. But a
> **retried test is one test with several attempts sharing a `testId`**: `playwright-json.ts`
> emits one attempt per `test.results` entry with `index: attemptIndex + 1` and the same
> `testId`, and JUnit says the same thing with `flakyFailure` / `rerunFailure`. A `superRefine`
> demanding distinct `testId`s **rejects every flaky run** — a normal case, not an unlucky
> one. This is not a stylistic quibble; it is the row closing itself with a break.
>
> **The rule that is actually enforceable: for each `testId`, the attempt `index` values must
> be exactly 1..n.**
> - A retry satisfies it by construction.
> - Two *distinct* tests that collided on an identity both arrive as attempt 1 — the adapters
>   number `index` per test — so the group reads `[1, 1]` and is refused.
> - It also catches a **gap** (attempts 1 and 3), which a `Set`-size check would miss.
>
> The identity a consumer can rely on is therefore the pair `(testId, index)` — which is what
> makes that pair an identity rather than a coincidence. That is option (b) with the rule
> corrected, and it is what landed.
>
> **One residual is real and cannot be fixed by any contract rule — state it, do not hide it.**
> A collision that happens to arrive as attempts 1 and 2 is byte-identical to a genuine retry.
> Separating them would require the difference to be carried in the `testId` itself, which is
> the namespacing this row deliberately declined. Cover it with a test that asserts the limit,
> so the next reader knows it was considered.

**The corrected rule found a second, unlisted defect — expect this, and read the reds.**
`junit-xml.ts` numbered attempts `index: index + 1` as a **running ordinal across the whole
document**, while `playwright-json.ts` puts the attempt's ordinal *within one test*, and
`components/dashboard/RunExplorer.tsx:36` renders the field as "attempt N". So a JUnit run
whose second testcase failed claimed its only attempt was attempt 2, and a consumer keying on
`(testId, index)` had **no consistent identity across the two producers**. Four
`adapter-parity.test.ts` cases went red on the new rule *before* anyone understood why. Fixed
to `index: 1` — one `<testcase>` is one test with one attempt.

**Do not trust a green suite here.** The reporter suite passed with the wrong ordinal for as
long as the contract permitted it; only the new rule exposed it. A rule that is correct and a
suite that is green are different claims, and the difference between them is the whole point
of A.0.1.

**Fail-before if (a) or (b):** with the corrected rule, the falsifiable assertions are —
a retried test's attempts sharing one `testId` is **accepted**; two distinct tests colliding
on one `testId` are **refused**; a gap in one test's attempt sequence is **refused**. The
first is the counterweight: without it, a fix that simply forbade repeats would pass.

**Also unlisted in the original, and still outstanding:** this row has **no issue at all**
(issue #6 lists W-8, already `fixed`). Open one before closing F-4 — the plan's own warning,
still unheeded.

## A.6 — P-72: the dev installation key

**Row:** `:675-682`. **Issue:** #9. **Package:** `apps/api`.
**This is the only row of the six with no `confirmed` field, and the only one that is a
decision.** Issue #9 asks the contributor to state which reading they took rather than
picking silently. Take the reading explicitly, in the row, before writing the fix.

Verified facts:

- `apps/api/src/index.ts:71` — `const installationId = '00000000-0000-4000-8000-000000000001'`.
- `apps/api/src/index.ts:247-253` — `ensureBootstrap({ installationId, keyHash, displayPrefix: 'dev' })`
  runs **unconditionally whenever a database exists**.
- `ensureBootstrap` is at `packages/db/src/repositories/installation-key-repository.ts:84-123`;
  four call sites total, and **no test anywhere asserts the literal `'dev'`**.
- **`display_prefix` is write-only.** `findUsable` (`:139-153`) selects only
  `keyHash, revokedAt, expiresAt`. No API route, no `apps/web` code, no audit row, no UI
  reads it. **Renaming it is behaviourally free.**
- The credential's real identity is `hashCredential(authCookieSecret, installationKey)`
  at `:250`; `displayPrefix` is a cosmetic label on a DB row.
- **No config surface carries this.** `AppConfig` has no `installationId` and no prefix
  field; the only install-adjacent field is `installationApiKey` ← `AUTOMATE_API_KEY`.

**The two readings:**

- **A — mislabel.** A hardcoded cosmetic label lands on a production row. Fix: make it
  explicit or configurable. Zero behavioural risk, trivial test.
- **B — missing environment discrimination.** The title is *"Every deployment records a
  dev installation key."* On this reading the defect is that `ensureBootstrap` is called
  in production at all, deriving a bootstrap credential on every boot. Fix: gate the call
  on `nodeEnv` or an explicit opt-in. Materially larger and riskier — it changes what
  production does on first boot.

**Recommended: A, and record the B-shaped half as its own follow-up row.** The code
supports A and A is free. Doing B in a "good first issue" PR would ship a change to
production bootstrap behaviour without the review it deserves. **If you choose B, the PR
must say so and must be reviewed as a production-behaviour change, not as a
`good first issue`.**

Also in `index.ts`, per the issue and the row: `let sessionBackend;` at `:236` has no
type annotation. It infers `DrizzleAuthSessionBackend | undefined` from the branches, which
is why `noImplicitAny` passes — but it should be declared. Same commit.

**Fail-before:** assert the bootstrap identifier and prefix are what configuration says
they should be, and that a production composition root does not write `'dev'`.

> **Two corrections found in the work, both about reading the plan literally.**
> 1. **`:247-253` is wrong; the call is at `:251`.** The plan's own A.0 says so and A.6
>    repeats the old number anyway.
> 2. **`NODE_ENV` spells the value `development`, not `dev`.** If the fix is
>    `bootstrapDisplayPrefix(config) → config.nodeEnv`, then the "keeps the dev label where
>    the dev label is true" assertion expects `'development'`. The column is write-only, so
>    the full name costs nothing and reads unambiguously beside it — but a test written from
>    the plan's wording will fail on a correct implementation.
>
> **A trap the plan missed:** `parseConfig` defaults to `requireProductionSecrets: true` for
> `NODE_ENV=production`, so a config-driven test that calls `parseConfig({NODE_ENV:…})` for the
> production case **throws `COOKIE_SECRET is required`** before the assertion runs. Pass
> `{ requireProductionSecrets: false }` explicitly, as `index.test.ts` does elsewhere.

**What landed:** `apps/api/src/bootstrap-display-prefix.ts` exporting
`bootstrapDisplayPrefix(config) → config.nodeEnv`, called at the composition root, with the
Reading-B deferral stated in the row's summary rather than only in a PR description.

---

## A.7 Gate sequence — after each row, not at the end

```bash
pnpm --filter <package> test   # writes coverage provenance
pnpm typecheck
pnpm lint
pnpm complexity                # must not increase
pnpm coverage:ratchet          # floors only go up
pnpm findings:check
```

Then `pnpm findings:baseline` **once** per row, after the status genuinely changes — never
as a way to quiet a failing check. One commit per row, conventional style, **lowercase
subject**; commitlint rejects an all-caps token. Push when that row's gates are green.

`pnpm security:static` hangs on a Windows host (G-4b). Run it on CI or in WSL; do not
weaken the ruleset for one machine.

**If a branch turns out to be unreachable, delete it and say why** — do not write a test
that cannot fail. `CONTRIBUTING.md` is explicit that an unreachable guard is untested or
tested by an impossible construction, and both are worse than no test; the repo has
removed several on exactly that reasoning and records each removal in the ledger.

### A.7.1 Three operational notes, all learned the hard way

**1. `pnpm test` is load-flaky on this host, and it is pre-existing.** Under full parallelism
two suites fail on 5s test timeouts — `contract-tests/format-glob-coverage.test.mjs` and
`runner-sdk/src/spool.test.ts` — and both pass in isolation and on re-run. This reproduced on
clean `HEAD`, so it is not something a change introduced. **Re-run before believing it, and
never "fix" it by raising a timeout** — that is weakening a gate to quiet a machine.

**2. A failed full run leaves coverage provenance stale, and the ratchet then blames you.**
`coverage:ratchet` refuses a summary with no `provenance.json` beside it. After a flaky full
run, re-run the affected package's tests with `--coverage` before concluding the ratchet is
red. The message ("Re-run this package's tests with --coverage") is accurate — follow it
rather than investigating your diff.

**3. `| Select-Object -Last N` in a chained command can truncate the pipeline and break the
`&&` chain** that writes provenance. A "failed" package whose tests all passed is usually this,
not a test failure. Re-run the package on its own before investigating.

---

# PART B — The connector release

**Hero:** a run that ends produces a GitHub check + a Slack summary + a Jira ticket for
each newly-failing test, with no glue config beyond four environment variables.

**What this version is:** Part A closed the cheap rows. The rest of the open ledger does
**not** belong here. The blocking band (RF-5, X-4) does **not** belong here. They stay
open, in writing, as a published backlog.

## B.0.0 Part B is three releases wearing one version number

The original plan interleaves three kinds of work that have nothing in common but a
version number. They need different review, different evidence, and — for the last one —
different permission:

| Track | What it is | Risk | Review size |
|---|---|---|---|
| **B1 — the runtime** | Wire already-tested adapters into a route module and a delivery policy. Six adapters, a config block, an `auditEvents` row. | Low. Nothing existing changes behaviour; the failure mode is contained by B1.4 | Normal PR review, gate-driven |
| **B2 — the product** | A page, a hook, a run-detail control, a ⌘K action | Medium. `apps/web` is the strictest-covered package and this is user-visible | Normal PR review, needs the three-states requirement honoured |
| **B3 — the adoption surface** | Compose, seed, README, landing page, docs, **and a `3.0.0` tag** | **Highest.** A tag is irreversible; a README is unmeasured | Different reviewer. **The tag needs explicit sign-off, not a green CI** |

**Why the split matters practically, not just tidily:**

- **B1 is worth doing even if B2 and B3 are cut.** It is the hero, it is the cheap part, and
  it is fully covered by gates. If time runs out, cut B3 first — never B1.
- **B3.6 should not be in the same reviewable unit as B3.5.** A documentation rewrite and a
  release tag have opposite risk profiles: the first is trivially revertable, the second is
  not. Shipping them together means the risky one inherits the momentum of the safe one.
- **The original plan's ordering puts the tag after the demo works, which is right.** Keep
  that ordering and make it explicit, because it is the one thing ordering actually protects
  here: the tag is downstream of every gate, so it can only ever be pushed onto a state that
  already passed.

**Do B1 → B2 → B3.1 → B3.2 → B3.3/B3.4/B3.5 → B3.6, and re-decide the scope at each
boundary.** If the ten-minute measurement above is not met by the end of B3.1, that is
information worth having before the README and the landing page make claims resting on it.

## B.0 Current state, stated honestly

What ships today is the reporter → PostgreSQL → authenticated SSE → React evidence
vertical slice, plus a working Playwright runner. That is a genuinely good product core
and it is tested (`e2e/product/reporter-run-lifecycle.spec.ts`).

What is *built but unwired*, and therefore nearly free to finish:

| Asset | Path | State |
|---|---|---|
| GitHub / Jira / Slack adapters | `packages/connectors/{github,jira,slack}/src/index.ts` | 100/100/100/100 coverage, zero API routes |
| Connector SDK | `packages/connectors/sdk/src/index.ts` | retry policy, refusal-vs-error semantics, abort threading |
| `vaultEntries` table | `packages/db/src/schema/vault.ts:25-61` | migration `0020` applied, no writer |
| AES-256-GCM seal/open | `apps/api/src/infrastructure/vault-crypto.ts` | row bound as GCM AAD |
| `ConnectorConfig` contract | `packages/shared-contracts/src/schemas/connectors.ts:28-35` | schema with no route and no table behind it |
| `connectors:manage` scopes | `packages/shared-contracts/src/schemas/auth.ts:33-34` | declared, never checked |

That table is why this is affordable. Six already-tested adapters are being plugged into a
route module, not a framework being built.

### B.0.1 Three traps in the existing code, read before you start

1. **`manifest.operations[*].timeoutMs` is decorative.** It is asserted in tests and
   `executeWithRetry` never receives it (`packages/connectors/sdk/src/index.ts:187-207`).
   A route that trusts it will hang to the 30s request deadline. B1.2 fixes this at the
   SDK, once, for all three adapters.
2. **`fetch` is a hardcoded global in all three adapters**; only `vi.stubGlobal` reaches
   it. An E2E test cannot intercept it. B1.1 adds the seam the SDK was missing.
3. **The Slack adapter treats HTTP 200 as possibly-failure** (`slackRefusal`,
   `packages/connectors/slack/src/index.ts:223`) — it maps `ok:false` to 429/400. Any
   delivery-record logic that keys on HTTP status will be wrong for Slack. **Key on
   `result.status`, never on the transport.**

## B.1 Wave A — Connector runtime (API only, no new user-visible page yet)

### B1.1 Make the adapters testable and bounded

- Add an optional `fetchImpl` to the SDK request contract so E2E and the delivery loop
  can intercept outbound HTTP without patching a global. Thread it into all three
  `await fetch(` sites. **Guard:** `connector-dispatch.test.ts` asserts every
  `await fetch(<arg>,` first argument matches `/operation|path|url|base|API/` — keep the
  argument name, change only the second parameter.
- Enforce `timeoutMs` in `executeWithRetry` with an `AbortController` composing with the
  caller's `signal`, and pass `spec.timeoutMs` at all three call sites. Test that the
  deadline fires against an injected `sleep` before the first retry.

### B1.2 Add the operations the product needs

Each must satisfy the existing **set-equality source test** — a new key must appear in
**both** `manifest.operations` and the `const OPERATIONS` record, or
`connector-dispatch.test.ts` fails:

- github: `listPullRequests`, `createCheckRun`, `updateCheckRun`, `getCommit`
- slack: `listChannels`
- jira: `listIssueTypes`

Set `idempotent` honestly. `createIssue` stays `idempotent: false`; `updateCheckRun` is
`idempotent: true`.

### B1.3 Route module

New `apps/api/src/routes/connectors.routes.ts`, following the factory pattern of
`routes/agents.ts` (sub-app factory, full `/api/v1/...` path inside, mounted at `'/'`).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/integrations` | each connector's configured/unconfigured state, env var **names** only |
| `POST` | `/api/v1/integrations/:name/test` | run the adapter's `authTest`, return ok/failure code |
| `GET` | `/api/v1/runs/:runId/integrations` | delivery history from `auditEvents` |
| `POST` | `/api/v1/runs/:runId/share` | `{ targets: ['github','slack','jira'] }`, on-demand fan-out |

- **No auth middleware change.** The global middleware defaults to protected
  (`apps/api/src/index.ts:338-346`); `PUBLIC_PATHS` only needs extending if something
  must be public.
- Read `ws` via the `ExecutionRouteContext` pattern
  (`routes/execution/shared.ts:81-83`) and pass it as the first store argument, as
  `artifacts.routes.ts:27` does.
- `throw new DomainError(code, message)`. A new `ErrorCode` **requires** a
  `STATUS_BY_CODE` entry — that record is exhaustive, and the compile error is the
  intended enforcement.
- **Add every new `(method, path)` to `CANONICAL_API_ROUTES` in
  `apps/api/src/routes/route-manifest.test.ts:144-217`.** It asserts set equality with the
  app's real route set *and* registration order. Forgetting it is the likeliest CI failure
  in this wave.
- `index.test.ts:386` asserts `GET /api/v1/connectors` → 401. That path is not ours; our
  paths are `/api/v1/integrations*`. Keep that assertion.
- **Never log a token.** `/test` returns the adapter's `error.code` and nothing from the
  underlying body. Do not defeat the adapters' existing no-leak rule.

### B1.4 Delivery policy

New `apps/api/src/modules/integrations/`:

- `resolveTargets(config, run, diff)` → GitHub check when a commit SHA is present, Slack
  on `failed`, Jira per **newly**-failing test signature. Reuse the existing
  `digestRunOutcome` canonical digest rather than inventing a signature.
- `deliver(target, payload)` → one `execute(request, secret)`, then one `auditEvents` row
  `{ connectorName, operation, outcome, code, attempts }`. The secret is read at call
  time and never written to the audit row.
- `createIntegrationTriggers(hooks)` → invoked from the run-end ingestion path in
  `apps/api/src/services/drizzle-reporter-ingestion.ts`. **Fire-and-forget with explicit
  containment**: an `await` there would let a Slack outage fail a test ingestion. The
  whole fan-out can only ever append an `auditEvents` row.
- **No outer retry loop.** `jira.createIssue` and `slack.postMessage` are non-idempotent
  and the SDK already declines to retry them on a 502. An outer retry double-files tickets.

### B1.5 Config

Follow the five-step pattern in `packages/config/src/config.ts` exactly, in order —
**omitting step 2 is a compile error**, which is the enforcement:

1. `SecretVariable` union, `:19-26`
2. `EXACT_PLACEHOLDERS`, `:38-46` (a `Record<SecretVariable, readonly string[]>`)
3. `EnvironmentSchema`, `:87-113`, via `secretSchema('…').optional()`
4. `AppConfig`, `:115-141`
5. the returned literal in `parseConfig`, `:158-192`

| Variable | Secret? | Notes |
|---|---|---|
| `GITHUB_TOKEN` | yes | `GITHUB_OWNER` / `GITHUB_REPO` plain optional |
| `SLACK_BOT_TOKEN` | yes | plus `SLACK_DEFAULT_CHANNEL` (plain) |
| `JIRA_BASE_URL` | no | `z.string().url()` |
| `JIRA_EMAIL`, `JIRA_API_TOKEN` | email plain / token yes | |
| `JIRA_PROJECT_KEY`, `JIRA_ISSUE_TYPE` | no | plain, defaulted |

All secrets inherit `SECRET_MIN_LENGTH = 32` from `secretSchema`. `apps/api/src/startup-policy.ts`
shares that constant — no second floor. Document each in `.env.example` and the README table.

## B.2 Wave B — The page a stranger actually looks at

### B2.1 `/dashboard/integrations`

- Add the route file, the `router.ts` `dashboardTree` child, **and** the
  `route-manifest.ts` entry. `router.ts:19-28` records that `/dashboard/quarantine` once
  existed in the tree and not in the manifest (W-8); both files, every time.
- `visible: true` so the Sidebar picks it up — `components/Sidebar.tsx:39` iterates
  `visibleRoutes`; there is no second list to edit.
- Copy the quarantine form end to end, the only working form in the codebase:
  `routes/dashboard/quarantine.tsx:72-137` → `hooks/useDashboard.ts:295-328` →
  `lib/api.ts:475-495` → `modules/dashboard/quarantine.ts:204-222`.
- Export the page component separately with an injected `api` client, as
  `QuarantinePage({ api })` does.
- Every new method goes on the `ApiClient` interface (`lib/api.ts:234-253`) **and** on
  `defaultApiClient` (`:384`), or the page does not compile.
- Hooks follow the five rules in `hooks/useRuns.ts`: defaulted `api` parameter,
  `useRequestLifecycle`, `begin()` → signal, `isAbortError` swallowed rather than set as
  error, `cancelAll()` on cleanup.
- Zod schemas in `lib/api.ts`, parsed through the existing `getJson(path, schema, options)`.
  Do not hand-roll a fetch.
- **Three states, all required:** unconfigured (which env vars are missing, by name),
  configured-but-failing (the adapter's error code), connected (with `lastVerifiedAt`). A
  page with only the happy state is a lie.
- Add a `CommandAction` via `useCommandActions` for the ⌘K palette, and a `data-testid` on
  every element E2E will assert.

### B2.2 Run detail integration

On `/dashboard/runs/:runId`: a **Share this run** control (Slack / GitHub / Jira) and a
delivery-history strip from `GET /api/v1/runs/:runId/integrations`, showing each attempt
and its code. This is the demo moment: click, see Slack.

## B.3 Wave C — The adoption surface

### B.3.1 One command

- `docker compose -f docker-compose.unified.yml up -d` must be the whole install and must
  reach a green health state with no manual `.env` editing. Add a checked-in
  `docker-compose.quickstart.yml` with development-only placeholders, plus a
  `pnpm quickstart` script that generates a random 32+ char secret set and writes
  `.env.quickstart`, refusing to overwrite an existing one.
- Keep the canonical compose file untouched. The quickstart file is additive and
  documented as a demo path, not a production topology.
- `pull_policy: never` is a first-run blocker. Either vendor a `pnpm quickstart:images`
  or pin and document. **Pick one** — do not leave a stranger with a compose error.
- The zero-database sample on port 3456 stays; it is the fastest path to the dashboard.

### B.3.2 Seeded demo workspace

`pnpm demo:seed` posts a realistic 30-run, 3-suite history through the **existing
reporter ingestion boundary** — the same path `e2e/support/api.ts` uses. Not direct SQL. A
demo that seeds behind the product's back breaks silently on the first migration.

### B.3.3 README, honestly

- Rewrite the top third: what it is, a 90-second quickstart, the four env vars, a diagram
  of the GitHub/Slack/Jira flow.
- **Rewrite the capability table.** `README.md:52-56` still says "Local only" and
  "Boundary only" and describes a process-local realtime bus. A stranger who reads it
  concludes the product is a toy. Say what is real, specifically.
- Add a **"Not yet"** section: the open findings by name, RF-5 and X-4 stated plainly.
  Publishing the backlog persuades a senior engineer more than a clean-looking README, and
  AGENTS.md already demands evidence before claims.
- `CHANGELOG.md` is 13 lines. Write a real 3.0.0 entry.

### B.3.4 Landing page

A single static `apps/web/src/routes/landing.tsx` served **unauthenticated** at `/`: a
working demo link, an architecture diagram, the honest "not yet" list. Requires adding the
path to `PUBLIC_PATHS` (`middleware/auth.ts:27-39`) and to both route manifests.
Default-deny is the right posture; make this one addition deliberately and comment why.

### B.3.5 Documentation that exists

- `SECURITY.md`, `CONTRIBUTING.md` (expand the README's 5 rules), `CODE_OF_CONDUCT.md`.
  Trivial, and their absence is a visible signal to a prospective contributor.
- `docs/getting-started.md` — a real tutorial, separate from the reference README.
- **Regenerate `docs/migration/capability-register.md`** (`pnpm docs:capability-register`).
  It is currently **stale against the tree**: it still claims the runner Dockerfiles are
  no-op stubs, and `infra/docker/runner.Dockerfile` now installs three browser engines. It
  is the declared source of truth; a stale source of truth is worse than none.
- **Resolve the PRD contradiction.** `docs/PRD_QAce_Ecosystem_v2.md` describes Gemini,
  Allure, Grafana, Bruno, Maestro, ZAP, and Docusaurus — a different product from the one in
  this tree. Either mark it explicitly superseded at the top or delete it. Leaving it is
  the most credibility-damaging artifact in the repo.
- Open the missing F-4 issue (A.5) and fix issue #6, which lists **W-8** as a good first
  issue when W-8 is already `fixed`.

### B.3.6 Publication

`origin` exists: **`https://github.com/Sergey-Bar/AutoMate.git`**. A working tree of
commits is visible; a *release* is not — there is no tag, no release workflow run, and
`CHANGELOG.md` is 13 lines. So the task is not "create a remote", it is: tag `3.0.0`,
write the release notes from the ledger, and confirm `pnpm verify:release` green.
`verify:release` adds `oci:verify`, and all three runner manifests ship `unbuilt` /
`imageDigest: null` — so either build and digest-pin, or state in the release notes that
images are built from source.

## B.4 Validation

Per repo rules: no `.skip`, no `.only`, no deleted tests, no lowered floor. New files land
in the **two strictest packages** — `apps/api` at 95/86/95/97 and `apps/web` at
96.18/88.47/96.34/98.23. The connector packages being at 100% does not help here.

| Task | Evidence required |
|---|---|
| B1.1 | adapter test injecting `fetchImpl`, asserting zero calls to the global `fetch` |
| B1.1 | timeout aborts **before** the first retry, via injected `sleep` |
| B1.2 | manifest/`OPERATIONS` set equality — enforced by `connector-dispatch.test.ts` |
| B1.3 | 401 unauthenticated; workspace arg passed to every store call; `DomainError` per failure path |
| B1.4 | **ingestion completes and the run is `failed` even when every connector throws** |
| B1.5 | `parseConfig` accepts a full set, rejects a 31-char secret, rejects each placeholder by name |
| B2.1 | page renders all three states; `ApiClient` and `defaultApiClient` both carry the method |
| B2.2 | `data-testid` present; delivery strip renders a failed attempt with its code |
| B3.1 | `compose:config` resolves the quickstart file; a cold `up` reaches healthy with no manual edit |
| B3.2 | seed is pure ingestion — assert no direct SQL/drizzle import in it |
| B3.5 | `capability-register.md` regenerated and no longer contradicts the tree |
| **all** | **the ten-minute claim is measured, not asserted** — see the measurement table at the top; a claim with no number behind it is a wish |
| **all** | **every README capability claim cites a test path or an evidence path**; a claim with neither is cut, not softened |

**E2E:** new `e2e/product/connector-delivery.spec.ts`, following
`e2e/product/reporter-run-lifecycle.spec.ts` — seed via `postReporterEvent`, assert at the
API before opening a page, `authenticate` once per worker (login is rate-limited to
5/min), then drive the browser and save evidence. Requires `DATABASE_URL`.

**Known local-host limitation:** G-4b — `security:static` (semgrep/gitleaks) does not
complete on the Windows dev host, so `pnpm verify` cannot go fully green there. Record the
semgrep step as host-blocked; do not weaken the gate. The full gate must be green in CI,
which is where this version is actually validated.

## B.5 Out of scope, stated so it is not silently re-added

- The remaining open ledger rows, and the blocking band (RF-5, X-4) — deferred and
  published as a backlog.
- `vaultEntries` persistence and `vault-crypto.ts` — the table stays unused. This is the
  largest single scope reduction in the plan and it is reversible: a later version writes
  to a table and a crypto path that already exist.
- AI gateway (X-4), a CLI, npm publish, RBAC/SSO, mobile, Redis/Kafka/K8s, MCP, Tauri.
- Multi-instance SSE durability and production secret rotation.
- The W-7 locale change (separated out in A.2, deliberately) — now tracked as its own open
  ledger row, **W-7a**, so it is not re-added silently.
- P-72 Reading B (recorded as a follow-up row in A.6) — now **P-72b**, with the four
  questions a fix has to answer written into the row.

**One carry-over that Part A did not finish, and it is the only outstanding Part A debt:**
**F-4 still has no issue.** Issue #6 lists W-8, which is already `fixed`. A.5 says to open
one before closing the row; the row was closed and the issue was not opened, so it is
recorded here rather than lost. It is a two-minute fix and it is the only thing standing
between "Part A is finished" and "Part A is finished".

## B.6 Risks

**Code risks.** These are the ones the original plan listed, and they are the *easy* half.

| Risk | Response |
|---|---|
| A new connector operation breaks `connector-dispatch.test.ts` source scan | Add both manifest and `OPERATIONS` entries together; the test is the spec |
| W-7's helper silently changes what two screens render | The forwarding assertion in A.2 is the specific guard; it is the reason that test exists |
| F-6 truncates silently | `error.code === 'MESSAGE_TRUNCATED'`, plus a normal-length counterweight case |
| P-72 chosen reading is wrong | Stated in the row and in the PR description, per issue #9 |
| `apps/web` coverage ratchet blocks the W-7 refactor | The new `format.test.ts` covers it on the same PR. **Do not lower 98.23** |
| A connector outage fails test ingestion | B1.4 containment; the B1.4 fail-before test asserts the run still ends |
| Duplicate Jira tickets | No outer retry loop; rely on the SDK's idempotency gate |

**Release and product risks — the half the original plan omitted, and the more dangerous
one.** Every row above is caught by a test. None of these is.

| Risk | Why it is not a test problem | Response |
|---|---|---|
| **The tag is the only irreversible step in the plan** | `git tag 3.0.0` and a pushed release cannot be undone by a revert | Tag **last**, after `verify:release` is green, and say so in the task order. Do it in a commit of its own so the tag points at a state that passed every gate |
| **`verify:release` has never been observed green** | It adds `oci:verify`, and all three runner manifests ship `unbuilt` / `imageDigest: null` — so it is currently expected to fail for a reason unrelated to this work | Run `pnpm verify:release` **before** writing B3.6, not after. If it cannot pass, B3.6 is not ready to start |
| **The README rewrite is the highest-leverage and least-tested artifact in the plan** | A README that overstates is not caught by any gate; it is caught by a reader | Every capability claim cites a test or an evidence path. A claim with no evidence is cut, not softened |
| **The landing page makes the same claims in a stranger's first ten seconds** | Same reason, worse audience | It must not assert anything the README's evidence does not already support |
| **The demo depends on three third-party services being reachable** | Network, rate limits, and token expiry are outside the test suite | The demo degrades to "unconfigured, here is which env var is missing" — which is why B2.1's three states are all required, not just the happy one |
| **A seed that breaks silently on the next migration** | The seed runs against the real ingestion path, so a migration can invalidate it without failing a gate | B3.2's "assert no direct SQL/drizzle import" is the guard; keep it |
| **The quickstart compose file drifts from the canonical one** | Two compose files, one documented as a demo path, and nothing asserts they agree | State the divergence in the file's own header comment, and have B3.1's evidence assert the quickstart file resolves |
| **A stranger's first failure is a 401 or an empty database, not a connector** | The ten-minute promise is about the path *to* the dashboard, not the connectors | B3.1's cold `up` evidence is the first thing to demonstrate, before any connector work |
| **`pnpm test` flakes on the dev host and someone "fixes" it with a timeout** | It is a load artifact, and raising a timeout is weakening a gate | A.7.1 records it. The fix is CI, not a bigger number |
