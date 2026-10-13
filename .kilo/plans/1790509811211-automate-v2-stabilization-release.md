# Automate v2.0.0 — Stabilization, Quality and Release Plan

**Path:** `.kilo/plans/1790509811211-automate-v2-stabilization-release.md`
**Target:** `1.0.0` → `2.0.0`, tag `v2.0.0`
**Supersedes:** `.kilo/plans/1790482134837-automate-merged-leftover-plan.md` ("Automate v3"). This plan adopts its waves W0–W17, **corrects** them, and adds five. Where the two disagree, this plan wins. The v3 plan is kept as the record of what was known on 2026-09-27, not as an executable document.

**Rule, unchanged:** nothing is done without executable evidence. A mock, static response, in-memory store or unwired adapter is `not_configured`, never a pass. **A gate that cannot fail is a defect.** "10/10" is not a criterion and appears nowhere in this plan; §1 is its executable replacement.

---

## 1. Release definition

`v2.0.0` ships when all eighteen are true. Each is a command or a recorded artifact, not a judgement.

### Product integrity

| # | Criterion | Command | Today |
|---|---|---|---|
| R1 | Full gate chain green | `pnpm verify` | unverified on this host (G-4b) |
| R2 | Zero open ledger rows | `pnpm findings:check` | 89 open |
| R3 | Every `fixed` row's evidence path exists | `pnpm findings:check` | 15 fixed, all with evidence |
| R4 | End-to-end on real PostgreSQL, no in-memory store on the path | `pnpm test:e2e` | needs `DATABASE_URL` |
| R5 | The three runner images actually execute | `pnpm oci:verify` | three no-op stubs |
| R6 | Every capability row is `real`, or carries a written justification | `pnpm docs:check` | **script does not exist** |
| R7 | A post-migration database was restored and re-opened every encrypted row | `pnpm migrate:rehearse` | **harness does not exist** |
| R8 | No floor regressed, none lowered | `pnpm coverage:ratchet && pnpm complexity` | green |

### Quality (the QA sweep)

| # | Criterion | Command | Today |
|---|---|---|---|
| R9 | E2E green on **three** engines | `pnpm test:e2e:matrix` | Chrome only |
| R10 | E2E flake rate inside a recorded SLO over 20 consecutive nightlies | `pnpm test:e2e:flake` | no SLO exists |
| R11 | Property tests green on digest, fingerprint, canonical hashing, spool framing | `pnpm test:property` | no property tests exist |
| R12 | Mutation score at or above a recorded floor on the correctness-critical set | `pnpm test:mutation` | never measured |
| R13 | Fuzz corpus over reporter ingestion: zero unhandled crashes | `pnpm test:fuzz` | P-60, F-6, F-7 are all unfixed crashers |
| R14 | k6 thresholds are **measured**, not estimated | `pnpm test:performance` | `recorded: false`, all values `null` |
| R15 | Rendering budget green (LCP, INP, CLS, long tasks) | `pnpm test:render` | no budget exists |
| R16 | Visual-regression baseline committed; zero unintended diffs | `pnpm test:visual` | no baseline exists |
| R17 | Screen-reader pass recorded for the four primary flows | `docs/quality/screen-reader-audit.md` | does not exist |
| R18 | Glass never renders over a data surface; axe green in both themes | `pnpm lint` + `pnpm --filter @automate/unified-web test` | n/a |

**Not claimed:** that the defect count reaches zero. R2 means *every confirmed defect has a disposition and none is open*. A sweep is a point-in-time reading, not a proof. The next sweep will find more; that is what the ledger is for.

---

## 2. Decisions

Carried unchanged from v3 unless marked **new**: D1 rehearse-before-breaking · D2 pre-audit per migration · D3 split the store before fixing it · D5 gate before feature · D6 tier every gate, `verify` capped at 20 steps · D7 delete-or-wire, one PR each · D8 no TanStack Query · D9 dark default, light contrast-verified · D10 single-node, self-hosted, English-only · D11 waves are the merge unit, ≤400 lines per PR.

