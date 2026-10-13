# Automate — Evidence-First QA Console: Product Blueprint and Execution Plan

**Type:** implementation-ready strategy + build plan
**Supersedes for the console/ingestion surface only:** the analytics and ingestion sections of `1790399792791-automate-final-qa-excellence-roadmap.md` (§2.3, A14, BK-3). All other tracks of that roadmap stand.
**Repo:** pnpm 10.30.2 · Turborepo · Node 24 · TypeScript 5.9 · Vitest 4 · Hono v4 · Drizzle · PostgreSQL 16 · React 19 · TanStack Router
**Rule inherited from the repo:** nothing is called done without executable evidence. A gate that cannot fail is a defect. A gate that fails for an environmental reason it does not report is a worse defect.

---

## 1. The verified baseline (not from docs — from the tree)

| Asset | State | Evidence |
|---|---|---|
| Canonical result contract v2 | Exists, with `proof.state`, `completeness.state`, `retention`, `provenance`, `evidence[]` | `packages/reporter/src/canonical-run-result.ts`, `packages/shared-contracts` |
| One status ladder | Exists, and the two copies that disagreed were merged into one function | `runStatusFrom` — `canonical-run-result.ts:50` |
| Honest status classification | Exists, exhaustive over the enum by a compile-time `satisfies` guard | `policy.ts:24-36` |
| Honest KPI read model | Exists. Every metric carries `denominator`, `exclusions[]`, `proofCeiling`, `confidence`, `freshness` | `kpi.ts:6-23` |
| Quality gate | Exists. An unevidenced green is `failed`, not `inconclusive` | `quality-gates.ts:34-35` |
| Fingerprint / idempotency | Exists. UTF-16 code-unit ordering, `accepted\|duplicate\|conflict` | `policy.ts:96-120`, `drizzle-reporter-ingestion.ts:13` |
| Adapter parity test | Exists — the template for the transport-parity work in §7 | `packages/reporter/src/adapter-parity.test.ts` |
| Tenancy register | Exists, derived, test-guarded. 56 tables: 13 global, 43 workspace-scoped, **15 with a hard boundary** | `docs/quality/tenancy-scope.json:26-34` |
| Open Blocker | `RF-5` — the migration rehearsal has never been run; five tenancy migrations landed anyway | `docs/quality/findings-status.json:118` |

**What does not exist:** any cross-run query. `ReporterResultStore` is `ingest` + `get(runId)` only (`apps/api/src/services/reporter-ingestion.ts:9-12`). `GET /api/v1/reporting/kpis` accepts at most one `runId` (`apps/api/src/routes/reporting.ts:13-18`). The store cannot list one run, let alone a window.

---

## 2. The finding that reorders the roadmap

**There are two ingestion systems, and they are disjoint.**

`packages/reporter` (JUnit + Playwright → `CanonicalRunResult` → `canonical_run_results`) is the honest one, and the only one `@automate/reporting` can read.

`apps/api/src/routes/reporter.ts` is a 996-line **parallel** path that bypasses it entirely. It contains its own hand-rolled JUnit scanner (`scanTestcases:552`, `parseJunitUpload:593`) and its own Playwright converter (`convertPlaywrightJsonToUpload:428`), its own status vocabulary (`RunStatus`, including `interrupted`), and writes `runs`/`tests` via `RunRepository` — never `canonical_run_results`.

Four consequences, all live in the tree today:

1. **The public ingest endpoint feeds nothing the console can see.** `apps/api/src/index.ts:251` wires reporting to `canonical_run_results`; `reporter.ts:957` writes `runs`/`tests`. A customer's entire test history can arrive through the auth'd, rate-limited, artifact-preserving endpoint and every KPI would still report `proofCeiling: 'unknown'`. The console would declare a system with a year of daily testing **not knowable** — the most expensive possible failure of this product's thesis.
2. **The two parsers disagree about the same file.** The canonical JUnit adapter reads `flakyFailure`/`rerunFailure` as the only honest source of `flakiness: 'observed'` (`adapters/junit-xml.ts:26-28, 54-56, 131-138`); `parseJunitUpload:620-623` recognises only `<skipped>`, `<failure>`, `<error>` — so **every retried JUnit report is a clean pass on one path and a flake on the other.** This is the exact defect `canonical-run-result.ts:11-25` was written to end, reintroduced.
3. **A harness event is reported as a product failure.** `mapPlaywrightStatus` maps `interrupted` → `failed` (`reporter.ts:528`). `policy.ts:30` puts `cancelled` in `nonProduct` precisely because "cancelling a run yields no outcome at all." The upload path inflates the failure rate with the harness's own interruptions.
4. **The contract's own "two doors, one gap" pattern, again.** `reporter.ts:144-151` and `:696-711` both record a field the contract declared and the write dropped. It has been fixed twice at this door and is open at the other.

