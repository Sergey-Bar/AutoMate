# Findings remediation programme — 72 open rows

**Path:** `.kilo/plans/1790582734810-findings-remediation-plan.md`
**Scope:** every open row in `docs/quality/findings-ledger.json`.
**Plan of record:** `.kilo/plans/1790509811211-automate-v2-stabilization-release.md` ("v2 stabilization"). This plan does not replace it; it sequences the rows it left open.

---

## 0. What the backlog actually is

The 7 / 3 / 52 / 10 split in the brief is not an estimate. It is exactly the 72 rows with `status: "open"` in a 119-row ledger, and it reconciles against `docs/quality/findings-status.json`:

| Band | Open | Blocking band | Disposition required |
|---|---|---|---|
| Blocker | 7 | yes | `fixed` with evidence. May never become `debt` (`scripts/lib/findings-ledger.mjs:30`). |
| Critical | 3 | yes | `fixed` with evidence. May never become `debt`. |
| Major | 52 | no | Ratcheted. `debt` permitted **only** with `owner` + `removalCondition` (`:242`). |
| Minor | 10 | no | Ratcheted. `debt` permitted on the same terms. |
| **Total** | **72** | **10** | |

The plan of record's §9 wave table is keyed to a pre-W-A ledger of 89 rows. W-A landed and re-baselined on 2026-09-28, so **those counts are stale and the table's row totals do not match the tree.** Wave order still holds. The per-wave debits below are re-tallied from the current file.

### The gate that governs all 72

`confirmationProblems` (`scripts/lib/findings-ledger.mjs:320`) refuses to let any `provenance: "sweep"` row reach `fixed` without `confirmed: true`, or a `false-positive` disposition carrying a `refutedBy` note.

- 66 rows are `sweep`. 15 carry `confirmed: true`.
- **50 of the 72 open rows are unconfirmed `sweep` rows** and cannot close until a human reads them against the code.

W-A step 3 was never finished. This is the first executable task in the programme, and it is the reason a sweep-driven backlog cannot simply be "fixed in band order".

### Corrections to the ledger found while verifying

Three rows do not say what the tree says. They are corrected here rather than "fixed" as written.

| Row | Ledger claim | Verified tree | Consequence |
|---|---|---|---|
| **X-4** | "no `package.json` in this repository declares `@automate/automation`" | `apps/api/package.json:17` declares it; `infra/docker/api.Dockerfile:9` builds it. Zero *source* imports exist. | The "delete the dangling manifest line" reading is closed off. The work is purely wiring a leaf package into a chat route. |
| **P-6** | "three startup-policy authorities" | Two restate thresholds independently: `packages/config/src/config.ts:8-22` and `apps/api/src/startup-policy.ts:85-141`. They agree on 32 for cookie/vault and disagree on 16 for the other four. | Same fix, but the second authority is a *copy*, so the fix is "derive from the schema", not "reconcile two lists". |
| **X-3** | Critical band | `apps/api/src/routes/agents.ts:40,63` returns 501 for all 15 domain/action pairs. The row's own summary says calling these defects "would be wrong" — they are honest answers for unbuilt product. | Re-banded to Major and re-pointed at BK-1 (see §1, decision A). |

---

## 1. Decisions this plan executes

**A. X-3 is re-banded Critical → Major and re-pointed at BK-1.** The blocking band cannot be emptied by fixing X-3, because closing it means building the browser/api/load/security/mobile execution adapters, and the plan of record §11 defers BK-1 as "the natural v3.0 content". The 501 is not a defect: it is a distinct status from the 404 beside it, it names the domain and action, and `agents.test.ts:18,26` already pins it. Re-banding is legal — the ratchet guards `status`, not `band` (`findings-ledger.mjs:343-359`). The row closes as a ledger correction whose evidence is the re-banding, the BK-1 entry criterion it is re-pointed at, and the two agent tests that keep the 501 honest. This is the one row in the programme closed by a decision rather than a code change, and it is named as such.

