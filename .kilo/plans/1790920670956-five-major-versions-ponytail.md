# Five major versions — ponytail edition

Product plan for v3.0 → v7.0. Top-tier QA discipline: every version ships on a measurement,
not an assertion.

---

## Context — the census

| Measure | Value |
|---|---|
| Version today | `2.2.0`, **not tagged** (`CHANGELOG.md:5-11`) — release gate's OCI half is red |
| TypeScript | 93,160 lines; `apps/api` alone is 44,296 (47%) |
| `scripts/` | **19,047 lines**, of which **6,463 (34%) are self-tests of the gates** |
| Root scripts | 63 declared, 42 tiered `pr-blocking`; `verify` chains 15 steps against a budget of 20 |
| Capability register | 42 rows — **16 `real`, 14 `mock`, 2 `missing`, 8 `deferred`, 2 `obsolete`** |
| `pnpm status:10` | **0 pass, 0 fail, 12 `not_configured`** — the roadmap's own definition of done scores nothing |
| Findings ledger | 143 rows — 122 `fixed`, 9 `open`, 7 `debt`, 5 `false-positive`; zero open Blockers |
| Quality domains | 1 `real` (browser), 4 `deferred` — all four answer `501 NOT_CONFIGURED` |
| Complexity | `ceiling: 15` (target 10), 29 offenders, `worst: 73` |
| Coverage | Ratcheted per package; healthy at `apps/api` (95/86/94/97), thin at `apps/worker` (63/57/69/65) |

### Three findings that shape the plan

**1. The plan of record is not in the repository.** `.git/info/exclude:9` excludes `.kilo/`, and
`.kilo/plans/` is empty on disk. Yet D1, D6, §1, §16, §17's twelve points, BK-1, and the W1–W17
wave table all live there — and 143 ledger rows carry a `wave` field that only that document
defines. Nothing in CI can read it. **Standing rule 3 below exists because of this.**

**2. The project's own sequencing rule fired and nothing noticed.** `findings-ledger.json:2695` —
RF-5's `removalCondition`: *"or (b) W7 entering scope, at which point this row returns to `open`
and `Blocker` immediately and no merge gate runs green until (a) is done."*

W7 **is** in scope. Seven W7 rows are `fixed` (P-7, P-8, P-9, P-10, P-11, P-23, P-24) and five
tenancy migrations are on disk: `0015_schedule_workspace_scope.sql`, `0017_outbox_workspace_scope.sql`,
`0018_chat_workspace_scope.sql`, `0019_sp_private_key_sealed.sql`,
`0020_connector_credentials_tenant.sql`.

RF-5 is still `debt`/`Major`. Seven documents still assert the opposite — `AGENTS.md:194`,
`docs/migration/unified-repository-migration.md:24`, `site/operations.md:61-64`, `CHANGELOG.md:158-160`,
`SECURITY.md:66-68`, `docs/adr/003:41-43`, `docs/adr/006:44-45`, `gate-tooling.json:229`.
`SECURITY.md:66` — *"a tenancy vulnerability becomes reportable the moment W7 enters scope"* — is
live now and the doc says it is not.

Nothing machine-checks it: `.github/review-rules/merge-gate.json:32` sets
`blockingStatuses: ["open"]`, so `debt` is invisible to the merge gate **by design**.
RF-5's own resolution claims *"the gate notices rather than the roadmap"* — false as configured.

**3. Every defect that mattered was found by running something.** The E2E lane against real
PostgreSQL found 7 blockers in one run (2/19 → 19/19). The release gate's first-ever execution
found a flaky test and a Dockerfile that could not build. `pnpm db:migrate` failed on every
invocation. **Zero of the 6,463 lines of gate self-tests found any of them.**

### The diagnosis

The QA apparatus is inverted. It has near-total coverage of the gates and near-zero coverage of
whether the gates earn their keep. Meanwhile the honesty machinery — the register, the ledger,
`status:10` — is genuinely good, which is why the real problem is not hidden: it is documented,
and it is not being acted on.

---

## Standing rules — every version obeys all five