**Therefore: breadth is not the first task. Unification is.** Adding nine adapters while two ingestion systems disagree would multiply this defect by ten. Wave 0 is blocking for everything.

---

## 3. Decisions locked with the owner

| # | Decision | Consequence |
|---|---|---|
| **D1** | All three wedges ship. **Trust-first is an invariant, not a phase** — a surface that cannot carry a ceiling does not ship. **Interpret-first is Wave 1**, breadth is Wave 3. | Every later wave inherits the ceiling rule. A new adapter with no queryable aggregate is `not_configured`, never a pass. |
| **D2** | Ingest is **push (spine) + pull (optional)**. | Transport parity is the central engineering risk. §7 is the mitigation and it is not optional. |
| **D3** | **Console first. Every action is a human-approved proposal.** Hard invariant: no action fires on a population whose `proofCeiling` is below `verified` or whose `completeness` is not `complete`. | No auto-quarantine, no auto-suppress, no auto-created defect. An automated action on a low-confidence population manufactures green — the one thing this product exists to prevent. |
| **D4** | Compute on read from canonical rows. **No rollup table.** | Canonical rows stay the single authority. §6.3 names the one place this needs a projection, and the gate that keeps the projection honest. |
| **D5** | Landing surface is **release confidence**. Triage is Wave 2's payoff; trend is the substrate both share. | Ranked by least-built and most defensible: `evaluateQualityGate`, `GET /runs/:runId/gate`, `releases` and `gate_evaluations` already exist. |
| **D6** | Single-tenant, self-hosted, per `1790399792791` D3/D8. `installations` is the tenant boundary. | An open third-party ingest endpoint on an installation-scoped product with no per-caller authorization model is the whole security story of D2. §5.1. |
| **D7** | Additive-first, expand-then-contract, per D11 of the standing roadmap. | No column dropped, renamed, or narrowed while the old application runs. |
| **D8** | No new table lands before `pnpm migrate:rehearse` has a recorded run. | `RF-5` is an open Blocker whose only removal condition is the rehearsal. Every table added before it widens it. |

---

## 4. Value proposition

Every tool in the market answers *"how green were we?"* All of them will answer it, and all of them will be **wrong in a way nobody can see**: a blocked shard is not a pass, an unknown test is not a pass, a flaky retry reported as `passed` is not a pass, and a suite that never ran is emphatically not a pass.

Automate's claim is narrower and stronger: **every number states what it is not counting, and refuses to answer when it cannot.**

The competitor's dashboard has one number. This one has a number, its denominator, its exclusions with reasons, its proof ceiling, its confidence, its freshness, and the command that reproduces it. When the evidence is weak, the tile says **not knowable** and names the weakest link.

That is not a feature. It is a different category, and it is the only claim in this market that a green-dashboard competitor cannot copy by adding a chart.

---

## 5. Target architecture

```
   producers                    ONE ingest door                    ONE model              ONE authority
┌──────────────┐          ┌───────────────────────┐        ┌────────────────────┐   ┌──────────────────┐
│ Playwright   │─push─┐   │ POST /ingest/v1       │        │ adapter (parse)    │   │                  │
│ JUnit/others │      ├──▶│  scoped single-run    │───────▶│ canonicalRunResult │──▶│ canonical_run_   │
│ Allure*      │      │   │  token, digest,       │        │ + runStatusFrom    │   │ results (JSONB)  │
│ Cypress*     │      │   │  sourceUri, producer  │        │ (ONE ladder)       │   │  PK(wsId, runId) │
├──────────────┤      │   └───────────────────────┘        └────────────────────┘   └────────┬─────────┘
│ TestRail     │─pull─┤            ▲                            ▲                        │
│ qTest*       │      │            │                            │                        ▼
│ ReportPortal*│      │   conformance corpus            parity gate          read-only queries
└──────────────┘      │   (both transports)           (every adapter)         compute on read
                       └────────────────────┘                                              │
                                                                    ┌───────────────────▼──┐
                                                                    │ KpiReadModel[]        │
                                                                    │ denominator/exclusions│
                                                                    │ ceiling/confidence    │
                                                                    └──────────────────┬──┘
                                                                     every tile renders it │
```