**B. Phase 1 is the blocking band; Phase 2 is the wave programme.** 10 rows, then 62.

**C. Severity sets the gate, dependency sets the order.** Inside Phase 1 the order is *not* band order. `C-3` (error surface) lands **last** in Phase 1 despite being Critical, because it rewrites 42 call sites and every earlier fix would be re-touched to add a `code`. Ordering by band here would buy a clean-looking table at the cost of a second pass over all of Phase 1.

**D. S-1…S-7 are fixed, not deleted.** D7 is delete-or-wire, one PR each, and `InMemorySessionService` is only reachable in tests. The precedent is already set: `R-1`…`R-6` are the same call on `packages/realtime/src/bus.ts`, and every one closed as `fixed` rather than deleted. Deleting the in-memory session service would also delete the seam W-D.4 fault injection needs.

**E. Every row is scheduled, none is waived.** Six rows cannot be closed by writing code. They get their own execution strategy in §5 rather than being dropped:

| Row | Class | Why it is not a code fix |
|---|---|---|
| RF-9, PERF-1 | Measurement | `performance/thresholds.json` and `performance/rendering-budget.json` both ship `recorded: false` with nulls. The number must be taken on reference hardware (a self-hosted single-node install — a GitHub runner is not it, per plan §6 D10). |
| G-4b | Environment | pip-installed `semgrep.exe` never returns on the Windows host. CI is unaffected. No repository change fixes it. |
| C-6 | Decide-then-act | ~35 dormant tables. Each needs a reader, writer, route, UI and test, **or** a written justification in `docs/quality/capability-justification.md`. The ledger is explicit that the justification is an acceptable outcome. |
| O-2, O-3 | Describe-first | Both name an id without naming a claim. A row with no claim cannot be confirmed, fixed, or refuted. The work is to recover the claim from the superseded plan, then treat it normally. |
| C-1, RF-6, RF-12, D-4 | Bookkeeping | Ledger, capability-register and gate-manifest truth. No product behaviour changes. |

---

## 2. Prioritization logic

Applied in this order. A row that fails an earlier test waits, regardless of band.

1. **Confirmable.** Unconfirmed `sweep` rows rank by nothing — they are read first, in bulk, because `pnpm findings:check` refuses to close them. A row that turns out `false-positive` is removed from the critical path and the plan gets smaller.
2. **Unblocks others.** RF-5 is a Blocker with no prerequisite and everything in W7 behind it. O-1 defines the fencing token P-70 consumes. D3 requires C-4's store split before W5's edits. Q-52 sits in `apps/api/src/infrastructure/artifact-store.ts` and is independent of the split — verified, so it runs in parallel.
3. **Live-path before test-path.** Q-52's `readAt` is reached from `LocalArtifactBytesStore.get` (`artifact-store.ts:160`); the digest check on `read` (`:115-120`) is test-only. Fixing the test-only method is the defect.
4. **Band.** Everything else, Blocker → Critical → Major → Minor.
5. **External lead time last, not first.** RF-9 and PERF-1 close last but their *preparation* (book the reference box, stand up the stack) starts in week-equivalent-one, because they wait on hardware rather than on code.

Explicitly rejected: closing a row because a fix exists. `F-8` is the worked example — the `encodeURIComponent` fix is already in the tree and the row is still `open` because no test was ever calibrated. "The code is right" is not a disposition.

---

## 3. Resource allocation

Six lanes. **No two PRs in the same lane merge in the same window** (D11: the wave is the merge unit).