1. **No gate without a catch.** Every gate records the defect class it caught and the commit.
   A gate that cannot name one is deleted, not kept "just in case".
2. **Evidence then raise, never raise alone.** Every tier change to `pr-blocking` lands in the
   same commit as the measurement that justifies it. `scripts/lib/render-gate-phase.mjs` and
   `gate-tooling.test.mjs` already enforce this for `test:render`. Make it the pattern for all five.
3. **A rule in prose is not a rule.** Every load-bearing decision (D1, D6, §1, §16, §17) becomes a
   JSON field or an assertion in a gate that already runs. **Nothing may depend on the plan of
   record**, because it is not in the repository.
4. **Deletion is a deliverable.** Each version is net-negative on `scripts/`. It names what it removed.
5. **The register is the scoreboard.** A version ships when its rows are `real`, not when its code
   merges. 16/42 today; 38/42 at v7.0.

---

## v3.0 — The install works

**Thesis:** a person can compose this, and what runs is a runner, not a build recipe.

**Breaking change:** the three runner images stop being 7-line stubs that print a version; the
process-local inventory and runner control plane become durable; the production `503` on
`/runner/v1` goes away.

### Tasks, in order

1. **Close the RF-5/W7 contradiction and make wave gating checkable.** First, because it is a
   Blocker-band contradiction in the project's own record and every task below lands on top of it.
   - Flip RF-5 to `open`/`Blocker` per its own condition (b), and record in the row the scope
     decision that was never written down.
   - Add `"blocksWave": "W7"` to RF-5. A `debt` row stays non-blocking in general; a `debt` row
     carrying `blocksWave` becomes blocking the moment any migration for that wave exists on disk.
   - One new file, `docs/quality/wave-gates.json`: wave → gating rows. `findings-check.mjs` reads it
     and fails when a migration exists for a wave whose gating row is not `fixed`. This is one file
     and one reader replacing seven prose assertions.
   - `merge-gate.json`/`merge-gate.mjs` grow the five-line `blocksWave` check.
   - Delete the seven stale prose assertions listed in Finding 2.
2. **Give the OCI gate a ledger row.** Commit `59bc019` repaired the release gate's OCI half and
   has no row — RF-6's own class: *"a gate with no row is a gate that can be skipped silently."*
   Add it, with `59bc019`, `b6691ed`, `b878212` as evidence.
3. **Real runner images.** `runners/playwright/Dockerfile` installs Playwright and the browser;
   `runners/k6/Dockerfile` copies the scenario; `runners/zap/Dockerfile` copies the config. Each
   keeps `USER 65532:65532`. `oci-checks.mjs` already asserts non-root, uid agreement,
   `network: "none"` and `readOnly: true` — so the images must satisfy isolation the manifest
   already declares. **This is what moves `runner.oci` from `mock` to `real`.**
4. **Durable control plane.** `runner.control-plane` is process-local and `503`s in production.
   Move enrollment, identity and lease into Postgres behind a repository. `runner_identities` was
   dropped in migration `0013`, so this is a new table and an additive migration.
5. **Durable inventory.** `orchestration.inventory` is process-local, but `schedules` already has a
   real table, a real worker and a `workspace_id` column from `0015`. The API-side service is
   reading process memory instead of the table it already has.
6. **Isolation for `tool.playwright`.** Results come from a pinned image in an isolated runner, not
   from the reporter path.
7. **Tag the release.** `CHANGELOG.md:5-11` — 2.2.0 was not tagged because the OCI half of the
   release gate was red. With task 3 and the `59bc019` repair, `pnpm verify:release` is green and a
   tag exists. **That tag is this version's real proof.**

**Deleted:** `buildStatus: "unbuilt"` and `imageDigest: null` from all three manifests (the gate
reads the build record, not the manifest); the production `503` branch.
**Not built:** a registry, image pushing, multi-arch manifests, a device farm.
**Exit gate:** `pnpm verify:release` green in `release-gate.yml`; a git tag exists; `runner.oci`,
`runner.control-plane`, `orchestration.inventory`, `tool.playwright` all `real`.
**Register:** 16 → 20 `real`. **Scripts:** net-negative (start the Stage 1 audit, see below).