**The invariant that makes this a product rather than a pipeline:** a KPI is not a float. It is a `KpiReadModel` (`kpi.ts:6-23`) plus a renderer. Any surface that renders a number without its read model is a defect, and §9 gates that in the UI where it is currently unenforced.

### 5.1 The push door (D6, D2)

- `POST /api/v1/ingest/v1` — versioned in the path, not negotiated in the body.
- Auth: a **scoped, rotatable, single-run ingest token**, hashed at rest, compared with `timingSafeEqual`, never logged, never accepted as a query parameter. `reporter.ts:797-805` already has the right precedent: `allowQueryToken` defaults to `false` for exactly this reason. The new door has no query-parameter path at all.
- The token is **not** `REPORTER_SECRET`. That is one shared installation-wide secret; a per-token model is what makes revocation, per-producer attribution, and a blast radius of one possible. `api_keys` is `global`/installation-scoped with the register's own stated principle that "authentication is not authorization" (`tenancy-scope.json:64`) — a token authenticates the producer; the workspace it may write is a separate decision made by the installation, never by the token.
- **Attribution is mandatory**: `producer`, `producerVersion`, `adapterVersion`, `sourceUri`, `sourceDigest`. All five already exist on `ProducerContext` (`packages/reporter/src/adapter.ts:3-13`) and land in `provenance` for free.
- Idempotency and replay audit are **already solved**: `fingerprint` over canonical JSON with UTF-16 ordering, yielding `accepted | duplicate | conflict` (`policy.ts:118`, `drizzle-reporter-ingestion.ts:13`). Do not build a second one.

---

## 6. Wave 0 — one ingestion system (blocking)

Nothing in Waves 1–3 merges until this lands. Each task is red-first per `.kilo/skills/evidence-test`.

- [ ] **0.1 — Record the two-doors finding.** A row in `docs/quality/findings-ledger.json` with `provenance: "hand"`, `band: "Blocker"`, and the four consequences of §2 as its evidence. Per `.kilo/skills/ledger-row`: a Blocker may not be `debt` (§1 of the standing roadmap forbids debt in the blocking bands), and `wave-gates.json` must record its gate.
- [ ] **0.2 — Freeze the second parser.** Prove the divergence before changing anything: one test that feeds the *same* retried JUnit document to `parseJunitUpload` and to the canonical JUnit adapter and asserts the two disagree on `flakiness`. Watch it fail. That is the evidence the row rests on, and it is a defect that cannot fail today.
- [ ] **0.3 — Make `runs`/`tests` a projection, not a second authority.** Route `POST /api/v1/reporter/upload` and `POST /api/v1/reporter/events` through the canonical adapters and `canonicalRunResult`, then derive `runs`/`tests` rows from the canonical result. The canonical row is written first and is authoritative; the `runs`/`tests` projection carries a gate that recomputes it from the canonical row and fails on any divergence — the same rule D4 applies to rollups.
- [ ] **0.4 — Retire the duplicated parsers.** Delete `scanTestcases`, `parseJunitUpload`, `parseJunitUpload`'s helpers, `convertPlaywrightJsonToUpload`, and `mapPlaywrightStatus`. `packages/db` dead-exports and `docs:dead-exports` must agree afterwards. If a hand-rolled scanner is genuinely faster than a library, that argument is made once, in a benchmark, for one parser — not maintained in two places.
- [ ] **0.5 — Fix `interrupted`.** `mapPlaywrightStatus` maps a harness interruption to a product failure (`reporter.ts:528`). The canonical vocabulary has no `interrupted`; it has `cancelled` (nonProduct) and `unknown` (indeterminate). Decide once, in the contract, and assert it in the conformance corpus. Do not leave it as a per-adapter judgement.
- [ ] **0.6 — Promote the cohort fields.** `provenance` is an open `Record<string, unknown>` bag, so `commitSha`, `branch`, and `environment` are unqueryable. Per-branch cohorts, per-environment comparison, and escaped-defect rate all require them in the contract. Additive: declare them, validate them, keep reading the bag for producers that omit them.
- [ ] **0.7 — Prove the loop closes.** One end-to-end test: a Playwright report → the ingest door → `canonical_run_results` → `/api/v1/reporting/kpis` returning a non-null metric. It fails today, because the door and the KPI endpoint are disjoint. This is the single test that proves §2 is fixed, and it should be the merge gate for Wave 0.