| # | Decision | Why |
|---|---|---|
| **D4 (REVERSED)** | ~~Wire a real `JobHandler` in `apps/worker/src/main.ts`~~ **No handler. Ever.** | The v3 premise was wrong. **X-1 is `fixed`** and `apps/worker/src/main.ts:100-123` documents the truth: execution belongs to `apps/runner`, which claims jobs over `POST /api/v1/runners/:runnerId/jobs/claim` (`apps/api/src/routes/execution/runners.routes.ts:127`). `ExecutionWorker` has a second in-process claim path over the *same* `runners`/`jobs` tables, so a worker handler would compete with the runners for the same jobs, in a process with no execution capability — every job it won would end `infra_failed` or bounce through requeue. **Executing v3 W2.1 verbatim breaks working execution.** |
| **D12** | Tenancy: **scope all 10 unscoped tables.** | Keeps `WORKSPACE_ID` a real boundary. Committing to single-tenant per D10 was rejected because partial scoping is precisely what produced the live cross-tenant trigger (P-20). ~10 irreversible migrations, so W6 hard-blocks W7. |
| **D13** | **Hand-confirm all 66 `sweep` rows before any fix.** | 63% of the ledger has never been read by a human. Fixing a finding that proves false wastes the work and can leave a wrong fix in the tree. Generalizes the repo's own `CONFIRMATION_REQUIRED` rule from 13 rows to all 66. |
| **D14** | **Build the three real runner images; the isolation claim stays.** | A green release certifying an image whose entrypoint prints a string violates the plan's own rule. `runner.oci` moves `mock` → `real`. |
| **D15** | **v2.0.0 is a genuine major version.** | Justified by the tenancy migrations, the error surface gaining a mandatory stable `code` (C-3), the connector-credential model, and removal of unwired exports. All four break a consumer. |
| **D16** | **Glassmorphism is chrome-only, enforced by a source gate.** | See §5. Frosted glass behind data is the single change most likely to turn a 10/10 product into a 6/10 one. |
| **D17** | **QA gates are tiered; only one enters `verify`.** | D6 budget. `verify` goes 13 → **14** of a maximum 20. The other seven are CI jobs or nightly, because they need a browser, a database, or more than a PR's worth of time. |
| **D18** | **Two new dev dependencies, not five.** | `fast-check` and Stryker. Visual regression reuses Playwright's built-in `toHaveScreenshot`; the rendering budget is read from `PerformanceObserver`. Nothing is added that Playwright does not already ship. |
| **D19** | **The existing cross-workspace isolation suite is extended, not replaced.** | 41 assertions across 8 files already cover the scoped tables well. W7 makes it *applicable* to 10 more; the suite grows, it does not restart. |
| **D20** | **`vitest-axe` stays in both packages.** | v3 §8 Q4 says it is "declared and unused". It is used, via `packages/ui/src/test/axe.ts:21` and `apps/web/src/test-axe.ts:14`. Recorded so nobody "fixes" working accessibility infrastructure. |

---

## 3. Red flags

Defects in the v3 plan itself, or in the gates that are supposed to protect it. Confirmed against the working tree.

| # | Red flag | Evidence | Correction |
|---|---|---|---|
| **F1** | **W2.1 / D4 would break execution**, calling the absent handler "the largest single gap in the repo" | `apps/worker/src/main.ts:100-123`; X-1 (`fixed`) | Reverse D4. Replace W2.1 with an end-to-end worker→runner proof. **Re-verify W2.3's four untested branches against the runner claim path** — v3's rationale assumed a handler that will never exist |
| **F2** | **`docs:check` is a release criterion and does not exist.** Zero references repo-wide | v3 §6 item 8; absent from `package.json` | Build in W16 |
| **F3** | **`debt-baseline.json` is named by a live review rule and does not exist** | `.github/review-rules/rules.json:218`; v3 §1, §6 item 7 | Repoint the rule at `complexity-baseline.json` + `coverage-baseline.json` + the ledger's own disposition. Do **not** create the file |
| **F4** | **`pnpm --filter site doctor` is a release criterion with no `site` package** | v3 §6 item 9; `apps/` = api, runner, web, worker | Gate on W17 |
| **F5** | **W6's rehearsal harness does not exist and no finding tracks it.** `smoke:rehearsal` is a *local-target guard* reporting `rehearsalPerformed: false` — its own `gate-tooling.json:195` entry says so | `scripts/gate-tooling.json:188-196` | **New ledger row.** D1 has no tool, and D1 is what blocks W7. Hardest blocker in the programme |
| **F6** | **Five waves carry gate obligations and zero tracked rows** — W2, W6, W14, W15, W17. Nothing fails if they are skipped | ledger wave tally | Add a row per wave gate |
| **F7** | **v3's "Verified fixed — do not redo" list names 17 rows and evidences 2** | v3 §3; C-1 | Close C-1 with one `fixed` row per claim, or revert the claim to `open` |
| **F8** | **`test:e2e` is tiered `pr-blocking` but is not a step in `verify`** | `package.json:46`; `gate-tooling.json:69` | Decide in W0; record the outcome in `gate-tooling.json` |
| **F9** | **The performance gate has never been measured.** `recorded: false`, all three observed values `null`, comment: *"every number in `release` is an unvalidated estimate"* | `performance/thresholds.json:27-33` | W-D measures them against recorded reference hardware and promotes the block. Until then k6 compares real traffic to a number nobody saw |
| **F10** | **E2E runs on one engine.** Both projects use `devices['Desktop Chrome']` — no WebKit, no Firefox, no mobile viewport | `playwright.config.ts:118,127` | W-C adds the 3-engine matrix. WebKit is mandatory: `backdrop-filter` has the longest rendering history there, so it is the engine that will catch a glass bug |
| **F11** | **No OpenAPI document exists** — zero matches repo-wide — yet BK-5's entry criterion is "W9.6 OpenAPI document exists", and W9.6 is not a task in v3 | repo-wide search | W-C generates it from the Zod contracts and adds a drift gate |
| **F12** | **v3 §8 Q4 is factually wrong** about `vitest-axe` being unused | `apps/web/src/test-axe.ts:14` | D20. Recorded so nobody deletes working a11y infrastructure |