| Lane | Surface | Phase 1 rows | Phase 2 rows |
|---|---|---|---|
| **L1** | Execution & durability — runner, spool, leases, state machine, artifacts | O-1, P-70, Q-52 | P-14 |
| **L2** | Data, tenancy, migrations, crypto, store shape | RF-5 | C-4, Q-47, Q-49, Q-50, Q-51, Q-53, C-6, O-2, O-3 |
| **L3** | Connectors & AI gateway | P-12, P-13, X-4 | P-24, G-1…G-8 |
| **L4** | API contract, error surface, config authority | P-6, C-3 | P-57, P-62, P-63, P-72 |
| **L5** | Ingestion, auth, observability, performance | — | S-1…S-7, R-7, F-4…F-8, O-2b…O-5b, P-55, Q-55, P-56, Q-56 |
| **L6** | Web client, docs, gates, measurement | — | W-3…W-9, C-1, C-2, D-4, G-4b, RF-6, RF-9, RF-10, RF-11, RF-12, PERF-1 |

**PR sizing (D11, ≤400 lines/PR).** One defect row = 1 PR containing two commits — the fail-before test, then the fix — because the repo's own standard is a test *shown to fail before the fix and pass after*, not two PRs. Multi-file rows and rows touching a migration get 2–3. A bookkeeping row is 1. A product build is sized by its own sub-waves.

**Gate budget (D6/D17).** `verify` is at 14 of a maximum 20 steps. This programme adds `test:property`, `test:fuzz`, `test:mutation`, `test:e2e:matrix`, `test:e2e:flake`, `test:visual`, `migrate:rehearse` and `docs:check`. **Only `test:property` enters `verify`.** Every other one gets a `scripts/gate-tooling.json` row with a tier in the same PR that adds it, or `scripts/lib/gate-tooling.test.mjs` fails. Six steps of headroom remain; if a new gate needs a `verify` step, something already in `verify` has to leave it, and that trade is recorded.

---

## 4. Schedule

Sequence + gates + size class + PR count. No durations — see §7.

### Phase 0 — Confirmation (prerequisite, 0 rows closed)

| # | Task | Exit gate | Size | PRs |
|---|---|---|---|---|
| 0.1 | Read all 50 unconfirmed open `sweep` rows against the code. Each gets `confirmed: true` + `confirmedOn` + `confirmedBy`, **or** `false-positive` + `refutedBy`, **or** a re-band. | Zero open `sweep` rows without a disposition. `pnpm findings:check` green. | M | 2 |

Do this in two batches — Phase 1's rows, then Phase 2's — so the ledger diff stays reviewable. Read-only work; the PRs touch one file. **Expect the count to move.** Three rows have already been found wrong by inspection (X-4, P-6, X-3), and the ledger's own W-A note says three quarters of stale `sweep` rows have since been fixed in the tree.

### Phase 1 — Blocking band (10 rows)

| # | Wave | Rows | Bands | Entry gate | Exit gate | Size | PRs | Depends on |
|---|---|---|---|---|---|---|---|---|
| 1.0 | Ledger re-banding | X-3 | Critical → Major | X-3 read and confirmed | Band changed, BK-1 criterion recorded, `agents.test.ts` still green | S | 1 | 0.1 |
| 1.1 | Migration rehearsal | RF-5 | Blocker | W0 green | `pnpm migrate:rehearse` restores a post-migration database **and re-opens every encrypted row**; a run that opens zero rows fails | L | 4–6 | 0.1 |
| 1.2 | Startup policy authority | P-6 | Blocker | 1.1 merged | One floor (32) in `packages/config`; `startup-policy.ts` derives it; every credential fixture audited | M | 3–4 | — |
| 1.3 | Fencing token | O-1 | Blocker | 1.2 merged | `canTransition`/`transition` take a token; a lapsed lease cannot finish the job | M | 2–3 | 1.2 |
| 1.4 | Lease and subscription defects | P-70 | Blocker | 1.3 merged | Lease id consumed not discarded; key-order-independent hash; illegal transition refused; `writeSSE` rejection handled; abort-window subscription leak closed | M | 2–3 | 1.3 |
| 1.5 | Artifact reader integrity | Q-52 | Blocker | 0.1 only | `readAt` caps size and verifies digest; local and S3 stores agree on the cap | S | 1–2 | — |
| 1.6 | Connectors | P-12, P-13 | Blocker ×2 | 1.3 merged | Real base URL, secret sent, `operation`/`input` honoured, Slack `ok:false` classified; `executeWithRetry` reads `manifest.operations[op].idempotent` | M | 3–4 | — |
| 1.7 | Wire the AI gateway | X-4 | Critical | 1.6 merged | Chat route streams through `AiGateway`; composition root picks the provider from config; SSE frame the client already reads | L | 4–6 | 1.6 |
| 1.8 | Error surface | C-3 | Critical | 1.1–1.7 merged | 0 of 42 `error(c, …)` sites; 0 of 25 bodies without a `code`; a source-level gate fails on both | L | 6–10 | all |