**Exit criteria:** one parser per format; one status ladder reachable from every door; `tenancy:check` green; the new row in the ledger is `fixed` with an evidence path that exists.

---

## 7. Wave 3 preview — breadth, and the risk that comes with it

This is where D2 costs something, so the mitigation is designed here rather than discovered later.

**The risk:** two transports converging on one model can disagree. Push a JUnit file and pull the same file from a vendor's API and get two different `CanonicalRunResult`s. That is `canonical-run-result.ts:11-25` again, one level up.

**The mitigation — a conformance corpus, and it is the only authority both transports answer to:**

- [ ] A fixture corpus of real-world documents per format, **including the hostile ones**: a retried suite, a suite that never reported, a shard set with a gap, a duplicated shard, an empty `<testsuites/>`, a truncated XML body, a 6 MiB report, a 40-level-deep suite nest, a `flakyFailure` with no `<failure>`, a summary block that contradicts its own rows.
- [ ] Every adapter and every transport is run against the whole corpus, and the assertions are on the **canonical result** — never on the producer's own vocabulary. A transport that cannot express a fixture's semantics fails, rather than passing by dropping the field.
- [ ] `adapter-parity.test.ts` is generalised from adapter-vs-adapter to **every implementation of the producer contract, including both transports**. The existing test is the template and the proof this is cheap.
- [ ] A pull adapter that cannot faithfully represent a vendor's semantics reports `not_configured` with the field it would have to discard. It does not round silently.

**Native adapters are justified only where JUnit is lossy.** The honest list, with the loss named for each: Allure (`statusDetails.muted`, per-result `flaky`, its own history model), Cypress (its own `retries[]` semantics), TeamCity (service messages, not XML), ReportPortal (launch-level aggregation). Everything else reaches us through JUnit and needs no client. Do not write a client for a tool that emits JUnit.

---

## 8. Wave 1 — the console can be trusted (interpret-first)

- [ ] **1.1 — The store can list.** Add bounded, workspace-scoped queries to `ReporterResultStore`: by time window, project, branch, environment. The `canonical_run_results_workspace_idx` on `(workspaceId, createdAt)` (`schema/dashboard.ts:266`) already serves the window query. Every query method is workspace-scoped and gets a cross-workspace isolation test, per AGENTS.md.
- [ ] **1.2 — A window is mandatory.** An unscoped request gets a bounded default window, not the whole table. The current route is honest about empty data (`kpi.ts:59`) but only because it *has* no data; nothing bounds it. `getReadiness` and the `mapRuns` batch loader are the named unmeasured gaps in `docs/quality/coverage-exclusions.md` — do not add a third.
- [ ] **1.3 — `calculateKpis` is already plural. Stop calling it with one element.** `reporting.ts:17` is the bottleneck, not the math. No new KPI mathematics in this task.
- [ ] **1.4 — Emit the two metrics that exist and are never reported.** `KpiReadModel.nonProduct` and `.unknown` are computed and thrown away. Two new metrics, no new math:
  - **`non-product-rate`** — the rate at which the *harness* decided rather than the product. Nobody else publishes this, and it is the direct measure of how much of every other number on the page is untrustworthy. It is a health metric *about the reporting system*, and it is the one a QA lead will care about most, because a 30% non-product rate explains every surprising trend below it.
  - **`proof-ceiling-distribution`** — the share of runs in the window at each ceiling. A trend chart of the product's own trustworthiness. It is the only KPI whose improvement is about us rather than about the code, and it is the one that proves D1 is real.