---

## 4. New waves

The v3 plan has no equivalent. They slot into the sequence without renumbering — 89 ledger rows carry `wave` ids and renumbering them is pure churn.

### W-A — Confirmation · *gate: zero `sweep` rows without `confirmed: true`*

Between W0 and W1. Nothing is fixed before it.

1. **Generalize the confirmation rule.** `scripts/lib/findings-ledger.mjs:38-52` lists 13 ids in `CONFIRMATION_REQUIRED`. Replace the id set with the general rule: *any* row with `provenance: "sweep"` must carry `confirmed: true` before reaching `status: "fixed"`. `confirmationProblems` (`:306-314`) already reads `record.confirmed`, so the change is the set, not the function.
2. **Add a `false-positive` disposition.** `findings-check` fails when a row disappears or a status regresses, so a refuted finding currently *cannot* be removed without failing the gate. Add `status: "false-positive"` with a required `refutedBy` note; teach `auditLedger` to accept it; count it in `findings:baseline` output. Without this, hand-confirmation cannot be completed honestly.
3. **Read all 66 `sweep` rows** against the code. Each gets `confirmed: true` + date, or `false-positive` + the file:line that refutes it, or a re-band.
4. Re-run `pnpm findings:baseline` **once, deliberately**. The resulting ledger is the real scope and may be smaller than 89.

### W-B — Release machinery · *gate: a tag can be cut and checked from a clean checkout*

After W17, immediately before the release.

1. **`pnpm release:check`** — asserts every `package.json` version matches the root, the CHANGELOG has an entry for it, the tag exists, and the commit is on `main`. Add a `gate-tooling.json` row (`never-in-ci` for the tag-writing half).
2. **Version policy.** Root is `1.0.0`, `private: true`, no release tags beyond two `archive/*`. Bump to `2.0.0` (D15).
3. **Make the release gate tag-triggered.** `.github/workflows/release-gate.yml:3-4` fires only on `workflow_dispatch`, so the release gate is a button nobody presses. Add `push: tags: ['v*']`; keep dispatch for dry runs.
4. **Put `migrate:validate` and the E2E matrix in the release path.** `verify` alone cannot prove a migration, and E2E is the only criterion that exercises the whole path.
5. **Rewrite `CHANGELOG.md`.** Its only entry closes with "the migration remains local/sample-only… production cutover… not authorized by this branch." Replace it with what v2.0.0 is; keep the "historical claims are not current truth" preamble.

### W-C — Quality foundations · *gate: the blind spots are closed and measured*

| # | Task | Evidence |
|---|---|---|
| W-C.1 | **3-engine E2E matrix.** Add `webkit` and `firefox` projects alongside `vertical-slice`; keep the existing non-empty-project assertions. Narrow the *full* matrix to nightly and run a Chrome+WebKit pair on PRs | R9 green on 3 engines; a deliberately broken WebKit-only assertion fails |
| W-C.2 | **Flake SLO.** Record the flake rate of the last 20 nightly runs; fail the nightly if it exceeds the recorded budget. Publish per-test flake counts to the job summary | R10; `node --test` interference (D-4) and the D-3 timeout class become visible instead of anecdotal |
| W-C.3 | **`pnpm test:property`** with `fast-check` on the four places where a real bug already shipped: `digestRunOutcome` (P-3 was a constant), the reporter fingerprint (P-23 is a locale-dependent sort persisted to a `notNull` column), canonical key-sorted serialization (P-70 hashed `JSON.stringify` directly), and spool framing. Properties: same outcome ⇒ same digest; any key order ⇒ same digest; different outcome ⇒ different digest; a fingerprint is invariant under locale and under insertion order | R11; a mutation that reintroduces `localeCompare` or `'0'.repeat(64)` fails |
| W-C.4 | **Fuzz the untrusted ingestion boundary.** A generated-corpus suite over reporter payloads, seeded from the JUnit and Playwright shapes. P-60 (unbounded `collectSuite` recursion), F-6 (unbounded failure-text accumulation) and F-7 (unguarded `JSON.parse`) are three confirmed crashers this finds on day one | R13; every corpus entry yields a classified ingestion error, never a `SyntaxError` or a `RangeError` |
| W-C.5 | **Mutation testing** on the correctness-critical set only: `packages/shared-contracts`, `vault-crypto`, `outbox-repository`, `installation-key-repository`, the digest. Record a floor and ratchet it upward | R12. This is the only instrument that answers AGENTS.md's own rule — *"a test that cannot fail is worse than no test."* The coverage ratchet measures lines, not assertions |
| W-C.6 | **OpenAPI document generated from the Zod contracts**, plus a drift gate that fails when the document and the schemas disagree. Unblocks BK-5 | R11/F11; `docs/openapi.json` regenerates cleanly and a hand-edit to it fails |
| W-C.7 | **Extend the cross-workspace isolation suite** to the 10 tables W7 scopes. It already has 41 assertions across 8 files for the scoped tables; W7 makes it applicable to `vault_entries`, `connector_configs`, `conversations`, `messages` and the rest | D19; each newly scoped table has a positive and a negative isolation case |
| W-C.8 | **Requirement→test traceability.** A generated matrix mapping every ledger row and every capability-register row to the test that proves it, refreshed by `docs:capability-register`. C-1 is this failure in miniature: 15 claims with no evidence | R3; every `real` capability row cites an executable command, not a path — which is the register's own unmet rule (C-2) |