**1.1 detail, because it is the largest single item.** `scripts/lib/vault-rehearsal.mjs` and its test already exist — the verifier half, as a pure function with the opener injected. What is missing is the orchestration: a `pnpm migrate:rehearse` that dumps, migrates, restores, and then runs the verifier over every encrypted row, plus a report whose `rehearsalPerformed` field is `true` and whose `performedPhases` names the phases. `pnpm smoke:rehearsal` is a local-target guard and is not this. Three properties make it a gate rather than a log line, and each is already a test: every row is attempted, a run that verified nothing fails, and nothing-opening is reported as a probable key problem rather than N unreadable rows.

**1.2 detail, because it was reverted once.** Raising all seven secrets to 32 broke 21 tests across three files, and the second failure was a design finding, not a test nuisance: at a 32 floor a 9-character `change-me` fails the *length* check before the *placeholder* check, so every assertion that a placeholder is rejected becomes unreachable. Sequence it: audit every credential fixture in the repository first, then change the floor, then re-order the checks so the placeholder guard is reachable at any length. The ledger's `DEVELOPMENT_COOKIE_SECRET` literal (`startup-policy.ts:13`) is part of this row's title and part of its fix.

**1.5 detail.** `s3-artifact-bytes.ts:206` already caps at `DEFAULT_MAX_ARTIFACT_BYTES` (64 MB). The local store is the outlier and has no cap at all. One cap constant, one digest policy, both stores.

### Phase 2 — Wave programme (62 rows)

| # | Wave | Rows | Bands | Entry gate | Exit gate | Size | PRs | Depends on |
|---|---|---|---|---|---|---|---|---|
| 2.0 | Gates and measurement truth | D-4, C-1, G-4b, RF-6 | 3 Major, 1 Minor | — | `verify` trustworthy on this host; every gate obligation has a row | S | 2 | — |
| 2.1 | Property and fuzz harness | *(0 rows — new gates)* | — | 2.0 | `pnpm test:property` and `pnpm test:fuzz` exist and fail on the known defects | M | 3–4 | 2.0 |
| 2.2 | Durability and correctness | P-14, P-24, P-72, P-57, P-60, P-62, F-4, F-5, F-6, F-7, F-8 | 8 Major, 1 Minor | 2.1 | Every item has a fail-before test | L | 9–12 | 2.1 |
| 2.3 | Split the store, then fix it | C-4, Q-47, Q-49, Q-50, Q-51 | 5 Major | 1.1 merged | Complexity offenders do not increase; `:1357` (65) and `:1098` (39) split | L | 6–9 | 1.1, 2.2 |
| 2.4 | Tenancy, remaining | O-2, O-3 | 2 Major | 2.3, 1.1 | Each row states its claim, then is confirmed and dispositioned | S | 2 | 1.1 |
| 2.5 | Error surface, remaining | P-63 | Minor | 1.8 | One health literal, one shared agent error builder | S | 1 | 1.8 |
| 2.6 | Dormant schema | C-6 | Major | 2.3 | Every table has a reader and a writer, **or** a justification | L | 5–8 | 2.3 |
| 2.7 | AI gateway | G-1…G-8 | 7 Major, 1 Minor | 1.7 | A provider outage changes no outcome | M | 5–7 | 1.7 |
| 2.8 | Sessions and realtime | R-7, S-1…S-7 | 4 Major, 3 Minor | 2.2 | `computeBackoff` refuses `NaN`; the in-memory service matches the durable one | M | 5–7 | 2.2 |
| 2.9 | Observability and resource | O-2b, O-3b, O-4b, O-5b, P-55, Q-55, Q-53, P-56, Q-56 | 9 Major | 2.7 | One execution traceable by one id; a failed sweep is distinguishable from a quiet one | L | 7–10 | 2.7 |
| 2.10 | Web client | W-3…W-9 | 6 Major, 1 Minor | 2.9 | No defect in the band is open | M | 5–7 | 2.9 |
| 2.11 | Docs, register, contracts | C-2, RF-12, RF-11, RF-10 | 4 Major | 2.10 | `pnpm docs:check` green, zero unbacked claims; OpenAPI generated from Zod with a drift gate; E2E on 3 engines | M | 4–6 | 2.10 |
| 2.12 | Measurement | RF-9, PERF-1 | 2 Major | 2.11, 1.1 | `recorded: true` with non-null values; tier raised in the **same commit** | M | 2 | reference hardware |