- [ ] **1.5 — Build the KPI tile as a component, not a page.** Value, denominator, exclusions with reasons, ceiling chip, confidence chip, freshness, and a "how this was computed" affordance. **If `proofCeiling` is below `verified` or `completeness` is not `complete`, the tile renders as `not knowable` and names the weakest link — it does not render a number with a warning icon.** A number next to a caveat is the failure this product is built against.
- [ ] **1.6 — Landing surface: release confidence.** One verdict from `evaluateQualityGate` with its `reasons[]`; the shard accounting from `evaluateCompleteness` (`missingShards` / `duplicateShards` / `unexpectedShards` — computed today, rendered nowhere); and a stacked bar of product / indeterminate / non-product attempts that **must sum to the population**, which is the invariant `kpi.ts:85-87` already asserts for the read model and no view asserts.
- [ ] **1.7 — Replace `avgDurationMs` or delete it.** `analytics.tsx:60-64` renders a mean where the engine offers `duration-p50` and `duration-p95`. Two definitions of one metric in one product, and the UI holds the flattering one. Either the tile becomes p50/p95 or the field goes; a mean that hides a p95 tail has no place on a screen whose argument is honesty.
- [ ] **1.8 — Make the quarantine route reachable.** `dashboard/quarantine.tsx` has a test suite and is absent from the route manifest, so `Sidebar` never links it. Reachability is a one-line change with a 111-line test suite already behind it.

---

## 9. Wave 2 — triage, as proposals only

Governed by D3's invariant, which is a test, not a sentence.

- [ ] **2.1 — The invariant test.** Assert that no action can be applied to a population whose `proofCeiling` is below `verified` or whose `completeness` is not `complete`. It fails the moment a proposal is auto-applied.
- [ ] **2.2 — Ranked fingerprints.** `fingerprint()` exists; `failure_clusters`, `known_failures`, and `defect_categories` are unwired. Lead metric: **offender concentration** — what share of all failures sit in the top 5 fingerprints. It turns "we have a lot of flakiness" into "fix these five," which is the only version of the sentence anyone acts on.
- [ ] **2.3 — A proposal is a diff, not an action.** "Fingerprint `abc` failed 14 of 60 runs over 9 days; quarantine it" renders with the state it would change, and is applied by a human. A proposal that cannot be wrong about its own evidence carries its ceiling with it.
- [ ] **2.4 — Quarantined tests are excluded with a stated reason.** `KpiReadModel.exclusions` has the slot (`kpi.ts:19`). A quarantined test silently removed from the denominator is the classic flattering metric, and the read model was built to make it impossible to do quietly.
- [ ] **2.5 — `time-to-triage`**: first failure sighting → human decision, per fingerprint.

---

## 10. Cross-run metric boundary (consequence of D4)

Compute-on-read is cheap for **run-level** metrics and expensive for **per-test** ones, because `canonical_run_results.result` is a JSONB blob (`drizzle-reporter-ingestion.ts:59`) with no per-test row.

- Run-level (`first-pass-rate`, `execution-failure-rate`, `flake-rate`, `duration-p50/p95`, `non-product-rate`, `proof-ceiling-distribution`) — computed on read. No projection.
- Per-test (offender concentration, per-test stability over time, `time-to-triage`) — needs a projection written at ingest.

**A projection is not a second authority, and the line is exact:** the canonical row is written first and is authoritative; the projection is derived from it; and a gate recomputes the projection from the canonical row and fails on any divergence. That is the same rule D4 applies to rollups, and it is why D4 does not forbid projections — it forbids a number that exists nowhere else.

---

## 11. Failure modes, named