---

## v4.0 — The product does its job

**Thesis:** the thing the product is named for actually runs.

**Breaking change:** `quality.mobile` and `quality.accessibility` are **retired as execution
domains**. `agents.ts` answers `404 AGENT_ROUTE_NOT_FOUND` for them rather than `501`. Four real
domains beat five where two are permanent `501`s — ADR-006 already rules out iOS device execution,
and a self-hosted single-node install has no device farm.

Accessibility does not disappear: it moves from product claim to CI gate.

### Tasks, in order

1. **Retire the two domains.** Drop both values from `AgentDomainSchema`
   (`packages/shared-contracts/src/schemas/agents.ts`). `apps/api/src/routes/agent-registry.ts`
   derives availability from the registry, so `/api/v1/features` follows automatically.
   `capability-register.mjs:53` enforces that every domain has a `quality.<domain>` row, so the two
   register rows go `obsolete` in the same commit. **Add accessibility as a pr-blocking route gate:**
   `e2e/accessibility/routes.spec.ts` using the `expectNoBlockingAxeViolations` that already exists
   and is used by exactly **one** component test today — this is UI-1's removal condition (a).
2. **`packages/tool-sdk`** — BK-1's entry criterion, which `X-3`'s removalCondition names as
   currently absent. One package: operation declaration, dispatch, result normalisation, error
   classification. **Reuse `packages/connectors/sdk`** — `executeWithRetry` already carries P-13's
   idempotency fix, and `operationSpec` / `requireString` / `optionalObject` already exist. Do not
   build a parallel.
3. **k6 adapter + threshold model** → closes `tool.k6` (`missing`), `quality.load` and
   `quality.performance` (`deferred`). `performance/thresholds.json` and `scripts/performance-gate.mjs`
   already hold the threshold model; the adapter parses k6's JSON output into run results.
4. **ZAP adapter + SARIF projection** → closes `tool.zap` (`missing`) and `quality.security`
   (`deferred`). The only genuinely new parser in this version.
5. **API adapter** → `quality.api` (`deferred`). Needs no external binary; the route already exists
   and the 15 pairs already return `501`.
6. **Retire or real `automation.agents`** (`mock`, static completed outputs). It is a second answer
   to a question the tool-sdk now answers. Either it dispatches through the tool-sdk or it is deleted.
7. **Close X-3.** Its removalCondition: Track B (W2) gate green **and** `packages/tool-sdk` exists
   **and** ≥1 domain has a real adapter. All three land here. Re-own or close **D-4**, whose owner
   is BK-1 and which ships in this version.

**Deleted:** two domains from the schema, the registry, the register and the site page.
**Not built:** mobile, accessibility-as-agent, a plugin marketplace, a domain SDK.
**Exit gate:** X-3 `fixed`; `tool.k6`, `tool.zap`, `quality.api`, `quality.load`,
`quality.performance`, `quality.security` all `real`.
**Register:** 20 → 25 `real`, 2 → 4 `obsolete`. **Scripts:** net-negative.

---

## v5.0 — It survives a restart

**Thesis:** nothing important lives in process memory.

**Breaking change:** the in-memory stores are deleted, `E2E_ALLOW_IN_MEMORY` is deleted, and every
config path that selected a store is deleted.

### Tasks, in order

1. **Grep every reader of the in-memory store, then delete it.** Task 1 is the grep, not the edit.
   `apps/api/src/execution/in-memory-execution-store.ts` holds complexity **73** (`:690`) and **71**
   (`:1042`) — the two worst functions in the repository. `complexity-baseline.json` records
   `worst: 73`, `count: 29`, `ceiling: 15`. Deleting this file is how Q-1's condition (a) becomes
   reachable without refactoring 29 functions that should not exist.
2. **C-4: split `drizzle-execution-store.ts`.** 2,166 lines holding the next two offenders (65 at
   `:1357`, 39 at `:1098` — the finding-49 transaction). Split by aggregate —
   claim / complete / lease / store — with that transaction intact across the seam.