**2.1 is a prerequisite, not a row.** Plan §5 constraint 7 requires W-C.3 and W-C.4 to land *before* W4's fixes to the same code, because P-3, P-23, P-60, F-6 and F-7 are all property/fuzz failures waiting to be written. Both are generated-corpus gates with no new dependency beyond `fast-check` (D18). `test:property` is the one gate this programme adds to `verify`.

**2.12 preparation starts at 2.0, not 2.12.** These two rows wait on a self-hosted single-node box, not on code. Book the hardware and stand up the stack in 2.0 so the run is not blocked when the rest of the programme arrives. The promotion rule is strict: recording the run and raising the tier is **one commit**, and `render-gate-phase.mjs` fails if only one happened — so `recorded: true` beside invented numbers cannot become a permanently green, unenforced gate.

**2.6 is a decision wave, not a build wave.** ~35 tables in `schema/dashboard.ts` with no reader and no writer. For each: build it, or write the justification in `docs/quality/capability-justification.md`. `locator_suggestions` has no `updatedAt` at all. Triage the tables first and commit the split; building 35 tables in one wave is not a wave.

**2.11 note on RF-10.** Narrow the *full* 3-engine matrix to nightly and run a Chrome+WebKit pair on PRs, or PR cost becomes unbounded. WebKit is not optional: `backdrop-filter` has its longest rendering history there, so it is the engine that will catch a glass bug. Keep the existing non-empty-project assertions and the CI guard that throws when `product` matches nothing — a three-project config where only one collects is worse than one project, because it looks like coverage.

---

## 5. Per-band execution strategy

### Blocker (7 → 6 after 1.0)

**Prioritization.** No sub-ordering: all seven are in Phase 1. Band order is irrelevant when the whole band ships before anything else.

**Resource.** Lanes L1 (O-1, P-70, Q-52), L2 (RF-5), L3 (P-12, P-13). Three lanes in parallel; L1 internally serial because O-1 → P-70.

**Execution.** Per §4, 1.0–1.6. Each row: confirm (if `sweep`) → write the fail-before test, run it, watch it fail for the right reason → fix → watch it pass → record `evidence[].path` + `asserts` → `pnpm findings:baseline` once, deliberately.

**Exit.** `pnpm findings:check` reports zero open Blocker rows. `pnpm verify` green on a host where `security:static` can complete — see G-4b, which is a Phase 2 row and therefore a known reason `verify` cannot go fully green on Windows during Phase 1.

### Critical (3 → 2 after 1.0)

**Prioritization.** X-4 before C-3, because the chat route C-3 rewrites should be born carrying a `code`. C-3 last in Phase 1 for the same reason.

**Resource.** L3 (X-4, one lane, self-contained product wave) then L4 (C-3, the widest single refactor in the programme at 6–10 PRs).