| # | Failure | Mitigation |
|---|---|---|
| F1 | Console reports `not knowable` about a system with a year of test history, because the door and the KPI endpoint write disjoint tables | Wave 0 task 0.7 is the merge gate |
| F2 | Same JUnit file, two answers | Conformance corpus (§7); `adapterVersion` in `provenance` makes divergence diagnosable after the fact |
| F3 | A trend window whose left half was ingested by adapter v1 and right half by v2 — a chart that lies in a way no tile can warn about | Break or mark the series at `adapterVersion` boundaries; the field already exists |
| F4 | An automated action on a low-confidence population manufactures green | D3's invariant, as a test (2.1) |
| F5 | Unbounded query on an unscoped request | Mandatory bounded window (1.2) |
| F6 | Harness interruptions counted as product failures | Task 0.5 |
| F7 | A leaked ingest token | Hashed at rest, single-run, rotatable, never logged, no query-parameter path; `security:secrets` and `security:config-check` must not see it |
| F8 | A projection drifts from the canonical row | The recompute gate (10) |
| F9 | `RF-5` gets worse | D8: no new table before a recorded rehearsal. Wave 1 adds a projection and Wave 2 adds proposal state — both are new tables |
| F10 | A "health score" hides the partition | Banned by design. Small multiples, one per metric, each with its own ceiling. One number cannot show you the exclusions |

---

## 12. Validation

Red-first, per `.kilo/skills/evidence-test`: write the test, run it with the defect present, watch it fail for the expected reason, then fix.

**New gates, each red on the current tree by construction:**

- [ ] **The ceiling gate.** Walk every console route; assert no number is rendered without its `KpiReadModel`, and that a below-`verified` ceiling renders as `not knowable`. **This fails today at `analytics.tsx:60-64`**, which renders `passRate` and `avgDurationMs` bare. That is the point: the invariant currently lives only in JSON nobody renders.
- [ ] **The parity gate.** Every implementation of the producer contract, both transports included, against the whole conformance corpus, asserting on the canonical result.
- [ ] **The projection gate.** Recompute each projection from its canonical row; fail on any divergence.
- [ ] **The action gate.** D3's invariant, as an executable assertion.
- [ ] **The isolation test.** Every new store query method gets a cross-workspace rejection, per AGENTS.md.

**Existing gates that must stay green and are directly implicated:** `pnpm tenancy:check` (every new table must be registered in `docs/quality/tenancy-scope.json`, whose six tallies are derived and test-guarded), `pnpm findings:check` (the new row, `provenance: hand`), `pnpm docs:dead-exports` (0.4), `pnpm coverage:ratchet` (no floor is lowered — `coverage:baseline` is the authority, not the table in AGENTS.md, which is a reading aid and known stale), `pnpm verify`.

**Tiers and tooling.** Any new script gets a row in `scripts/gate-tooling.json` with a tier, per `.kilo/skills/gate-tiering`. The five conformance/boundary gates above are `pr-blocking` — they cannot fail open. Anything depending on an external binary is not.

---

## 13. Roadmap shape

| Wave | Ships | Gate |
|---|---|---|
| **0** | One ingestion system. Two parsers become one; one ladder reachable from every door; upload data becomes visible to analytics | 0.7 green; ledger row `fixed` with existing evidence |
| **1** | The console can be trusted. Store can list, windows are bounded, `non-product-rate` and `proof-ceiling-distribution` exist, every tile carries its read model, release-confidence lands | The ceiling gate green; tenancy green |
| **2** | Triage as human-approved proposals. Offender concentration, quarantine backlog, `time-to-triage` | The action gate green |
| **3** | Breadth. Push door for third parties, conformance corpus, native adapters only where JUnit is lossy, pull connectors opt-in | The parity gate green across both transports |
| **—** | `RF-5` closes only when `pnpm migrate:rehearse` has a recorded run against a real installation. Not a code task, and not closable on the strength of a harness. | D8 |

---

## 14. Out of scope

Multi-tenancy, RBAC, SSO/SCIM, iOS, an OLAP sidecar or any precomputed rollup, auto-quarantine or any unattended action, a `health score`, a client for a tool that emits JUnit, and re-litigating any part of the standing roadmap outside the console and ingestion surface.

## 15. Open questions

1. **Does `POST /api/v1/reporter/upload` have external consumers, or is it only the repo's own E2E suite?** Task 0.3 deprecates it in favour of one door. If a real deployment pushes to it, 0.3 needs an expand-contract migration rather than a redirect.
2. **Which vendors are actually pull-worthy?** §7 names four candidates. The honest answer is a usage measurement, not a market survey — and there is none today, because the store cannot list.
3. **`escaped-defect-rate` needs a defect→commit link.** `defect_categories` is `global` and unwired (`tenancy-scope.json:87-90`). Task 0.6 unblocks the data; the link itself is Wave 2 or later and is not yet scoped.