3. **Durable credentials.** `auth.service-credentials` is process memory. `vault.persistence` needs
   DB-backed key rotation and audit; `audit_events` already has four writers, so rotation has
   somewhere to write.
4. **`automation.chat` and `automation.test-generation`** are deterministic in-process responses and
   static assertions with **no module at all**. Either give them providers and persisted provenance,
   or delete them. `automation.test-generation` has no module — the "mock" is a static array, which
   is the YAGNI rung.
5. **Decide `tools/migrate-cli`.** `migration.tool` is `mock` because *"no real source waves are
   actually applied"* — the unification shipped in 2.0.0. If no source remains: delete the tool, its
   five root scripts and the register row.
6. **Delete `E2E_ALLOW_IN_MEMORY`, `assertInMemoryAllowed`, and the eight fallback-logging call sites.**
7. **Wire or delete `reporting.advanced-analytics`** (`mock`, hard-coded trends and leaderboards).

**Exit gate:** no `mock` register row is process-local; `E2E_ALLOW_IN_MEMORY` gone; C-4 `fixed`;
complexity `worst` below 39.
**Coverage:** floors for `apps/api` rise because half the code is gone. The ratchet only moves up —
record the new floor deliberately, not by accident.
**Scripts:** net-negative.

---

## v6.0 — The gates can be armed

**Thesis:** every `pr-reporting` and every `not_configured` becomes `pr-blocking` or is deleted.

**Breaking change:** gate tiers change; `pnpm verify:local` is deleted.

**The number this version exists to move: `pnpm status:10` from 0 pass to non-zero pass.**

### Tasks — each is an evidence-then-raise pair, never a raise alone

1. **RF-9.** Run k6 on the reference hardware — ADR-006: a self-hosted single-node install, **not** a
   GitHub runner. Record observed p95/p99/error-rate in `performance/thresholds.json`, set
   `recorded: true`, tighten thresholds to the measured value, move `test:performance` to
   `pr-blocking` **in the same commit**. `render-gate-phase.mjs` already implements this
   derive-don't-choose shape; apply it here.
2. **PERF-1.** `pnpm render:baseline` on the reference hardware, review the diff, flip
   `recorded: true` and `test:render` → `pr-blocking` in the same commit. `gate-tooling.test.mjs`
   already fails if only one half happened.
3. **RF-5(a).** `pnpm migrate:rehearse` against the installation v3.0 made installable. Dump,
   restore to a clean instance, migrate **the restore**, re-open every sealed row through the
   product's own `vault-crypto`. Record date, installation, row count. **This clears RF-5 for real
   and unblocks v7.0.**
4. **`test:e2e` → `pr-blocking`.** `findings-status.json` records `E2E-3: "fixed"`, and
   `gate-tooling.json` states the graduation condition is exactly that. The condition is met and the
   tier has not moved — the same shape as RF-5.
5. **`security:static` → `pr-blocking`.** SEM-2 records **zero** blocking findings from `.semgrep.yml`
   (run `36962862652`, semgrep 1.178.0). `CHANGELOG.md:39-41` says the graduation condition *"is now
   met on the evidence rather than on a promise, but moving the tier is a separate recorded act with
   its own test behind it, and this release does not make it."* Make it.
6. **Q-1, all four clauses.**
   - **Mutation ≥ 75%** — Stryker with a `mutation-baseline.json` ratcheted exactly like
     `coverage-baseline.json`, so the score cannot be lowered silently. Five packages (see Open
     Questions) with a per-package time budget; `--changed` on PRs.
   - **Property/fuzz per invariant** — fast-check, on the two places where a naive join genuinely
     collides: **P-3**'s canonical serialisation (`digestRunOutcome` is key-order independent by
     construction) and **P-8**'s length-prefixed AAD (workspace `a`/name `b:c` vs workspace `a:b`/
     name `c` must not collide). Two suites, two invariants, both with a recorded instance behind them.
   - **Generated authz matrix** — fails when a route is added without a row. Build one mechanism and
     reuse it for v7.0's tenancy isolation matrix rather than writing two.
   - **Complexity ≤ 10** — `complexity-baseline.json` at `ceiling: 10`. **Sequence this after v5.0**,
     which deletes the two worst offenders as a side effect; most of the 29 are then already gone.