### W-D — Resilience and performance reality · *gate: every axis has a recorded number*

| # | Task | Evidence |
|---|---|---|
| W-D.1 | **Measure the k6 thresholds.** Stand up the reference stack, run `performance/smoke.js`, and promote `observed_on_reference_hardware` from `recorded: false` to a real observation. Then **tighten** the thresholds to the measured value, so the gate catches a regression rather than an estimate | R14; `recorded: true` with three non-null values. F9 closed |
| W-D.2 | **Load, soak and spike profiles** beyond the current smoke. Soak is the one that matters: the outbox drops events (P-9) and the retention sweep swallows its errors (P-55, Q-55) only after hours | A soak run that ends with a reconciled outbox row count and no swallowed sweep error |
| W-D.3 | **Rendering budget.** Measure LCP, INP, CLS and long-task count on the four primary routes; commit ceilings; fail the PR on regression. Read from `PerformanceObserver` — no new dependency | R15. **This is the gate that makes glassmorphism safe**: `backdrop-filter` repaints the backdrop on every frame, and without a budget the effect is shipped on instinct |
| W-D.4 | **Fault injection as a programme, not a seam.** W2.2's `failNext` is one hook. Generalize it to the store, the object store, the outbox, the realtime bus and the runner claim path, then write the chaos tests: lease lost mid-execution, S3 timeout mid-upload, outbox write failure, runner crash without `drained`, DB connection loss during a migration | Each chaos test is green in the steady state and asserts the *recovery* when the fault fires |
| W-D.5 | **SLIs and an error budget** for the five axes O-4b says are unobservable: run outcomes, gate verdicts, event freshness, queue latency, runner health | R18's neighbours; feeds W11's `/metrics` endpoint, so W-D.5 lands after W11 |
| W-D.6 | **Load-test the 37 unmeasured endpoints.** `performance/thresholds.json:35-39` covers 3 of them and names 2 exclusions | Every exposed GET/POST route is either covered by a scenario or listed with a reason |

### W-E — The design language · *gate: R16, R17 and R18 green*

The full specification is §6. Summary of the work:

| # | Task | Evidence |
|---|---|---|
| W-E.1 | **Glass token layer** in `packages/ui/src/tokens/theme.css` + `colors.ts`, with the `theme.test.ts` contract extended so every pair is contrast-verified | `theme.test.ts` fails if a token is added without its computed pair |
| W-E.2 | **`no-glass-over-data` source gate** — `backdrop-filter` and the glass tokens are banned outside the chrome allowlist. Model it on the existing `as unknown as` tree ban (D-9) | A `backdrop-filter` added to `Table.tsx` fails lint |
| W-E.3 | **Escape hatches**: `prefers-reduced-transparency`, `prefers-contrast: more`, and `forced-colors` all degrade glass to an opaque surface. `prefers-reduced-motion` already exists in `motion.css` | Each media query has a test asserting the opaque fallback |
| W-E.4 | **Visual-regression baseline** from Storybook, which already has 25 components with colocated tests and stories. Reuse Playwright's `toHaveScreenshot`; no new dependency | R16; baseline committed; a one-token visual change is caught |
| W-E.5 | **Screen-reader audit** of the four primary flows — login, dashboard, run detail, quarantine — recorded in `docs/quality/screen-reader-audit.md` | R17. axe is necessary and not sufficient: it cannot evaluate contrast over a blurred backdrop, and it does not read like a screen reader |
| W-E.6 | **Heuristic evaluation** (Nielsen's ten) of the four flows, with the findings added to the ledger | Every usability finding is a ledger row, banded like any other |

---

## 5. Ordering constraints

1. **W0 → W-A → W1 strictly ordered.** W-A before W1 because W1 fixes four `sweep` rows; W0 before both because there is no regression net for the security fixes.
2. **W6 hard-blocks W7.** D1. Until the rehearsal harness exists and has restored a post-migration database, W7 may only add nullable columns.
3. **W1.5 ships ahead of W7.** The live cross-tenant trigger is a pure-code fix with no migration, so it lands in W1 and does not wait for the tenancy programme.
4. **D3: W5's split lands before W4's edits to the same file** — six tasks target `drizzle-execution-store.ts`; fixing before splitting re-bases the work.
5. **BK-6 before the release gate runs.** `oci:verify` is R5 and the three images are stubs.
6. **W-A's schema change lands before any row flips.** `false-positive` must exist in `auditLedger` before the first refutation is recorded.
7. **W-C.3 and W-C.4 before W4's fixes to the same code.** P-3, P-23, P-60, F-6 and F-7 are all property/fuzz failures waiting to be written; writing the test first is the repo's standard.
8. **W-D.3 before W-E's glass lands.** The rendering budget must exist *before* the effect, or the effect is shipped on instinct.
9. **W-D.5 after W11.** SLIs need the `/metrics` endpoint O-4b says does not exist.
10. **W-C.7 after W7.** There is nothing to test until the tables are scoped.

---

## 6. The design language: glassmorphism — DEFERRED, 2026-10-03

> **Superseded in its sequencing by `.kilo/plans/1791024280658-cinematic-design-language-and-docs-overhaul.md` §1 and §4.** Recorded as `DESIGN-1` in `docs/quality/findings-ledger.json`.
>
> **What survives, unchanged and still binding:** the rule. **Glass is chrome. Glass is never data.** Everything below this line about *why* is as true as it was, and the superseding plan does not soften any of it.
>
> **What changed is when, and what else.** Glass moves from Phase 1 to Phase 2, and it is no longer the design language — it is one material available to four chrome surfaces once the plane exists. Three reasons, each measured rather than preferred:
>
> 1. **Phase 1 shipped no `backdrop-filter` at all.** The superseding plan's D6-9 makes that explicit, and `eslint.config.js` now fails the build on `backdrop-filter` in any `.ts` or `.tsx` file. So "glassmorphism in the UI layer" could not be a Phase 1 item without contradicting itself.
> 2. **Glass needs a plane to be glass over.** `--automate-surface-sunken`, `--automate-surface-raised` and `--automate-surface-muted` arrived in Phase 1; a translucent surface over a single flat `#0a0a0a` is not frosted glass, it is a dark rectangle at 80% alpha.
> 3. **`RF-10`'s refutation has an expiry date, recorded on the row.** It refuted the cross-engine glass risk on 2026-10-01 on the grounds that `blur(20px) saturate(180%)` is in no stylesheet here. That is true today and stops being true the day the allowlist opens. The row's `premiseExpires` field says so, and says what to do instead of reopening it: widen `PERF-1`'s summary to name the cross-engine case, because one row should carry the measurement gap rather than two carrying halves of it.
>
> **What a Phase 2 that opens the allowlist has to earn first.** The `prefers-reduced-transparency: reduce` escape hatch, which Phase 1 shipped as three blocks in `packages/ui/src/tokens/theme.css` on the plane tokens — before there was anything translucent to degrade. That is the right order and this is the reason: the hatch is written so that adding `backdrop-filter` needs no change to it.
>
> **The rule as originally specified, for the record:**

Netflix, Apple and Google are three different answers, and the honest thing is to take one idea from each rather than blend all three:

- **Apple** — the signature. Translucent chrome, a 1px inner top highlight, a low-opacity fill, and a heavy, soft shadow. `backdrop-filter: blur(20px) saturate(180%)` is the canonical recipe.
- **Netflix** — cinematic, not glassy. Heavy vignette, large radii, dark-first, content forward. The lesson worth taking is *restraint and contrast*, not blur.
- **Google (Material 3)** — tonal elevation instead of shadow or blur. The lesson worth taking is that elevation is a *system*, applied by token, never hand-placed per component.

### The rule

**Glass is chrome. Glass is never data.** Frosted glass belongs to the shell that floats above the content: the app sidebar, the top bar, dialogs, drawers, popovers, tooltips, toasts, the command palette, and a hero stat tile. It is forbidden on anything a person reads to learn a fact: data tables, log and stack-trace viewers, diff and evidence panes, screenshot and trace viewers, code and JSON viewers, run-detail content, and anything set in a monospace face or tabular numerals.

**Why, in the repo's own terms.** This is a QA product. Its job is to show the truth — a digest, a timestamp, a diff, a stack trace. A blurred, translucent, non-deterministic backdrop behind data makes the claim harder to read and the evidence non-reproducible, and `run-detail.tsx` is where a person decides whether a release is safe. W-7 already records the principle for timestamps — *"unacceptable in an evidence UI, where a timestamp is the claim"* — and glass would extend that violation to every number on the page.

### Four conflicts, and what defuses each

**Note, 2026-10-03:** these four were written as Phase 1 risks. They are now Phase 2 risks, and
the first row's second column has since been answered by measurement rather than by argument —
`theme.test.ts` now carries a per-theme contrast case for every status colour, including against
its own 10% tint over each of the four plane steps, which is the worst case the first row named.
The resolution column still holds.

| Conflict | Why it bites | Resolution |
|---|---|---|
| **Contrast** | Blur makes measured contrast vary with whatever is behind it, so a static contrast check becomes unsound. Worse, **axe cannot evaluate contrast on a translucent backdrop** — it reads computed background colours and cannot see through `backdrop-filter` | The allowlist keeps all persistent body text on opaque surfaces, so every text node still has a deterministic background. Glass only carries transient text, whose composite is computed in `theme.test.ts` against a worst case |
| **Performance** | `backdrop-filter` repaints the backdrop every frame; a scroll-heavy dashboard with stacked layers is a known jank source | W-D.3's rendering budget lands *first* (ordering constraint 8). Plus a blur-radius ceiling in the token and a cap on simultaneously-blurred surfaces per route |
| **Determinism** | Glass over a screenshot makes the same artifact render differently between runs, which breaks visual regression testing and makes captured evidence non-reproducible | Already excluded by the allowlist |
| **Reduced-transparency** | Translucency is exactly what the OS-level accessibility switches exist to turn off | `@media (prefers-reduced-transparency: reduce)`, `prefers-contrast: more` and `forced-colors` all degrade glass to an opaque surface. Each gets a test |

### Enforcement

The allowlist is not a convention, it is a gate. A new `no-glass-over-data` review rule plus a lint selector fails the build when `backdrop-filter` or a glass token appears outside the chrome components — modelled on the existing `as unknown as` tree ban from D-9, and declared in `.github/review-rules/rules.json` with the severity, category and fix that `review-rules-check.mjs` validates.

---

## 7. QA discipline audit

What each discipline would add, and — more usefully — what it would *not* re-open because it is already covered. Prescribing work that exists is how a plan loses its reader's trust.

| Discipline | Already covered | Gap this plan closes |
|---|---|---|
| **Test architect** | The ledger and the coverage ratchet; nothing closes without proof | W-C.8 requirement→test traceability. C-1 is this discipline's failure in miniature |
| **SDET / automation** | 6 E2E specs, colocated component tests, 25 stories | W-C.1 three engines; W-C.2 flake SLO. **F10** |
| **Security QA** | semgrep + gitleaks + secret history; **41 cross-workspace isolation assertions across 8 files — genuinely good** | W-C.4 fuzzing the attacker-controlled boundary; W-C.6 drift gate; W-C.7 extends isolation to the newly scoped tables (D19) |
| **Performance QA** | A k6 scenario and a thresholds file | W-D.1–D.3, W-D.6. **F9** — the baseline was never measured, so the gate protects nothing |
| **Reliability / SRE** | Worker lease recovery; process-failure handlers in runner, worker and API | W-D.4 fault injection as a programme; W-D.5 SLIs |
| **Accessibility** | axe wired in both packages (D20), a 16.6 KB token contract test with real contrast arithmetic, `motion.ts` with reduced-motion | W-E.3–E.5. axe cannot see through glass and does not read like a screen reader |
| **Data QA** | D2 pre-audit per migration; the W6 rehearsal concept | W-D.6-style reconciliation: row counts and checksums post-migration, not only "it restored" |
| **API / contract QA** | `shared-contracts` is authoritative and `real` | W-C.6 OpenAPI + drift gate. **F11** — the document does not exist and BK-5 is gated on it |
| **AI / eval QA** | Nothing. `packages/automation` is imported by nothing (X-4) until W10 wires it | W10 needs an **LLM eval harness** with recorded fixtures and pass/fail criteria. A model adapter with no eval suite is an untested adapter — this is the one discipline with no representation at all today |
| **Exploratory / UX** | Nothing systematic | W-E.6 Nielsen heuristic evaluation of the four flows |
| **Design-system** | Storybook, token contract test, colocated tests and stories | W-E.1–E.4 tokens, the source gate, visual regression |
| **Release / QA mgmt** | Tiered gates, `gate-tooling.json`, a coverage ratchet on every PR | W-B tag-triggered release gate, `release:check`, the rewritten CHANGELOG |

---

## 8. Gate budget (D6)

`verify` is 13 of a maximum 20 steps today. The sweep adds **one**:

| Gate | Tier | In `verify`? | New dependency |
|---|---|---|---|
| `test:property` | pr-blocking | **yes** (13 → 14) | `fast-check` |
| `test:e2e:matrix` | pr-blocking | no — needs a database and a browser | none (Playwright installed) |
| `test:e2e:flake` | nightly | no | none |
| `test:mutation` | nightly | no | Stryker |
| `test:fuzz` | nightly | no | none (`fast-check` generators) |
| `test:performance` | nightly | no — exists, now measured | none (k6, already in the manifest) |
| `test:render` | pr-blocking (CI job) | no — needs a browser | none (`PerformanceObserver`) |
| `test:visual` | pr-blocking (CI job) | no — needs a browser | none (`toHaveScreenshot`) |

**Headroom after the sweep: 6 of 20.** Every tool-dependent gate gets a `scripts/gate-tooling.json` row in the same PR that adds it, or `gate-tooling.test.mjs` fails — which is the point of the manifest.

---

## 9. Wave sequence

| Order | Wave | Gate | Open rows | Notes |
|---|---|---|---|---|
| 1 | **W0** Gates and measurement | gates are trustworthy | 3 | ~90% landed. Remaining: C-1 (F7), D-4, G-4b (semgrep cannot complete on the Windows host — environment, not repository; CI unaffected) |
| 2 | **W-A** Confirmation | zero unconfirmed `sweep` rows | 66 re-verified | **new** |
| 3 | **W1** Security: reachable paths | every item has a fail-before test | 4 | P-18 `validateApiKey`; P-5 `gateStatus`; P-20 schedules trigger (pure code, ships ahead of W7); C-5 compose cannot boot the API |
| 4 | **W2** Execution path is real | a job runs worker→runner on PostgreSQL | 0 | **F1 — no handler.** Gate work only |
| 5 | **W-C** Quality foundations | the blind spots are closed and measured | 0 | **new** |
| 6 | **W3** Delete-or-wire | `knip` reports zero unused | 13 | R-1…R-7 (`bus.ts`; production uses `DurableRealtimeBus`), S-1…S-7 (`InMemorySessionService`; production uses `DrizzleSessionStore`) |
| 7 | **W4** Durability and correctness | every item has a fail-before test | **17** | Largest wave. P-14/P-16/P-17/P-19 spool, P-70 five lease defects, P-24 retries fatal 401s, F-4…F-8 reporters, O-1 no fencing token |
| 8 | **W5** Split the store, then fix it | complexity offenders do not increase | 6 | C-4: 2 166 lines, `:1357` complexity 65, `:1098` complexity 39. D3: split **first** |
| 9 | **W6** Migration safety | a rehearsal restores and re-opens every row | 0 | **F5 — the harness does not exist. Hard-blocks W7** |
| 10 | **W7** Data integrity and tenancy | every migration has a passing pre-audit | 9 | D12 all 10 tables. D2 pre-audit each. P-23's fingerprint recompute is a **data repair** if any classification flips |
| 11 | **W8** Error surface | a source-level gate enforces it | 2 | C-3: 42 `error(...)` sites, 0 migrated; 25 bodies with no `code` |
| 12 | **W9** Control plane | each has a fail-before test | 4 | X-2 unaudited PATCH, X-3 `/features` returns `{}` + 501s, X-5 verdicts name no rule id, C-6 ~35 dormant tables |
| 13 | **W10** AI gateway and connectors | a provider outage changes no outcome | 11 | X-4: `packages/automation` is **imported by nothing**. Wire it, and land the LLM eval harness with it |
| 14 | **W11** Observability | one execution traceable by one id | 7 | O-1b no `AsyncLocalStorage`, O-4b no `/metrics` |
| 15 | **W-D** Resilience and performance reality | every axis has a recorded number | 0 | **new**. D.5 lands after W11 |
| 16 | **W12** Resource, performance, resilience | each axis has a recorded number | 3 | Q-53 PBKDF2 sync on the request path and a seal that never hits cache; Q-52 `readAt` is the **live** unverified reader |
| 17 | **W13** Web product defects | no defect in the band is open | 9 | W-1 no error boundary, W-2 AuthGuard redirects from an effect after mount |
| 18 | **W14** Accessibility | axe green in both themes | 0 | F6. Overlaps W-E.3/E.5 — they share the media-query fallbacks |
| 19 | **W15** Quality stack, supply chain, contracts | each new gate tiered inside the D6 budget | 0 | F6. Receives the eight new gates from §8 |
| 20 | **W16** Documentation, governance, capability truth | `pnpm docs:check` green, zero unbacked claims | 1 | C-2. **F2 — build `docs:check`** |
| 21 | **W17** Site and evidence console | site-doctor's ten checks pass | 0 | F4, F6. Creates the `site` package |
| 22 | **W-E** The design language | R16, R17, R18 green | 0 | **new**. D.3 budget lands before this |
| 23 | **W-B** Release machinery | a tag can be cut and checked | 0 | **new** |
| 24 | **BK-6** Real runner images | each image execs its entrypoint | 0 | D14. **Blocks R5** |
| — | **v2.0.0** | all of R1–R18 | **0** | |

### Findings by wave

`W0` 3 · `W1` 4 · `W2` 0 · `W3` 13 · `W4` 17 · `W5` 6 · `W6` 0 · `W7` 9 · `W8` 2 · `W9` 4 · `W10` 11 · `W11` 7 · `W12` 3 · `W13` 9 · `W14` 0 · `W15` 0 · `W16` 1 · `W17` 0 — **total 89.**

Band split: 23 Blocker · 6 Critical · 51 Major · 9 Minor.

---

## 10. Risks

| Risk | Response |
|---|---|
| W-A shrinks or grows the 89, invalidating the wave table | The table is keyed to the **pre-W-A** ledger. Re-tally after `findings:baseline`; the sequence holds, the counts do not |
| Many `sweep` rows are false, so the programme is smaller than it looks | That is what W-A is for, and it is cheap — reading code costs nothing, and finding out before the fix is the whole value |
| W6's rehearsal harness is the hardest single item and blocks W7 | It is the prerequisite, not a nice-to-have. Tenancy migrations without a restore path mean an operator gets a 500 and no recovery |
| Tenancy is ~10 irreversible migrations against live data | D2 pre-audit before each file exists; W6 gate before any; P-23's recompute may force a data repair, scoped separately |
| D4's reversal is itself a regression risk — a later reader may "fix" the absent handler | Already mitigated: `main.ts:100-123` documents it and `worker.test.ts` pins it with two cases. Keep both. Never reintroduce W2.1 |
| Glass regresses accessibility or performance after shipping | Three gates, not opinion: the `no-glass-over-data` source rule (W-E.2), the reduced-transparency fallbacks (W-E.3), and the rendering budget that lands *before* the effect (ordering constraint 8) |
| The `verify` budget is consumed by the sweep | D17 keeps exactly one new gate in `verify` (13 → 14). Six steps of headroom remain, and §8 records the tier of each |
| Mutation testing produces a flood of false positives on `shared-contracts` | Scope it to the correctness-critical set from the start (W-C.5) and record the floor from the first real run rather than inventing one |
| Adding dependencies contradicts D7's delete-or-wire instinct | D18: two packages, each earning its gate. Visual regression and the rendering budget deliberately reuse Playwright and the platform |
| 18 waves is a large programme | Each task is independently shippable and independently verifiable (D11). Any wave may stop at its gate without leaving a broken product |
| G-4b: `security:verify` cannot go green on the Windows dev host | Environment, not repository. Verify on CI (ubuntu-24.04, semgrep 1.178.0) or in WSL. Do not weaken the ruleset for one host |

---

## 11. Out of scope

Unchanged from v3 §9: hosted SaaS; multi-tenant isolation beyond `WORKSPACE_ID`; user/RBAC/SSO/SCIM; iOS execution; Redis/Kafka/Kubernetes/Helm; a second orchestrator; a general workflow engine; arbitrary untrusted shell execution; MCP gateway; Tauri desktop; mobile/native; localized READMEs; a marketing site presenting aspirational capabilities as current; adopting TanStack Query.

**BK-1…BK-5, BK-7, BK-8 stay deferred** with v3's entry criteria. **BK-6 is promoted** into the release (D14). BK-1 (five-domain engines) is the largest and remains the natural v3.0 content — along with the AI eval harness becoming load-bearing rather than new.

**BK-1's entry criterion, as v3 §13 recorded it, and as finding X-3 is re-pointed at it:** *"Five-domain execution engines (browser, API, load, security, Android) with real fixtures, cancellation, timeout, recovery, native evidence — Track B gate green; `packages/tool-sdk` exists."* Neither half holds in this tree: there is no `packages/tool-sdk` (the workspace has twelve packages and none is it), and Track B's gate is not green. So BK-1 is not a candidate, and `X-3` — the agent namespace that answers 501 to all fifteen domain/action pairs — is carried as `debt` at **Major** rather than as an unclosable Critical. Closing X-3 is a BK-1 outcome, not a v2.0.0 one: it needs one of browser, api, load, security or mobile to have a real execution adapter.

**Not in v2.0.0:** native mobile apps, a design-token editor, 3D or WebGL effects, animated page transitions beyond what `motion.css` already defines.

---

## 12. Resolved questions

| Question | Resolution |
|---|---|
| `gateStatus` — wire or drop (W1.4) | **Wire.** The release gate needs a per-domain verdict. P-5 needs a pre-audit first, because the column and its CHECK reject `warning`/`unknown`/`not_evaluated` today |
| `conversations` / `messages` ownership (W7.3) | **Workspace scope plus a per-owner column.** Workspace-only leaves any two sessions in one workspace reading each other's transcripts (P-11). This unblocks the backfill |
| Tenancy vs explicit single-tenant (W7.3) | **Scope all 10 tables** — D12 |
| `vitest-axe` vs `@axe-core/playwright` (W14.1) | **Both stay, one per package.** v3's premise was wrong — D20, F12 |
| How much QA tooling | Full sweep, 8 gates, 2 new dependencies — D17, D18, §8 |
| Glassmorphism scope | Chrome only, source-gated — D16, §6 |

Newly decided: D13 (confirm all 66 before any fix), D14 (build the runner images), D15 (v2.0.0 is a genuine major).

| Question | Resolution |
|---|---|
| `X-3`'s band — Critical, or the row the ledger cannot close | **Major, as `debt`, re-pointed at BK-1.** The row's own summary says the 501 is a deliberate "not implemented" rather than a failure, and the blocking band forbids `debt` — so at Critical the row was unclosable in all four dispositions, which is what would have forced an exception to the never-debt rule for every later row. The ratchet guards `status`, not `band` (`findings-ledger.mjs:343`), so re-banding is legal; the 501s and their tests are untouched. Findings-remediation §1 decision A, §4 wave 1.0 |
| The `debt` disposition in this ledger, which no row had ever carried | **Used once, on X-3, and only because the re-banding made it legal.** `pnpm findings:check` prints every debt row with its owner, so a deferral is visible in the gate output rather than living in a summary. `owner` and `removalCondition` are both required, and X-3's removal condition names a gate result and a file, never an intention |

---

## 13. First actions

1. **F1**, as a standalone commit: reverse `D4` and `W2.1` in the v3 plan, and add a `wave`-level note to the ledger so the reversal is visible from `docs/quality/findings-ledger.json`. Nothing else in this programme is as dangerous to get wrong.
2. **F5, F6, F9, F10, F11, F12** as ledger rows. The ledger is the machine-checked scope; a gate with no row is a gate that can be skipped silently, and a threshold that was never measured is not a threshold.
3. **W-A steps 1–2**: generalize `CONFIRMATION_REQUIRED`, add the `false-positive` disposition. Two small changes every other W-A step depends on.
4. **W-D.3** (the rendering budget). It is the only gate that makes the glass in §6 safe to ship, and it must exist before the effect does.