**Execution.** X-4: composition root constructs the concrete gateway from config; chat route depends on the two-method `AiGateway` port, not on a provider; SSE frame the client already knows how to read. C-3: migrate all 42 sites to `DomainError`, add `code` to all 25 bare `{ error: string }` bodies, then land the source-level gate that fails on either regression. The gate is what makes the row closeable — 42 migrated call sites with no gate is a finding waiting to come back.

**Exit.** Zero open Critical rows; a lint/grep gate fails on `error(c,` and on a body without `code`.

### Major (52)

**Prioritization.** By wave, subject to §2. The constraint that bites: D3 — C-4's split of `drizzle-execution-store.ts` (2 166 lines, `:1357` complexity 65, `:1098` complexity 39) lands **before** W5's edits to the same file, because six tasks target it and fixing before splitting re-bases the work.

**Resource.** All six lanes. This band is where lanes actually parallelise: L2 (data), L3 (gateway), L5 (ingestion/auth/observability) and L6 (web/docs) have no Phase 1 dependency at all once 2.0–2.1 land.

**Execution.** Two subgroups:

- **Defect rows (43).** The standard loop above. Watch for the two recurring traps this ledger has already caught: a fix landing on the *test-only* method while the live reader stays broken (Q-52's shape), and a "fix" that cannot fail because the fixture did not match what the code walks (F-8's shape). If a test cannot be calibrated, the row stays `open` — `F-8` is the precedent, and it is correct.
- **Non-defect rows (9).** C-6 decide-then-act; O-2 and O-3 describe-first (recover the claim from `.kilo/plans/1790482134837-automate-merged-leftover-plan.md`, write it into the row, *then* confirm and disposition — a row with no claim cannot be closed or refuted); RF-9, PERF-1, RF-10, RF-11 measurement/gate build; G-4b environment.

**Exit.** Zero open Major rows, or each remaining one `debt` with a named `owner` and a `removalCondition` that names a thing which could happen. Never "in the future".

### Minor (10)

**Prioritization.** Last, and not because they are unimportant — P-63 belongs in the same PR as C-3 because it is the same duplication, and S-5/S-6/S-7 are one decision with S-2 (there is no `deleteExpired` because the interface has no expiry sweep).

**Resource.** Folded into the lanes that already own the surface. **Zero standalone PRs are justified**; each Minor ships inside its Major's PR and is recorded in the same ledger commit. This is the only band where that is true, and it is why the band is last.

**Execution.** Ten rows: P-63 (with C-3), S-5/S-6/S-7 (with S-1…S-4), F-8 (with 2.2), G-6 (with G-1…G-8), W-9 (with W-3…W-8), D-4, C-1, RF-6 (with 2.0), RF-12 (with 2.11).

**Exit.** Zero open Minor rows, or `debt` with owner and removal condition.

---

## 6. Validation

Per row, before the row is marked `fixed`:

1. The test was **run and observed failing** before the fix, for the reason the row names.
2. `pnpm --filter <pkg> test` green.
3. `pnpm typecheck` and `pnpm lint` green.
4. `evidence[]` paths exist — `findings:check` fails on a `fixed` row whose evidence path stopped existing, so a deleted test reopens its finding.
5. `pnpm findings:baseline` run **once, deliberately**, never as a side effect of a failing check.

Per wave, before the exit gate is claimed:

6. `pnpm findings:check` — zero regressions, zero vanished rows, no status moved backwards.
7. `pnpm verify` — full chain. Any new gate added in this wave has its `scripts/gate-tooling.json` row and a tier.
8. `pnpm coverage:ratchet` — no floor regressed, **none lowered**. A newly-measured file must be genuinely covered on the same PR.
9. `pnpm complexity` — offender count did not increase against `docs/quality/complexity-baseline.json`.
10. `pnpm security:verify` — audit, secrets, config check, static, licence, duplication, complexity, capability register, findings. Cannot go fully green on the Windows host (G-4b); run it on CI or in WSL rather than weakening the ruleset for one machine.

Per phase:

11. **Phase 1 exit:** `pnpm findings:check` reports zero open Blocker and zero open Critical rows.
12. **Phase 2 exit:** zero open rows of any band — the release criterion R2. Not "the count reached zero": a sweep is a point-in-time reading, and R2 means every confirmed defect has a disposition and none is open.

Cross-cutting, non-negotiable: no `.skip` or `.only` in committed code; no deleted or skipped failing tests; no lowering a coverage floor to make room; a test that cannot fail is worse than no test.

---

## 7. Risks

| Risk | Response |
|---|---|
| Confirmation shrinks the backlog materially and the schedule is wrong | Expected, and the reason Phase 0 exists. Three rows were already wrong on inspection. The wave *order* survives a count change; only the counts move. Re-tally after `pnpm findings:baseline`. |
| X-3's re-banding is read as weakening the ledger | It is the opposite: the row's own summary says these are not defects, and a Critical band on a row that cannot be closed forces an exception to the "never debt" rule for every future row. The re-banding is recorded with its reason and the BK-1 criterion it defers to. |
| Phase 1's product work (X-4) is underestimated | It is a composition root, a streaming route and an SSE frame. It has no precedent in this repo, because the package has never been imported. Sized L with 4–6 PRs and given its own lane. |
| C-3's 42-site refactor collides with 2.2's fixes to the same routes | C-3 lands in Phase 1, 2.2 in Phase 2. The two are a full phase apart by design. Do not pull C-3 later. |
| G-4b blocks `pnpm verify` on the dev host for the whole of Phase 1 | Known and accepted. `verify` cannot be fully green on Windows until 2.0; run the full chain on CI. Do not weaken the semgrep ruleset for one host. |
| O-2 and O-3 turn out to name defects nobody can reconstruct | They close as `false-positive` with a `refutedBy` note naming the superseded-plan line that could not be recovered. That is a legitimate outcome and the disposition exists precisely so it is recordable. |
| The `verify` budget (14 of 20) is consumed | D17 keeps exactly one new gate in `verify`. Six steps of headroom. Every other gate is a CI job or nightly. |
| A `fixed` row's evidence is deleted later | `findings:check` fails on it. That is the ratchet working, not a nuisance — do not "fix" it by removing the evidence entry. |

---

## 8. Out of scope

- **BK-1…BK-5, BK-7, BK-8** stay deferred with the plan of record's entry criteria. X-3 is re-pointed at BK-1 and this plan does not build it.
- **Hosted SaaS, multi-tenant isolation beyond `WORKSPACE_ID`, user/RBAC/SSO/SCIM, iOS execution, Redis/Kafka/Kubernetes/Helm, a second orchestrator, a general workflow engine, arbitrary untrusted shell execution, MCP gateway, Tauri desktop, mobile/native** — unchanged from plan §11.
- **D4 stays reversed.** No `JobHandler` in `apps/worker`, ever. `apps/worker/src/main.ts:100-123` documents it and `worker.test.ts` pins it. RF-5 in Phase 1 makes no change to this.
- **New issue discovery.** This programme dispositions the 72 rows that exist. It does not re-sweep; the next sweep will find more, and the ledger is where they land.
- **No calendar estimates.** The schedule is expressed as order, gates, size class and PR count. Effort in hours or days is not modelled here, and any figure produced outside this plan is not a commitment.

---

## 9. First five actions

1. **1.0** — re-band X-3 to Major, re-point it at BK-1, amend plan §11/§12. One commit, and it changes the blocking band from ten rows to nine.
2. **0.1 (batch 1)** — confirm the 4 unconfirmed `sweep` rows in the blocking band: P-12, P-13, O-1, Q-52.
3. **1.1** — start RF-5. Longest lead item in the programme, zero prerequisites, and the gate in front of the tenancy wave.
4. **1.5** — Q-52. Smallest Phase 1 row, independent of everything, and the only one that can land the same day it starts.
5. **2.0's external track** — book the reference hardware for RF-9 and PERF-1. It is the only dependency in the programme that is not a person writing code.