7. **CAP-1, both halves.** Add the `command` column to the register — `docs-drift.mjs` already ships
   the detector and is already in `docs:check`, so that half is unblocked. Then build
   `pnpm capability:evidence`, which derives each row's status by running its command and reports
   `unverified` when it fails. That turns the register from a document into a derived status.
8. **RF-11.** `@asteasolutions/zod-to-openapi` is already a `shared-contracts` dependency and
   `src/openapi.ts` already generates from the same Zod schemas the API validates against. Emit the
   document in `docs:capability-register`; fail `docs:check` on divergence. Reword BK-5's entry
   criterion to name the gate rather than the document's existence.
9. **RF-6 and RF-6a–d.** v3.0's task-1 mechanism is the general fix. Add W14 (axe in both themes),
   W15 (tiering inside the D6 budget), W17 (site-doctor's ten checks) and W2 (worker→runner on
   PostgreSQL) to `wave-gates.json`, each with a row that can go green.
10. **Delete `verify:local`.** It sets the host-scanner opt-in, which makes `security:static` exit 0
    **without scanning**. `CHANGELOG.md:100-102` calls that green *"the exact failure this repository's
    gate design exists to prevent."* Keep the opt-in **variable** — the policy and
    `host-scanners.test.mjs` need it. Delete the wrapper that applies it wholesale to `verify`.
11. **UI-1.** `status:10` point 4 moves to `pass` via v4.0's axe route gate plus a state-coverage
    matrix naming loading / empty / error / partial for every route, with a test per state.

**Exit gate:** `pnpm status:10` reports a non-zero `pass` count.
**Scripts:** net-negative, and the biggest single reduction of the five versions.

---

## v7.0 — More than one tenant

**Thesis:** `WORKSPACE_ID` stops being a configuration value and becomes a boundary you can test.

**Breaking change:** multi-tenant becomes a supported posture. `SECURITY.md:66` goes live — it went
live five migrations ago, and the document still says it has not.

### Tasks, in order

1. **Confirm RF-5 is `fixed`** from v6.0 task 3. If it is not, v7.0 does not start — that is RF-5's
   own condition (b), now machine-checked by v3.0's gate.
2. **Generate the isolation matrix.** One row per workspace-scoped route; one cross-workspace read
   and one cross-workspace write per row. `AGENTS.md` already requires this: *"Any new
   workspace-scoped read or write needs a cross-workspace isolation test."* Reuse the mechanism built
   for Q-1(d) in v6.0.
3. **Delete the 21 dormant tables (C-6).** `capability-justification.md` states plainly that nothing
   writes them, so the cost is migration surface and reader confusion. `locator_suggestions` goes
   **first**: it has no `updated_at` column at all, so a row in it is permanently current by
   construction. When the last row goes, the justification file goes with it.
4. **Give `audit_events` a reader or stop writing to it.** Four writers, zero readers.
5. **Supersede ADR-006's multi-tenant exclusion** with an ADR recording what isolation actually means
   here, with no row-level security beneath it.

**Exit gate:** the isolation matrix is generated and green against real PostgreSQL; C-6 `fixed` by
deletion; `capability-justification.md` deleted.
**Register:** 38/42 `real`. **Scripts:** under 10,000 lines.

---

## The deletion register

Two stages, because no gate is deleted on my assertion alone.

**Stage 1 — the audit (v3.0 task 1, extended).** For each of the ~50 root scripts and 31 gate
self-test files, record the defect class it caught and the commit, into
`docs/quality/gate-yields.json`. Anything with no entry goes on the delete list. This is reading, not
tooling.

**Stage 2 — deletion, on the schedule below.**

| Target | Lines | Why it is on the list |
|---|---:|---|
| `site-doctor.mjs` + `build-site-pages.mjs` + `site-ten-page.mjs` + `site/` | 1,607 | `docs.yml` builds the site and has **no `deploy-pages` step and no `pages: write`**, so it is built on every push to `main` and never goes live (`CHANGELOG.md:176-181`). Either deploy it or delete it. |
| `quality-baseline.mjs` | 266 | A nightly aggregate of gates that already run per-PR. |
| `unify-preflight.mjs` | 359 | 36 boundary checks guarding a migration that shipped in 2.0.0. Its obsolete-branch list (`publish-docker.yml`) is the last live use. |
| `merge-gate` branch/commit/budget checks + `ruleset.mjs` + `review-pr.mjs` | ~863 | GitHub branch protection, with ten required checks, already enforces this for free. **Keep the ledger half** (`checkLedger`) — that is the part with teeth. |
| `verify:local` wrapper | 33 | Makes the security gate exit 0 without scanning. |
| 21 dormant tables + their migrations | — | v7.0, per C-6. |

**Kept regardless of Stage 1, each with a named catch:** the coverage ratchet, the complexity
ratchet, the findings ledger and `findings:check`, the gate-tooling manifest, the `.semgrep.yml`
ruleset, the secret scan, `db:check`, `migrate:validate`, the real-PostgreSQL integration and E2E
lanes, `merge-gate`'s ledger check, and one test per gate that has a recorded false negative.

**Target:** `scripts/` under 10,000 lines by v7.0, net-negative in every version.

---

## Validation

`pnpm verify` on every version, plus that version's exit gate.

| Version | Exit gate |
|---|---|
| v3.0 | `pnpm verify:release` green · a git tag exists · 4 register rows `real` |
| v4.0 | X-3 `fixed` · 6 register rows `real` · axe route gate green in both themes |
| v5.0 | `E2E_ALLOW_IN_MEMORY` gone · C-4 `fixed` · complexity `worst` < 39 |
| v6.0 | `pnpm status:10` reports non-zero `pass` · 5 tiers raised, each with its measurement |
| v7.0 | Generated isolation matrix green against real PostgreSQL · C-6 closed by deletion |

---

## Risks

- **Stryker on `apps/api`** (44,296 lines at 95% coverage) is slow enough to be unusable nightly.
  Mitigation: per-package time budget, `--changed` on PRs. **If it does not fit the nightly it is
  not a nightly gate — it is a weekly one, recorded as such.**
- **v5.0's store deletion is the highest-risk change in the plan.** `E2E_ALLOW_IN_MEMORY` exists
  because something depends on it. Task 1 is a grep of every reader, not an edit.
- **v4.0 retires two domains** — a reduction in product claim. It is right on the evidence, and it
  belongs in the changelog headline rather than in a register row.
- **The Stage 1 audit may clear fewer gates than the line target assumes.** If `scripts/` cannot
  reach 10,000 without deleting a gate with a recorded catch, **the target moves, not the catch.**
- **A third stale-number finding already exists**: `gate-tooling.mjs` and `site/operations.md` both
  say `verify` has thirteen steps; it has fifteen. The audit should add "every number in a doc is
  re-derivable" as a clause.

---

## Open questions

1. **Which five packages** does the Stryker baseline cover? Q-1 says "five packages" and does not
   name them. Recommendation: `packages/shared-contracts`, `packages/auth`, `packages/orchestration`,
   `packages/runner-sdk`, and `apps/api/src/infrastructure` — the highest-coverage, highest-risk code.
2. **Is the docs site deployed or deleted?** The register assumes deletion subject to the Stage 1
   audit. If deployment was the intent, `docs.yml` needs `pages: write`, an `id-token`, an
   `environment:`, and a `deploy-pages` step.
3. **Does `tools/migrate-cli` have a remaining source to migrate?** If not, it goes in v5.0 with
   `migration.tool`.
4. **`reporting.advanced-analytics`** — wire to canonical run evidence or delete the routes? This is a
   product call, not a QA one.
