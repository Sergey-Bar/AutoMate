# Automate v3 — Implementation Plan

> ## SUPERSEDED — DO NOT EXECUTE
>
> Replaced by **`.kilo/plans/1790509811211-automate-v2-stabilization-release.md`** (v2.0.0 stabilization and release). Where the two disagree, **v2 wins**.
>
> This file is kept as **the record of what was known on 2026-09-27**, not as an executable document. It is retained deliberately: the audit trail matters, and deleting the plan that seeded `docs/quality/findings-ledger.json` would leave 104 rows pointing at a source that no longer exists.
>
> **Its text is not current truth.** Six claims in its §3 and one in its §8 were checked against the working tree and did not survive — see v2 §3 F1–F12. Most consequentially, **D4 and W2.1 below are reversed and executing them breaks working execution**; both are marked in place. Treat any other task here as a hypothesis to re-verify before acting on it, not as approved work.

**Path:** `.kilo/plans/1790482134837-automate-merged-leftover-plan.md`
**Repo:** `github.com/Sergey-Bar/AutoMate` · pnpm workspace · Turborepo · Node 24 · TS 5.9 · Vitest 4 · Playwright · Hono v4 · React 19 · Tailwind 4
**Basis:** ~90 findings re-verified against the working tree on 2026-09-27 by four parallel sweeps, plus 8 areas confirmed by hand. **The security band is not done** — Q0.10 is marked DONE in the source plan while 13 of 14 sampled security findings are open. A wave being marked DONE was never evidence its findings were fixed; that inference is what v2 of this plan got wrong.

**Rule:** nothing is done without executable evidence. A mock, static response, in-memory store or unwired adapter is `not_configured`, never a pass. A gate that cannot fail is a defect.

---

## 1. Bug policy

| Band | Definition | Merge | Release | Debt baseline |
|---|---|---|---|---|
| **Blocker** | Security, data loss, wrong release decision | blocks | blocks | **forbidden** |
| **Critical** | Bug on a product path | blocks | blocks | **forbidden** |
| **Major** | Real defect, bounded blast radius | counts | counts | ratchets |
| **Minor** / **Nit** | Cosmetic or edge case | — | — | ratchets |

- Same five bands as `.github/review-rules/rules.json`, so human, automated and triage speak one language.
- **Binary triage.** Severity + a test + exactly one disposition: fix now, or enter `docs/quality/debt-baseline.json` with an owner and a removal condition that names a thing which could happen. No third option of "known".
- **Nothing closes without proof** — a test shown to fail before the fix and pass after. Already the repo's standard.
- **A green run is necessary, not sufficient.** `pnpm verify` passing means the gates passed; the defect class missed here is the one no gate covered. Release therefore also requires `pnpm findings:check` (§3) — a machine-checked ledger, not a judgement call.
- **Regressions fail; debt does not grow.** Every floor may only improve. Lowering a floor to make room is not a fix.

---

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| **D1** | **Rehearse before breaking.** A destructive migration does not merge until a rehearsal has restored a post-migration database and re-opened every encrypted row. W6 (backup/restore/rollback) lands before W7 (tenancy migrations). | Supersedes v2's "breaking changes authorised" framing. W7 has ~10 migrations against live data; nothing can currently prove a restore. |
| **D2** | **Every migration gets a pre-audit.** Before the migration file exists, a test proves the current data can satisfy the new constraint. | The schema already permits rows the new constraint would reject — outbox `workspaceId` is nullable, and I documented those rows as undeliverable. A migration that meets a violating row surfaces as a production 500, not a test failure. This is the pattern `0006` used. |
| **D3** | **Split the store before fixing the store.** `drizzle-execution-store.ts` is split as its own wave, before the five tasks that edit it. | Six tasks currently target the same file. The complexity baseline shows it already holds two of the top offenders (`:1357` complexity 65, `:1098` complexity 39 — the latter being exactly the finding-49 transaction). Fixing before splitting re-bases the work three times. |
| ~~**D4**~~ | ~~**Fix the execution path before anything that depends on it.** The worker `JobHandler` moves to W2, ahead of the tenancy, scheduler and resilience work.~~ **REVERSED — do not execute. The worker takes no handler, ever.** | **The premise was wrong.** "The worker cannot currently execute a job" is true and is not a gap: **execution belongs to `apps/runner`**, which claims jobs over `POST /api/v1/runners/:runnerId/jobs/claim` (`apps/api/src/routes/execution/runners.routes.ts:127`) and runs them in the execution boundary. `ExecutionWorker` has a second, in-process claim path over the *same* `runners`/`jobs` tables, so a handler here would put the worker in competition with the runners for the same jobs **in a process with no execution capability** — every job it won would end `infra_failed` or bounce through requeue. `apps/worker/src/main.ts:100-123` documents this and `apps/worker/src/worker.test.ts` pins it. X-1 is `fixed`; keep it that way. See v2 §2 D4. |
| **D5** | **Gate before feature.** W0 lands first and alone. | No regression net exists for the security fixes in W1. |
| **D6** | **Tier every gate, with a budget on `verify`.** New scripts are classified `pr-blocking`, `pr-reporting`, `nightly` or `release` before they are written. `verify` grows from 13 to **at most 20** steps; beyond that it goes nightly. `migrate:apply` is **never** in `verify`. | `verify` is 13 steps today with 9 more nested in `security:verify`. A gate that blocks everything gets switched off, taking the real gates with it — the repo's own documented lesson, and the failure W0 just cured. CI has no persistent database, so applying migrations there is the wrong shape. |
| **D7** | **Delete-or-wire, one PR each.** | A large share of open findings live in classes production never imports. Repairing them is wasted work and permanent maintenance. |
| **D8** | **Hand-rolled data layer stays.** TanStack Query not adopted. | `AGENTS.md` is current truth; the abort half of the old D5 rationale is delivered by `use-request-lifecycle.ts`. |
| **D9** | **Dark stays default**; light becomes a contrast-verified peer. | `theme.css:43-66` ships `:root` dark. |
| **D10** | **Single-node, single-tenant, self-hosted, English-only.** | Out of scope as decisions, not TODOs. |
| **D11** | **Waves are the merge unit.** Single-owner interface files: root `package.json`, `eslint.config.js`, `vitest.shared.ts`, `apps/api/src/index.ts`, `apps/web/src/router.ts`, `apps/web/src/lib/api.ts`. No feature flags. PR budget ≤400 lines, ≤800 needs written justification. | Ordering replaces flags. |

---

## 3. The findings ledger

Create `docs/quality/findings-ledger.json` in W0 and a `pnpm findings:check` script that fails when any `fixed` row's evidence path no longer exists, when a status regresses, or when a new high-severity row appears unreviewed. This is what makes §1's release criterion machine-checkable rather than a manual re-sweep.

**Confidence marking** — honest about provenance. `hand` = confirmed by direct inspection during planning. `sweep` = one of the four automated sweeps, unre-confirmed.

| Band | Open findings | Provenance |
|---|---|---|
| Security / crypto | P-3, P-5, P-6, P-7, P-8, P-9, P-10, P-11, P-12, P-13, P-14, P-16, P-17, P-18, P-19, P-21 | `hand`: P-7, P-8, P-9, P-11, P-14, P-16, P-17, P-18, P-19, P-21. `sweep`: the rest |
| Tenancy | P-20 (8 of 10 tables), O-1…O-3 | `sweep` |
| Durability / correctness | P-23, P-24, P-57, P-60, P-62, P-70, P-72, S-1…S-7, F-4…F-8, R-1…R-7, G-1…G-8 | `hand`: P-23, P-60, P-70. `sweep`: the rest |
| Resource / query | 47, 49, 50, 51, 52, 53, 55, 56 | `sweep` |
| Product path | worker `JobHandler`, PATCH status, `/features`, automation unwired | `hand`: worker, PATCH status |
| Web | error boundary, AuthGuard, auth globals, `useCommandActions`, run-detail, `formatDate`, SSE, quarantine, theme | `sweep` |
| Observability | correlation, response header, logger, metrics, health, diagnostics | `sweep` |
| Docs / verification | 8 scripts unwired, docs drift, register self-contradiction, `@types/node`, 2 unexplained flakes | `hand`: script wiring. `sweep`: the rest |

**Verified fixed — do not redo:** ~~P-1, P-2, P-4, P-15, P-27, 45, 46, 48, 54, 58, F-1/F-2/F-3, R-2 (production bus), `makeApi()` typed defaults, `Table.tsx` keyboard sort.~~ **Withdrawn as evidence, 2026-09-29 (ledger C-1).** Two of the seventeen carried a path a reader could check; the other fifteen named only a row id, and **every one of those ids no longer resolves** — the ledger was renumbered, so `P-1`, `P-2`, `45`, `R-2` and the rest are not rows in `docs/quality/findings-ledger.json`. A claim with no path cannot be machine-checked, and this one instructs a future reader not to redo work on the strength of identifiers that point at nothing. Whether each fix is in fact present is not re-asserted here; the current state of those areas is in the ledger, where a `fixed` row carries its evidence and a missing file reopens the claim.

**Six source claims that did not survive checking — do not plan around them:**

| Claim | Reality |
|---|---|
| "P-18 is exported and tested but unreachable" | **Wrong.** `middleware/auth.ts:123` is a live call on the fallback arm. |
| "P-25: the contract is a partial record" | **Wrong.** Under Zod 4 `z.record` with an enum key is exhaustive. The partial is an internal type behind a cast; read paths are already defended. Low severity. |
| "`README.md` documents the wrong port" | **Partly wrong.** Only `3456` is stale (4 places). All six infra ports are correct. |
| "`readAt` is unverified like `read`" | **Inverted.** `read` is test-only; `readAt` is the live path with no verification. |
| "`check(iterations >= 600000)`" (v2's own task) | **Meaningless.** The `iterations` column is dead — `vault-crypto.ts:27` hardcodes 100 000. Constraining a column nothing reads measures nothing. |
| "`readiness` reports degraded stores" | **Wrong.** No `lastSweepError` anywhere; the realtime `lastError` is a local variable never surfaced. |

---

## 4. Work

Sixteen waves. Each ends with a **gate** — the condition that lets the next wave start.

### W0 — Gates and measurement · *gate: gates are trustworthy*

| # | Task | Evidence |
|---|---|---|
| W0.1 | `pnpm coverage:ratchet` as its own required job in `unified-ci.yml`, writing a per-package table to the job summary. | A lowered floor fails the PR. Today reachable only via dispatch-only `release-gate.yml:50`. |
| W0.2 | `migrate:plan` + `migrate:validate` into CI as **`pr-reporting`** (non-blocking, uploads the report). `migrate:apply` never enters `verify` (D6). | The report appears on every PR and blocks nothing. |
| W0.3 | Diagnose the two **unexplained flakes**: a full suite reporting `1 failed / 1495 passed` once in nine runs, unidentifiable; and `node --test` interference where four `scripts/lib` suites pass 36/36 serially and 33/36 together, contending writer never identified. | Capture the failing test's name, not the totals. Until then both are open defects. |
| W0.4 | Create `docs/quality/findings-ledger.json` + `pnpm findings:check` (§3), seeded from this plan. | Deleting a `fixed` row's evidence path fails the script. |
| W0.5 | Resolve the `playwright.config.ts` ESM contradiction: `__dirname` at `:41,110` in a `"type":"module"` package, while the committed `playwright.config.local.ts:2-9` calls that a fatal `ReferenceError`. Use `fileURLToPath`; delete the scratch file. | `pnpm test:e2e` collects the same 18 tests on Windows and Linux. |
| W0.6 | Add the missing `turbo.json` `globalDependencies`: `coverage-baseline.json`, `.semgrep.yml`, `.gitleaks.toml`, `playwright.config.ts`, `commitlint.config.js`, `tsconfig.scripts.json`, `vitest.config.ts`, `vitest.shared.ts`, `scripts/gate-tooling.json`. | Editing any invalidates the `test` task. |
| W0.7 | Fix three stale cross-references: `eslint.config.js:98` cites a nonexistent `debt-baseline.json`; `review-rules/rules.json:128` names `pnpm secret:scan` (real: `security:secrets`); `coverage-exclusions.md:29` claims nothing asserts a successful production composition, which `index-production-composition.test.ts:275-337` now does. | Each resolves to a path that exists. |
| W0.8 | Add `security:secrets:history` to `security:verify`; wire `commitlint` into CI. | A secret in an old commit fails `pnpm verify`. |
| W0.9 | Add a `no-fail-open-default` rule to `review-rules/rules.json` and a lint rule banning `as unknown as` under `packages/db/src/schema/**` and `packages/shared-contracts/**`. | `new Date(0) as unknown as Date` fails lint. |
| W0.10 | **Wire the six orphaned scripts** as `pr-reporting` or `nightly` per D6: `smoke:local`, `smoke:rehearsal`, `compose:config`, `quality:baseline`, `migrate:plan/validate`. They exist and are in **no** workflow, not `verify`, not `verify:release` — the migration gate has never run. | Each is referenced by a named job. |

**Gate:** `pnpm verify` green; `coverage:ratchet` fails on a deliberately lowered floor; the migration report appears on a PR; `findings:check` is green; W0.3 has produced a named test or an explicit "not reproducible, monitoring".

### W1 — Security: reachable paths · *gate: every item has a fail-before test*

| # | Task | Evidence |
|---|---|---|
| W1.1 | **P-18 — delete `validateApiKey`.** `packages/auth/src/session.ts:21-23` compares the provided value directly to the stored hash; `middleware/auth.ts:123` calls it on the live fallback arm; the length-leaking early return at `session.ts:13-17` is live. `verifyCredential` (pepered HMAC, `credentials.ts:7-15`) is already correct — make it the only path. Delete the function, the barrel export, **and the test at `session.test.ts:5` that asserts the insecure behaviour is correct.** | A stored hash presented as an API key is refused. Deleting it breaks the suite, which is the proof. |
| W1.2 | **P-71 — runner registration is unauthenticated when the secret is unset.** `routes/execution/shared.ts:182` treats absent `RUNNER_REGISTRATION_SECRET` as "not production". Also `middleware/auth.ts:110` and `runs.routes.ts:43` read `process.env['NODE_ENV']` directly. | Registration with no configured secret is refused in every environment; all three sites read injected config. |
| W1.3 | **P-3 — the constant result digest.** `legacy-reporter.ts:53` emits `resultDigest: '0'.repeat(64)`; `DigestSchema` only regex-checks 64 hex chars, so 64 zeros pass and the proof chain is defeated end to end. | Real fingerprint computed; a `DigestSchema` check rejects the all-zero digest. |
| W1.4 | **P-5 — `runs.gateStatus` actively rejects the contract.** Column is `['passed','failed','skipped']` (`dashboard.ts:187`) and `0009_enum_constraints.sql:32-36` added a CHECK pinning the same three, so `warning`/`unknown`/`not_evaluated` are hard-rejected. Zero producers, zero consumers. `GATE_STATUSES` cannot be imported — `execution.ts:18` imports *from* `dashboard.ts`, so the dependency runs the wrong way. | Per D2, the pre-audit proves no existing row falls outside the 5 contract values, *then* the column and CHECK widen, *then* a producer and consumer exist. |
| W1.5 | **P-20 — the `schedules` cross-tenant trigger is live.** `apps/worker/src/postgres-store.ts:378-388` selects enabled schedules with no workspace predicate, then digs the workspace from untyped JSONB at `:408`. | A schedule in workspace B is not returned to a workspace-A worker. Depends on W2 being real. |
| W1.6 | HSTS in `middleware/security-headers.ts` and both nginx configs — zero occurrences repo-wide. HTTPS origins only. | Asserted from real response headers, not from config. |
| W1.7 | Three-way cross-plane credential separation, untested today: a `REPORTER_SECRET` must not reach a control-plane route, an `AUTOMATE_API_KEY` must not pass reporter ingestion, a runner token must reach neither. | One `describe` with the exact status and code for all six refusals. |
| W1.8 | **The canonical compose stack cannot boot the API.** `docs/deployment.md:20` documents that the API refuses to start without an S3 store, the enforcement is real (`startup-policy.ts:90-97`), and **no compose file sets `OBJECT_STORE_*`** — `docker-compose.unified.yml:33-44` starts `NODE_ENV: production` with none. `compose.dev.yml` runs a `minio` service and never wires it in (`:49-60`); zero `OBJECT_STORE` matches in `infra/`. Wire MinIO into both. | `docker compose config` validates and the API reaches ready. |

**Gate:** every item has a test that fails when reverted; no open security Blocker; `pnpm security:verify` green.

### W2 — Make the execution path real · *gate: a job runs worker→runner with no in-memory store*

| # | Task | Evidence |
|---|---|---|
| ~~W2.1~~ | ~~**Wire a real `JobHandler` in `apps/worker/src/main.ts`.** ~~ **REVERSED — do not execute. This is the most dangerous task in the plan: it reintroduces a bug against working execution.** | The original evidence was accurate and its conclusion was inverted. `worker.ts:60` does gate claiming on `this.options.handler`, and the production composition at `main.ts` passes none — so the worker reaps leases and polls schedules but never executes. **That is the design, not the gap.** The claim "the product could not execute jobs at all" does not follow: `apps/runner` claims and runs them. Its "largest single gap in the repo" label is the error, and it is load-bearing — it is what a later reader re-fixes. `apps/worker/src/main.ts:100-123` records the truth, and `worker.test.ts` pins it with `claims nothing in production composition, because the runner executes`. The replacement task is an end-to-end worker→runner proof on PostgreSQL (v2 §9 W2), and W2.3's four untested branches must be re-verified against the **runner** claim path, because the rationale here assumed a handler that will never exist. |
| W2.2 | A fault-injection seam on `apps/worker/src/in-memory-store.ts` (a `failNext`-style option beside the existing `now`). No `throwOn`/`failNext`/`shouldFail` exists in any production source. | Follows the proven pattern at `apps/runner/src/runner-service.test.ts:147-151`. |
| W2.3 | **Test the worker loop.** `worker.test.ts` has 2 `it()` cases. Untested: readiness `ping` gating (`worker.ts:84-90`); lease renewal (`:126-146` — the test stops the worker at 20 ms with a 1 000 ms interval, so renewal never fires); `leaseLost → runner_lost` (`:138,152`); job timeout → `timed_out` (`:122-125`). | Each of the four has a case that fails when the branch is removed. |
| W2.4 | `unhandledRejection` / `uncaughtException` handlers for `apps/api`. Runner (`main.ts:66-67`) and worker (`main.ts:63-64`) have them and both are tested; the API has **zero** `process.on` calls. | Mirrors `apps/worker/src/main.test.ts:59-155`. |
| W2.5 | `reapExpiredLeases` has no workspace clause (`drizzle-execution-store.ts:1800` filters on state and expiry only). A test holds the question open and fails *only* if a clause appears. Decide, then delete the hold. | The decided behaviour has a test. |

**Gate:** a real Playwright run executes end to end on PostgreSQL with no in-memory store on the path; each W2.3 branch has a revertible test.

### W3 — Delete-or-wire · *gate: `knip` reports zero unused files and exports*

| # | Task | Evidence |
|---|---|---|
| W3.1 | `packages/realtime/src/bus.ts` — R-1, R-3, R-4, R-5, R-6, R-7 all live here: `close()` never unsubscribes; `Number('')`→0 and `Number('0x10')`→16 both pass the cursor guard; subscribing with no cursor reports "caught up" while missing everything; O(n) `shift()` bounded by count not bytes; a per-process cursor minted `1..n` beside the durable outbox sequence; `computeBackoff` accepts `NaN` → `setTimeout(connect, NaN)` fires immediately. **Production wires `DurableRealtimeBus`, whose per-subscriber isolation is already fixed.** | Delete the class, or port its value into the production bus and then delete. |
| W3.2 | `packages/orchestration/src/schedule.ts` — no timezone field, UTC-only `setUTC*`, and a rule of `{minute, hour}` only, so `0 9 * * 1` has no representation and degenerates to `+intervalMinutes`. **The worker's own `scheduler.ts:36-37` does apply the timezone via croner.** | One schedule implementation, or the class deleted. |
| W3.3 | `packages/auth/src/credentials.ts` `InMemorySessionService` — S-1…S-7: O(n) HMAC scan per request; no prune (`revoke` only stamps `revokedAt`); **`issue` returns the live internal record**, so a caller can mutate `expiresAt`/`revokedAt` in place; empty secret and `ttlMs <= 0` accepted; `lastUsedAt` is a dead column; `SESSION_RETENTION_DAYS` is parsed and mapped with no consumer; no `deleteExpired`. **Production uses the indexed `DrizzleSessionStore`.** | Delete, or make `issue` return a copy and add a TTL sweep. The dead-column pair is settled either way. |
| W3.4 | 17 unconsumed `packages/ui` components, `ErrorState`, `LoadingState`, `RunExplorer`, the dead aliases `createExecutionApiRoutes`/`createRunnerApiRoutes` (`routes/execution.ts:81-82`, zero consumers), and the `createExecutionStore` export/local collision (`in-memory-execution-store.ts:1204` vs `index.ts:158`). | `knip` green. |

**Gate:** every class is either wired into production or deleted with the finding closed in the ledger; `knip` added to `verify`.

### W4 — Durability and correctness · *gate: every item has a fail-before test*

| # | Task | Evidence |
|---|---|---|
| W4.1 | **P-14 + P-16 — the spool can be bricked and can tear.** `MAX_SEALED_BYTES` (4 MB) is enforced only at decode (`spool.ts:588`), never at enqueue (`:301-316`), so one ~5 MB event is accepted then permanently fails the whole file — `decodeFile` throws `SPOOL_FORMAT` unconditionally and `tornTail: 'drop'` covers only a *partial tail*, not a mid-file throw. Separately `appendFile` at `:311` has no handle, no `datasync()`, no `bytesWritten` check; the repair guard at `:310` reads a **cached** `fileBytes`, so a failed append leaves the guard false and the next append lands after a hole. | A 5 MB event is rejected at enqueue; a corrupt mid-file frame is quarantined and the rest of the file still reads; a torn write is detected and repaired. |
| W4.2 | **P-17 — the spool directory is world-writable and predictable.** `spool.ts:273` `mkdir` with no mode; `DEFAULT_DIRECTORY` is `resolve(tmpdir(), 'automate-runner-spool')`; zero `0o700`/`chmod`/`getuid` repo-wide. Only the *files* get `0o600`. No foreign-directory refusal. | A pre-existing directory owned by another user is refused, not used. |
| W4.3 | **P-19 — every deployment derives the same spool key.** `scryptSync(secret, purpose, 32)` at `:69-72` uses the constant `'automate-runner-spool'` as salt, with N/r/p/maxmem unpinned and no `kdfVersion` anywhere. A Node default-cost change surfaces as `SPOOL_WRONG_KEY` rather than a migration. | Random persisted salt, pinned parameters, a `kdfVersion` that drives a migration. |
| W4.4 | **P-70 — five defects, all open.** `runner-control.ts:55` `acquire(runner, jobId, _leaseId)` **discards the caller's leaseId** and silences it with `_`; `:72-73` hashes `JSON.stringify` directly, so duplicate detection is key-order dependent; `orchestration-service.ts:47-49` lets an illegal `canTransition` fall through, sets `cancelRequested` and returns a 200-shaped job; `events.ts:197` `void stream.writeSSE(...)` with an unhandled rejection; `events.ts:86,93,107` registers `onAbort(finish)` *before* assigning `unsubscribe`, so an abort in that window calls a no-op and the real subscription leaks. | Five tests, each failing when reverted. |
| W4.5 | **O-1 — the state machine has no fencing token.** `orchestration/src/state-machine.ts:24,30` take `(from, to)` only, so `running → succeeded` is legal for any caller. | A stale fencing token is refused; the token is a required argument. |
| W4.6 | **P-57 — canonical utilities are triplicated.** `stable()` byte-identical at `quality-gate.ts:42-51` and `drizzle-execution-store.ts:130-139`, third copy named `canonical()` at `in-memory-execution-store.ts:53-62`; `tokenMatches` ×2; `normalizeArtifactKind` ×2; the 8-element terminal array inlined at `drizzle:732-741` and `:797-806` despite `isTerminalPhase` existing — and `isTerminalPhase` is *itself* duplicated at `phase-outcome.ts:66` and `types.ts:550`. | One `execution/canonical-util.ts`; a test fails if a second definition appears. |
| W4.7 | **P-62 — the event allowlist is now three copies.** The laundering fix landed, but the allowlist is hand-duplicated at `shared-contracts/schemas/execution.ts:459-470`, `apps/api/src/realtime/realtime-bus.ts:46-56`, `routes/execution/schemas.ts:194-205`. | One exported set, derived from the contract's own constants. |
| W4.8 | **P-60 — `collectSuite` has no depth cap.** `routes/reporter.ts:400-452` recurses into `suite['suites']` at `:446-451`; a self-nested `suites` array overflows the stack. | A depth-capped collector rejects past the cap instead of throwing `RangeError`. |
| W4.9 | **F-4…F-8 — reporter adapters collide and invent.** `junit-xml.ts:121` builds `testId` from `classname:name` and `playwright-json.ts:115` from `file:title`, so two same-named tests collide (the contract only requires `z.string().min(1)`); `playwright-json.ts:105` passes the **spec** index where the test index belongs, so two tests in one spec with an identically-named attachment get the same evidence URI; `junit-xml.ts:92-97` accumulates text with no cap; `playwright-json.ts:99` `JSON.parse` is unguarded; `:71` interpolates an unencoded attachment name. | Distinct test ids, distinct evidence URIs, bounded text, a malformed body yields a classified error not a throw. |
| W4.10 | **P-24 — the AI gateway retries fatal statuses.** `kilo-gateway.ts:30` opens the try; the fatal throw at `:45-47` is inside it; the blanket catch at `:48-50` swallows it on attempts 0 and 1. | `retryable` computed outside the try. One attempt for a 401. |
| W4.11 | **P-6 — three startup-policy authorities.** `packages/config/src/config.ts:59-73`, `packages/auth/src/startup-policy.ts:8-12`, `apps/api/src/startup-policy.ts:45-116` — and `apps/api/src/config.ts:104` passes `requireProductionSecrets: false`, deliberately disabling the first. The committed cookie-secret literal survives at **two** sites (`config.ts:79`, `apps/api/src/startup-policy.ts:13`). `min(32)` covers 3 of 7 secrets; `AUTOMATE_API_KEY`, `REPORTER_SECRET`, `RUNNER_REGISTRATION_SECRET`, `KILO_API_KEY` get `min(16)`. `packages/auth/startup-policy.ts` is byte-for-byte unchanged and fails open on `NODE_ENV=prod`. Unknown `NODE_ENV` *is* now rejected. | One authority. The literal is gone. Every secret is `min(32)`. |
| W4.12 | **P-72 — every deployment records a dev installation key.** `index.ts:246` passes `displayPrefix: 'dev'` unconditionally to `ensureBootstrap`; `index.ts:71` hardcodes the installation UUID `00000000-0000-4000-8000-000000000001`; `:231` `let sessionBackend;` is untyped. (The TDZ sub-item is fixed.) | `displayPrefix` derives from injected config; the UUID is generated per install. |

**Gate:** no open Blocker/Critical in the durability band; every row in the ledger for it is `fixed` with a passing evidence command.

### W5 — Split the store, then fix the store · *gate: complexity offender count does not increase*

| # | Task | Evidence |
|---|---|---|
| W5.1 | **Split `drizzle-execution-store.ts` (2 166 lines) first.** It grew 148 lines past the point the old plan scheduled the split. Split along the seams the tests already define: run listing, event append, job claim, artifacts, policies, readiness. | Correct gate: `docs/quality/complexity-baseline.json` records **per-function offenders** (`ceiling: 15`, `count: 31`) — it does **not** track file length. So: the offender count does not increase, and the specific offenders at `:1357` (complexity 65) and `:1098` (complexity 39) are resolved. *(v2 wrote "no file exceeds the complexity baseline", which is meaningless as written — that baseline has no file-length notion.)* |
| W5.2 | **49** — two `UPDATE runs` round trips per event inside one transaction (`:1268-1271`, `:1280-1290`). Set the sequence once after the loop. | The statement count does not grow with batch size. |
| W5.3 | **50 (remainder)** — `listJobs` (`:848-855`), `listArtifacts` (`:1674-1684`), `listPolicies` (`:1709-1716`) are unbounded and exposed on GET routes. Separately `runs.routes.ts:78` calls the **legacy unbounded** `listRuns()` and merges it into the paginated page. | Every list endpoint clamped and paged; a bad cursor is 400. |
| W5.4 | **51** — no `jobsByRun` / `jobsByLeaseOwner` index exists; ~9 O(n) scan sites in the in-memory store. | The scans become lookups. |
| W5.5 | **52, inverted** — `readAt` (`artifact-store.ts:76-78`) is a bare `readFile` with no size cap and no digest, and it is the **live** path (`:160`); `read` (`:115-120`) verifies but is test-only. The verification landed on the dead method. | `readAt` enforces a cap and verifies the checksum. |
| W5.6 | **47 (remainder)** — `modules/dashboard/tests.ts:26-34` still does `listRuns()` then `await listTests(run.id)` per run, and again at `:38-80` for suites. `listTests` (`run-repository.ts:235`) is single-run; no `= ANY(...)` form exists. The analytics half *is* already in SQL with a parity test. | One query per page, proven by a statement count against the real schema. |

**Gate:** `pnpm complexity` green with the offender count equal or lower; each W5.2–W5.6 item has a revertible test.

### W6 — Migration safety · *gate: a rehearsal restores and re-opens every row* · **must land before W7**

| # | Task | Evidence |
|---|---|---|
| W6.1 | Backup: `pg_dump`-based, checksummed, restorable to a named target with a recorded manifest. | A backup restores byte-for-byte on a seeded copy of the real migration graph. |
| W6.2 | Restore: automated restore into a fresh database, verified by row counts and constraint validation. | Restoring a backup yields a database that passes `pg_dump` comparison and the enum-constraint integration suite. |
| W6.3 | Rollback: each migration declares whether it is reversible, and the irreversible ones are listed. | A reversible migration rolls back on a rehearsal database; the irreversible list is reviewed and acknowledged. |
| W6.4 | **The rehearsal harness**: a seeded database at the current head, a migration applied, restore from the pre-migration backup, and every application read path exercised. | This harness is what unblocks W7. Without it, no breaking migration merges. |
| W6.5 | Wire the harness as `nightly` (D6) so a migration that breaks restore is caught before release, not after. | A deliberately irreversible migration turns the nightly job red. |

**Gate:** a rehearsal has restored a post-migration database and re-opened every encrypted row. Until this gate is green, W7 may only add **nullable** columns.

### W7 — Data integrity and tenancy · *gate: every migration has a passing pre-audit*

Each task follows the D2 protocol: **(a)** a test proves current data can satisfy the new constraint, **(b)** the migration lands, **(c)** an integration assertion reads back *through the database*, **(d)** a forward-compatibility check proves the previous app version's queries still succeed.

| # | Task | Pre-audit must prove |
|---|---|---|
| W7.1 | **P-9 — the outbox silently drops events.** `identity.ts:118` is a **single-column** unique index on `dedupeKey`; `outbox-repository.ts:57` conflicts on that column alone. Second hole: `workspaceId` is nullable (`identity.ts:100`) and `readAfter` filters `eq(workspaceId, …)` at `:67`, so a NULL row is invisible to delivery yet still advances the identity sequence and is counted by `getRetentionFloor` (`:84-98`). No dedupe-hit counter — `append` returns `rows[0] ?? null` and the consumer returns silently. | No row has a NULL `workspace_id`; no two rows share a `dedupeKey` within a workspace. NULL rows are **repaired or deleted first**, not by a nullable-then-tighten dance — the schema already permits undeliverable rows. |
| W7.2 | **P-8 — the vault binds nothing to its row.** Five independent columns, no AAD anywhere (`vault-crypto.ts:87,103` pass 3 args; zero `setAAD` matches), so row A's ciphertext moves onto row B and verifies — returning GitHub's secrets as Jira's. `iterations` is a **dead column** (the KDF hardcodes 100 000) with no minimum; `salt` has no length constraint. **Fix the code path first, then constrain** — v2's `check(iterations >= 600000)` would have constrained a column nothing reads. | Every stored ciphertext re-opens under its own AAD; the KDF reads `iterations` from the row before any constraint exists. |
| W7.3 | **P-7 + P-20 — tenancy across 10 tables.** Real names, not the roadmap's `connector_credentials` (zero matches): `vault_entries` (`vault.ts:25-44`, `connectorName` `.unique()`), `connector_configs` (`automate.ts:75-84`, same — a global singleton row), `conversations` (`:24-36`) and `messages` (`:40-57`) with **no workspace and no owner**, so every chat transcript is globally readable, plus `trends`, `quarantine`, `knownFailures`, `locatorSuggestions`, `generatedTestSuggestions`, `nlQueryHistory` (raw NL + generated SQL), `roles` (`tenantId` only). `outboxEvents`/`auditEvents` have nullable workspace columns. | The backfill source for every workspace value is defined and documented. **`conversations`/`messages` need an owner decision** (§8.2), not a guessed default. |
| W7.4 | **P-10 — `ensureBootstrap` is not atomic.** `installation-key-repository.ts:11-31` is three independent statements: SELECT then INSERT with no `onConflictDoNothing` against a UNIQUE `(installationId, name)` index, so a second bootstrapping replica gets a raw unique violation and a 500. It also selects only `keyHash` and never inspects `revokedAt`/`expiresAt`, which exist and are never read — so it returns **revoked keys as valid**. | Two concurrent bootstraps produce one key; a revoked key is rejected. No migration needed — pure code. |
| W7.5 | **P-23 — a locale-dependent hash is persisted and load-bearing.** `policy.ts:72` sorts with `localeCompare`; `fingerprint()` at `:83` is written to a `notNull` column and read back to decide duplicate-vs-`conflict` (`drizzle-reporter-ingestion.ts:25,28,47`). A sort-order change across Node builds or `LANG` turns a legitimate duplicate into a `conflict`. | Code-unit ordering. **The pre-audit: recompute every stored fingerprint under code-unit ordering and prove no row's `duplicate`/`conflict` classification flips** — if any does, it is a data-repair task, not a code change. |
| W7.6 | **P-26 — three run vocabularies, and `status` cannot hold what reporters emit.** `dashboard.ts:134-138` is `['running','passed','failed','interrupted']` with a matching CHECK at `0009:29-31`; no `skipped`, no `cancelled`. `results.status` (`:351-353`) still carries camelCase `timedOut`. | Every producer's status is storable; a round-trip test over the CHECK. |

**Gate:** every migration has a passing pre-audit and a forward-compatibility check; no nullable-then-tighten placeholder left behind; each workspace-scoped read and write has a cross-workspace isolation test, per `AGENTS.md`.

### W8 — Error surface · *gate: a source-level gate enforces it*

| # | Task | Evidence |
|---|---|---|
| W8.1 | Migrate all **42** hand-rolled `error(c, status, code, message)` call sites onto `DomainError` through the existing boundary. Breakdown: `execution/jobs.routes.ts` 22, `runs.routes.ts` 9, `runners.routes.ts` 6, `artifacts.routes.ts` 2, `policies.routes.ts` 1, `shared.ts` 1, `execution.ts` 1. | Zero occurrences remain; the local `error()` helper at `shared.ts:154-164` is deleted. |
| W8.2 | Convert the **25** error bodies using bare `{ error: 'string' }` with **no `code` field** — `auth.ts` 3, `orchestration.ts` 4, `runner.ts` 5, `reporter.ts` 7, `reporting.ts` 2, `events.ts` 2, `reporter-results.ts` 1, `agents.ts` 3-4. These violate the `AGENTS.md` contract that every response carries a stable `code`. | A source-level gate fails if a `c.json` error body is added without a `code`. |
| W8.3 | **P-63** — `/health` and `/api/v1/health` are two near-identical literals (`health.ts:18-24` vs `:26-33`); three near-identical agent 404/501 bodies with no shared builder. | One base body; one `notImplemented(c, …)` helper. |

**Gate:** every error path on every route carries a stable `code`, asserted at the route level and by the source gate.

### W9 — Control plane · *gate: each has a fail-before test*

| # | Task | Evidence |
|---|---|---|
| W9.1 | **`PATCH /dashboard/runs/:id/status`** writes no audit row, allows any transition including out of a terminal phase, and can return 200 with a literal `null` (`modules/dashboard/runs.ts:38-79`). `audit-sink.ts` sits in the same module, unreferenced. Delete the rationale comment duplicated verbatim at `:46-59`. | One audit row per change in the same transaction; a retried patch appends one record; terminal → non-terminal is refused with a named code. |
| W9.2 | **`/api/v1/features` returns `{ features: {} }`** (`routes/health.ts:60-65`); `agents.ts:31-41` returns 501 for all 15 domain×action pairs. Make `/features` a real per-domain, per-layer report with a readiness reason and a probe. Log the dev in-memory fallback (`index.ts:87,96,101` → `{}` → `InMemory*`, with no log line anywhere in `index.ts:1-399`). | Every advertised capability has a probe that passes; the degraded path is logged. |
| W9.3 | **Run diagnostics — "why did this verdict?"** The reasons are lossy strings naming no threshold value or rule id (`quality-gate.ts:155,186,141`), and the failure-classification tables carrying `matchedRuleId`/`confidence`/`rationale` (`dashboard.ts:578-600`) are referenced by **zero routes and zero web files**. Structured reasons, plus a surface that renders them. | Every reason names a rule id and the threshold value it compared against. |
| W9.4 | **Dormant tables** — the ~35 in `schema/dashboard.ts` with no reader and no writer each get a reader+writer+route+UI+test, or a written justification in `docs/quality/capability-justification.md`. `locator_suggestions` has no `updatedAt` column at all. | One row per table, no silent gaps. |
| W9.5 | **Ingestion adversarial tests** on the untrusted boundary: unicode and RTL names; invalid surrogates; a deep step-tree bomb (only 2 levels are tested, `canonical-reporting.test.ts:97`); two attempts sharing a `testId` with conflicting statuses; out-of-order and replayed batches. Plus two product decisions: `Content-Encoding`/gzip appears **nowhere** in the repo, so record the non-support explicitly rather than adding it; and `reporter.test.ts:906-914` fires a 50 000-entity bomb asserting only `status === 202` — assert the entity did not expand, and add `DOCTYPE`/`ENTITY` cases. | Each case fails against current code or a reverted fix. |
| W9.6 | Generate an OpenAPI 3.1 document from the shared Zod contracts, with a contract test that it matches the mounted Hono routes. | The test fails when a route is added without a contract update. Feeds W17. |

**Gate:** every control-plane mutation is audited; every advertised capability has a probe; the OpenAPI test is green.

### W10 — The AI gateway and connectors · *gate: a provider outage changes no outcome*

`packages/automation` is declared as an `apps/api` dependency and imported by **nothing**; `AiGateway`, `KiloGateway`, `OllamaGateway` have zero consumers. D7 said delete-or-wire; the brief is everything, so: **wire it**. That makes the eight streaming defects real work.

| # | Task | Evidence |
|---|---|---|
| W10.1 | Wire the gateway. AI failure must never change a run's outcome — only its `outcome` reason. | A gateway outage leaves runs and evidence usable. |
| W10.2 | **G-1** the last SSE event is dropped when the stream has no trailing newline (`kilo-gateway.ts:80-81` breaks at `:110` without processing the tail; same at `ollama-gateway.ts:46-47,80`). **G-2** the reader is never cancelled on `[DONE]` (`:86`). **G-7** a malformed line aborts the stream. | A stream without a trailing newline yields its final event. |
| W10.3 | **G-4 — token accounting is silently zero.** `kilo-gateway.ts:96-102` casts OpenAI-shaped `usage` keys straight to `{inputTokens, outputTokens, totalTokens}`, so no key ever matches and all three are `undefined` on every chunk. (Ollama's mapping is correct, so the bug is provider-specific and invisible in any Ollama-based test.) | A token-accounting test is non-zero. |
| W10.4 | **G-3** tool-call fragments flat-appended with no merge on `index` (`:94-95`). **G-5** Ollama ignores `input.tools`. **G-6** `listModels` drops the `AbortSignal` (`ollama-gateway.ts:22`). **G-8** no default timeout anywhere. | A streamed tool call arrives as one call; a hung provider times out. |
| W10.5 | **P-12 + P-13 — the connectors are non-functional.** Jira targets a hardcoded `your-domain.atlassian.net` (`jira/src/index.ts:21`); GitHub takes `_secret` and never sends it, so every call is unauthenticated (`github/src/index.ts:17,21`); all three ignore `request.operation`/`request.input`; Slack treats HTTP 200 + `{"ok": false}` as delivered (`slack/src/index.ts:26-31`). `connectors/sdk` `executeWithRetry` never reads `manifest.operations[op].idempotent` (`:54-77`) and treats 502 as retryable, so a 502 after Jira created an issue produces 3 duplicates. | Each connector authenticates, dispatches on operation, and refuses to retry a non-idempotent call. |

**Gate:** the gateway is reachable from a product path; a token test is non-zero; a Jira 502 does not duplicate an issue.

### W11 — Observability · *gate: one execution is traceable end to end by one id*

Absent from every prior plan. `AsyncLocalStorage` appears **0 times** in `apps/api/src`.

| # | Task | Evidence |
|---|---|---|
| W11.1 | **Correlation context.** The request id is re-derived from the header at six sites and only ever surfaces in the JSON error body. Make it request-scoped and carry it to the worker's job claim, the runner's event batch, the persisted `run_events` row, artifact metadata and the gate decision. | One id appears in the log line, the event row and the artifact metadata for a single execution. |
| W11.2 | **Emit `x-request-id` as a response header.** It is only ever *read*, while `security-headers.ts:57` lists it in `DEFAULT_EXPOSED_HEADERS` — the CORS layer advertises a header the server never sets. | The header is on the response; the existing exposure list becomes true. |
| W11.3 | **A real structured logger at the existing seam.** `ErrorBoundaryOptions.log` exists and `boundary.ts:57` defaults to `console.error`, but `index.ts:115-120` passes only `requestId` and `reportError`, so production never gets a logger. 10 further bare `console.error` sites. Supply a JSON logger with a documented field set; never log prompts, tokens or artifact bodies. | The existing error-boundary tests pass **unchanged**, proving the seam still works. No bare `console.error` in product code. |
| W11.4 | **`/metrics`** in Prometheus format — run outcomes by domain, gate verdicts, event freshness, queue latency by phase, runner health and leases, cancellation counts, artifact bytes, AI token and cost. Zero occurrences today; no metrics library in any package. | The endpoint returns valid exposition format; a counter moves under test. |
| W11.5 | **Honest health/readiness.** One base body for `/health` and `/api/v1/health`; readiness exposes `lastSweepError` (0 hits repo-wide) and the realtime `lastError` (a local variable at `durable-realtime-bus.ts:108`, never surfaced). | Readiness reports a store that failed, and the response says so. |
| W11.6 | **P-55** — the outbox retention sweep swallows errors with `.catch(() => undefined)` (`outbox-retention.ts:13-18`), so a failing sweep is indistinguishable from a quiet one. | A failing sweep is visible in readiness and in the log. |

**Gate:** one execution traced by one id across log, event row and artifact; `/metrics` returns valid exposition.

### W12 — Resource, performance and resilience · *gate: each axis has a recorded number*

| # | Task | Evidence |
|---|---|---|
| W12.1 | **53 (remainder)** — the PBKDF2 cache exists (`vault-crypto.ts:21-62`, LRU 256) but `pbkdf2Sync` is still on the request path (`:1,27`) and `sealSecret:87` mints a fresh random salt per envelope, so the cache key is always new and sealing always misses. | Async KDF; a cache hit is observable via `keyCacheSize`. |
| W12.2 | **56** — `GET /reporting/kpis` with no `runId` returns an all-zero 200 that reads as a real measurement (`routes/reporting.ts:12-17`). | 400 without a scope, or an explicit scope field. |
| W12.3 | Record the missing performance baseline: `observed_on_reference_hardware` is `null` for all three metrics, so every number in `thresholds.json` is an unvalidated estimate. | Non-null values and a stated reference container. |
| W12.4 | Add DB-backed scenarios — `/api/v1/ready` is the only DB probe and is **unmeasured**, while `/api/v1/health` is a bare `c.json` with no DB. Add a write path and a pool-saturation curve; soak and spike; SSE as a reliability target (reconnect storms, slow consumers). | The scenario exercises the database. |
| W12.5 | A real-PostgreSQL contention job (nightly, D6). PGlite is single-client, so the outbox `ON CONFLICT` and `FOR UPDATE SKIP LOCKED` paths are structurally untestable. The `postgres:16-alpine` service already exists in 4 CI jobs. | Two concurrent claims produce exactly one winner. |
| W12.6 | Failure-injection suite: Postgres down mid-transaction, object-store timeout, runner lost during `COLLECTING`, duplicate outbox delivery, clock skew, artifact disk-full. Built on the W2.2 seam. | No wall-clock or `Math.random` dependency. |
| W12.7 | A web performance gate: bundle size, hydration cost, Lighthouse budget. | A regression fails CI. |
| W12.8 | Decide `test:performance` placement with the reason recorded in `hygiene-register.md`, not only a YAML comment. It is nightly-only by deliberate choice today. | The reason is in the register. |

**Gate:** every performance axis has a recorded number, and the contention job is green.

### W13 — Web product defects · *gate: no defect in the band is open*

All verified open.

| # | Task | Evidence |
|---|---|---|
| W13.1 | **No error boundary anywhere** — zero matches for `ErrorBoundary\|componentDidCatch\|getDerivedStateFromError\|errorComponent`. A render throw blanks the SPA. | A route component that throws renders a recoverable error UI and the SPA does not blank. |
| W13.2 | **AuthGuard redirects from a `useEffect`** (`AuthGuard.tsx:16-21`) and `__root.tsx:16-27` wraps the outlet inside the guard, so protected routes mount and open subscriptions before redirecting. Zero `beforeLoad` in the tree. | No protected component mounts before the redirect. |
| W13.3 | **Auth state is module-level mutable global** (`useAuth.ts:6-8,19`) with an exported `resetAuthState()` that orphans live components. | Two concurrent sessions cannot share state. |
| W13.4 | **`useCommandActions.register` can loop infinitely.** `:93` deps on the raw `actions` array and `:13` compares by object reference, so fresh literals each render produce `changed` → `notify()` → `useSyncExternalStore` re-render → new array. The **only** production caller escapes via `useMemo` (`GlobalCommandPalette.tsx:39`), so the next caller detonates. | A test with a deliberately non-memoised caller terminates. |
| W13.5 | **One SSE per page** — `routes/dashboard.tsx:338` calls `useRuns` before the `:341` early return, so every dashboard child opens 2 `EventSource` connections plus two 5 s pollers. Per D8, restructure the layout; **do not add a dependency.** | A run-detail page holds exactly one `EventSource`; a test asserts the count. |
| W13.6 | Backoff the fixed 5 s `useRuns` poll (`useRuns.ts:107`) and record whether the unconditional interval is intended. | A failing API is not hammered. |
| W13.7 | **`Last-Event-ID` resume** — zero repo-wide matches; the client dedups on a sequence map, so a server restart silently drops to polling. | A reconnect resumes with no gap. |
| W13.8 | `run-detail.tsx:193` renders `null` for a missing run; `:179` detects 404 by string-matching `error.message` while the API returns a distinct `code` (`boundary.ts:159`). `lib/api.ts:104` uses `schema.parse`, so a `ZodError` reaches the user verbatim. | `safeParse` → classified error; typed `ApiError.status === 404`; no Zod issue path in the UI. |
| W13.9 | **One date layer.** Three `formatDate` definitions (`dashboard.tsx:36`, `dashboard/index.tsx:43`, `run-detail.tsx:42`), all bare `toLocaleString()` with **zero** uses of `Intl.DateTimeFormat` in either tree — no locale, no time zone, no offset. Unacceptable in an evidence UI. | One formatter, one vocabulary for unknown, a test per timezone. |
| W13.10 | **Collapse duplicated vocabularies:** 2 `ACTIVE_PHASES` (`useRuns.ts:5-14` and a private copy at `run-detail.tsx:31-40` that nothing uses), a separate ordered `PHASES` list at `run-detail.tsx:19-29`, 2 tone mappers (`dashboard.tsx:40-47`, `run-detail.tsx:46-51`) plus 2 more inline copies at `:394-399` and `:426-432`. | One exported list, one exported mapper; a test fails on a second definition. |
| W13.11 | `/dashboard/quarantine` is registered (`router.ts:9,16`) but absent from `route-manifest.ts:1-7`, so `Sidebar.tsx:4,39` never links it — a finished screen with a 24-case suite, reachable only by URL. Fix `route-manifest.test.ts` to read the **router tree**, not validate the manifest against itself. | The test fails when a route is registered without a manifest entry and a link. |
| W13.12 | Theme: `ThemeProvider.tsx:37` samples `matchMedia(...).matches` once with no `change` listener, so an OS theme change never propagates; `index.html` has no pre-hydration script. Wrap `localStorage` in try/catch. | A test flips the OS preference and the DOM updates. |
| W13.13 | `theme-resolution.test.ts` `collectUtilityCandidates()` (`:170`) scans only `packages/ui/src/components`, so **no `apps/web` class name is compile-verified**. Two residual palette bypasses the guard cannot catch: `CommandPalette.tsx:144` (`bg-black/50`) and `Toggle.tsx:22` (`bg-white`). | Both trees compile-verified; both bypasses use tokens. |
| W13.14 | `aria-live` where the product is live: the SSE event timeline, the LIVE/RECONNECTING indicator, the run-queued confirmation. `apps/web` has 2 production occurrences; `Toast` — the design system's only `aria-live` — is unconsumed. | Each dynamic region announces. |
| W13.15 | 13 hardcoded `/api/v1/...` literals across 4 files with no `import.meta.env`. One config, validated at boot. | One base URL. |

**Gate:** no open item in the web band; `pnpm --filter @automate/unified-web test` green.

### W14 — Accessibility · *gate: axe green in both themes, contrast verified per pair*

| # | Task | Evidence |
|---|---|---|
| W14.1 | **Wire `@axe-core/playwright`** — declared at `package.json:61`, imported **nowhere**. Add axe to the five real dashboard routes in the `product` project, both themes, including empty/error/loading states. | Zero serious/critical; deleting the assertion fails the job. |
| W14.2 | Per-theme WCAG contrast for every semantic pair. The jsdom axe config **disables** `color-contrast** (`test/axe.ts:36-42`) because jsdom has no geometry, so contrast is unasserted outside the token unit test. | AA in both theme blocks. |
| W14.3 | Re-verify and fix the non-axe-detectable defects from test-strategy 3.2 — the passing axe sweep clears none of them: `Splitter` separator values, `Popover` Escape/focus-return/`aria-controls`, `CommandPalette` combobox roles, `Dialog`/`Drawer` focus trap and the `aria-modal`-before-`{...props}` override, `AlertTitle` heading order, dangling `"undefined-error"` IDREFs. | One case per defect. |
| W14.4 | `NavItem.test.tsx` — 1 of 28 components has no behavioural test. Add it; add `user-event` to `apps/web` (present in `packages/ui` only) with keyboard traversal tests. | A keyboard-only traversal reaches and activates every interactive element. |
| W14.5 | `prefers-reduced-motion` outside `packages/ui/src/tokens/` (11 occurrences, zero in `apps/web`); a `focus-visible` Playwright assertion (invisible to jsdom); `@storybook/addon-a11y` or a recorded reason. | The app honours it; focus rings asserted in a real browser. |

### W15 — Quality stack, supply chain, contracts · *gate: each new gate is tiered and inside the D6 budget*

| # | Task | Evidence |
|---|---|---|
| W15.1 | Add `eslint-plugin-react-hooks`, `import-x`, `ban-ts-comment`, `testing-library`; widen type-aware linting beyond `no-floating-promises`/`no-misused-promises`; enable `strictTypeChecked` per package. | One package per PR, triaged into `debt-baseline.json`, never a blanket disable. |
| W15.2 | Declare `fast-check` and add the property/fuzz suite. **Zero** property tests exist today. Targets: `canonicalJson`/`fingerprint` determinism (W7.5), `evaluateCompleteness` shard arithmetic, the JUnit parser on malformed/truncated/entity input, spool round-trip and tamper, path sanitisation, idempotency keys, lease/fencing transitions, the quality-gate truth table. | Each property fails on a deliberately broken implementation. |
| W15.3 | Semgrep rules for the three uncovered surfaces: **path traversal** in artifact keys, **SSRF** in the gateway, **ReDoS** in reporter parsing. The current 17 rules cover command injection and XSS only. | Each demonstrated against a real sink and proven non-vacuous. |
| W15.4 | Supply chain: `osv-scanner`; Renovate **or** Dependabot (neither exists); **a gate that fails on an expired override review date** — all five in `pnpm-workspace.yaml` are 89 days past `2026-06-30` and nothing checks; SBOM; a licence allow-list replacing the deny-list; image scanning. | An expired review date fails the build. |
| W15.5 | Bump `@types/node` `^22.15.3` → `^24` to match `engines.node: ">=24.0.0 <25"`. Add `license` to the 4 packages missing it (`apps/api`, `apps/web`, `packages/ui`, `tools/migrate-cli`). | Both versions agree. |
| W15.6 | `tests/contract` needs the producer/consumer fixture matrix — 5 files but only 3 real contract cases; no version rejection, no unknown-field behaviour, no multi-reporter determinism. Its `not_configured` coverage declaration is **correct** and stays. | Every reporter generation round-trips; a version mismatch is rejected. |
| W15.7 | Mutation testing, tier 2, five core packages, `break: 75`, on PRs touching those paths plus nightly. | ≥75%, or a recorded reason per surviving mutant. |
| W15.8 | Build `pnpm review`: normalizer producing `findings.json` + `REVIEW.md`, diff mode `--base main`, and `review:pr`. The ruleset (15 rules) and `glob.mjs` (12 tests) exist; the emitter does not. | A Blocker/Critical finding blocks the merge. |

### W16 — Documentation, governance, capability truth · *gate: `pnpm docs:check` green with zero unbacked claims*

| # | Task | Evidence |
|---|---|---|
| W16.1 | **`scripts/docs-drift.mjs` + `pnpm docs:check`**, with its own tests: relative links resolve; every `pnpm …` in a fenced block exists; every port matches `vite.config.ts` and the compose files; every env var matches `packages/config`; every transport named in prose is SSE and never WebSocket; no page claims a capability whose row is not `real`; no ADR referenced without a record. | Planting `port 3456` makes it fail. |
| W16.2 | Fix the drift it names, all verified still wrong: `api-versioning-strategy.md` prescribes **Fastify** for a Hono API; `README.md` documents port **3456** in four places (`:74,79,90,108`) while `vite.config.ts:32` proxies to 3000 — its other six ports are correct; `parity-matrix.md` has 3 broken links (all targets are in `docs/migration/`); `secret-rotation.md` describes a **WebSocket** transport and rotates `AUTOMATE_DASHBOARD_API_KEY`/`VAULT_PASSWORD` (real: `AUTOMATE_API_KEY`/`VAULT_SECRET`); `dependency-vulnerability-sla.md` documents a nightly Gitleaks run and recommends a Dependabot config that does not exist; `PRD_QAce_Ecosystem_v2.md` is still `Status: Draft` under a dead product name; `.github/COMMIT_MSG_v1.0.0.txt` has three false claims and links a nonexistent `docs/migration-guide.md`; `db-migration.md:100,151` claims "31 Dashboard tables" against **33** actual in `dashboard.ts` (56 repo-wide). | `pnpm docs:check` green. |
| W16.3 | `RUNNER_REGISTRATION_SECRET` appears only as a bare name in a credential list, has no rotation procedure in `secret-rotation.md`'s table or sections, and is dual-consumed by api and runner. Given W1.2 closes the unset-secret hole, this is the last thing between it and being genuinely managed. | Every secret in the compose files has a documented rotation procedure. |
| W16.4 | **Make the capability register self-verifying.** Move to `docs/quality/capability-register.md`. The Evidence column cites **file paths, not executable commands**, so its own rule is unmet. Add a "last reviewed" date. It contradicts itself on the same Playwright execution — `tool.playwright` = `mock` (`:37`) and `quality.browser` = `real` (`:39`) — and has no `quality.mobile` row. 39 rows: 15 real, 14 mock, 6 deferred, 2 missing, 2 obsolete. Two `real` rows cite false evidence: `RunExplorer` (dead code) and a CI file. | Deleting the test behind any `real` row flips it to `unverified`. |
| W16.5 | `docs/adr/` — create, renumber, index with status and supersession. Record D1–D11. | The index resolves; `docs:check` reports no unrecorded decision. |
| W16.6 | Governance set, **0 of 7 exist**: `CODEOWNERS`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md`, PR + issue templates. | One line each in `docs/quality/hygiene-register.md`. |
| W16.7 | Populate `docs/quality/` — it holds 2 files. Add `debt-baseline.json` (cited by `eslint.config.js:98` but nonexistent), `capability-justification.md`, `boundaries.json`, `schema-migration-backlog.md`, `hygiene-register.md`. | One row per excluded glob, dormant table and pending contract migration. |
| W16.8 | `pnpm report:quality` — the nightly aggregate, with a `not_configured` gate shown as `not_configured`, never as a pass. | Generated, not written. |
| W16.9 | Archive the six superseded plan files with a one-line header pointing here; move to `.kilo/plans/archive/`. Do not delete — the reasoning inside is the evidence for the current design. | Each file names its successor. |

### W17 — Site and evidence console · *gate: site-doctor's ten checks pass*

| # | Task | Evidence |
|---|---|---|
| W17.1 | `site/` in-repo, VitePress, `base: "/AutoMate/"`, dual theme. Light technical-notebook chrome with dark instrument surfaces for code blocks, evidence samples and capability rows — prose is a claim, evidence is an instrument reading. Fonts self-hosted, sha256-locked, preloaded before first paint. | Paints its wordmark with no third-party round-trip; CLS zero. |
| W17.2 | Content: `guide/`, `reference/` (from the W9.6 OpenAPI document), `quality/`, `roadmap/` — the only page where a `not_configured` capability may appear. | Every number traces to a generated artifact. |
| W17.3 | `site-doctor.mjs` + tests, blocking the Pages job. Ten checks: contrast; **no typed claims**; asset budget; no-JS readability; motion budget; structural a11y; link integrity; brand-palette conformance to `packages/ui`; **capability honesty**; **artifact staleness**. | Deleting the test behind a `real` row turns the build red; a hand-typed number turns site-doctor red. |
| W17.4 | `.github/workflows/pages.yml`: least-privilege permissions scoped to the deploy job, all actions SHA-pinned, `fetch-depth: 0`, `concurrency` with `cancel-in-progress: false`, site-doctor **after** the build. | Satisfies the repo's own `gate-tooling.test.mjs`. |
| W17.5 | Token direction per D9 + a pre-hydration script. Add the type, elevation and motion scales Tailwind v4 does not serve; CSS stays authoritative, no token build step, no class-name migration. | Every colour/type/elevation/motion utility in both trees compiles. |
| W17.6 | Delete the 7 dead TS token modules; fix the `bg-primary` semantic trap where the token resolves to accent while `colors.ts` documents it as surface and the test encodes the wrong mapping. | `knip` reports them gone; the corrected test fails on regression. |
| W17.7 | The evidence console, built on reads that already exist — **no new endpoint.** Per-test attempts promoted to first-class evidence, replacing the structurally-always-zero `flakiness` field; quarantine state per test; the gate verdict beside the policy and thresholds that produced it, with shard-completeness arithmetic showing *which* shards are missing; artifacts with checksum, size and kind; the event timeline as causal history. A reserved region renders an explicit `not_configured` panel for the deferred intelligence tables. **No invented data, no placeholder chart, no fabricated zero.** | Every field traces to a row. |
| W17.8 | State-coverage matrix as a test — every route has loading/empty/error/partial. Gaps: `/login` has no loading treatment; `run-detail` uses ad-hoc `<p className="text-fg-muted">` instead of `EmptyState`; `AuthGuard` renders bare content on 401. | The test enumerates the matrix and fails on a missing cell. |
| W17.9 | Cross-browser (Firefox), mobile viewport and `sm`/`md`/`lg`/`xl` coverage; `toHaveScreenshot` baselines. **Zero** snapshots exist and the single `page.screenshot` is an unasserted artifact. Blocking pixel-diff nightly/release only (D6). | Claims about cross-browser and responsive behaviour are evidenced. |
| W17.10 | An OS matrix. Every job is `ubuntu-24.04`, yet Windows is the primary dev platform and `apps/runner/src/execution.ts:193-209` branches on it (`taskkill /t /f` vs `process.kill`) while being tested only with a synthesized `close` event. Plus a real `SIGKILL` and crash-restart test. | The platform fork is tested against a real signal. |

---

## 5. Named backlog

Deferred, not deleted. Each becomes a candidate only when its entry criterion is met.

| ID | Scope | Entry criterion |
|---|---|---|
| BK-1 | Five-domain execution engines (browser, API, load, security, Android) with real fixtures, cancellation, timeout, recovery, native evidence | W2 gate green; `packages/tool-sdk` exists |
| BK-2 | QA-intelligence tables: flake engine, clustering, root cause, suppression, self-healing locators, auto-repair, defect graph — the region W17.7 reserves | Fingerprint model stabilised; `flakiness` derived from real attempt data |
| BK-3 | Scheduler completeness: cron with day-of-week/month, misfire policy, blackout windows, quotas, priorities | W3.2 settled on one implementation |
| BK-4 | Exports: SARIF, Allure-compatible XML, signed evidence bundle | Fail-closed audit proven (W8, W9.1) |
| BK-5 | `apps/cli`: `run`, `test`, `schedule`, `connect`, `doctor`, `replay`, `export`, `backup` | W9.6 OpenAPI document exists |
| BK-6 | Real digest-pinned non-root runner images — `runners/{playwright,k6,zap}/Dockerfile` are still stubs and all three manifests are `unbuilt` with `imageDigest: null` | A decision on whether the isolation claim is kept or withdrawn |
| BK-7 | OSS surface: a recorded demo from a clean checkout, a measured time-to-first-run against the W16.2 quickstart, a good-first-issue set generated from these entries | W16 gate green |
| BK-8 | nginx base-image digest pinning and TLS termination — the image is pinned to a tag, and HSTS is absent because there is no certificate decision | W1.6 lands and a certificate decision is made |

---

## 6. Validation

1. `pnpm verify` and `pnpm security:verify` complete end to end; `gate-tooling.test.mjs` proves every job in all three workflows reaches its last step.
2. `pnpm coverage:ratchet` runs on a PR and fails on a regression.
3. `pnpm findings:check` green; no `fixed` row's evidence path is missing; no new high-severity row unreviewed.
4. A clean checkout migrates, authenticates, enqueues a real Playwright run, **executes it worker→runner**, streams durable events, shows normalized evidence, cancels/retries, recovers a lost lease and evaluates a release policy — with no in-memory store on the path.
5. Every error response carries a stable `code`, asserted at the route level and by a source gate.
6. The W6 rehearsal has restored a post-migration database and re-opened every encrypted row, on a seeded copy of the real migration graph.
7. No open Blocker/Critical. `complexity-baseline.json`, `coverage-baseline.json` and `debt-baseline.json` not regressed on any axis.
8. `pnpm docs:check` green with zero unbacked claims; the ADR index resolves.
9. `pnpm --filter site doctor` passes all ten checks and its capability table matches the register exactly.
10. Every task claiming a fix ships with a test proven to fail when the fix is reverted.

---

## 7. Risks

| Risk | Response |
|---|---|
| W1 touches live security paths with no regression net. | W0 lands first and alone; W1 in small PRs, each with its own fail-before test. |
| W7's ten migrations meet violating data. | D2's pre-audit, plus the W6 rehearsal gate. Until the W6 gate is green, W7 may only add nullable columns. |
| The W6 rehearsal is a real chunk of work that delays everything downstream. | It is the prerequisite, not a nice-to-have. Shipping tenancy migrations without it means an operator gets a 500 and no restore. |
| W3 is a series of delete-or-wire calls based on consumer analysis. | One PR each with the evidence recorded. Default is delete only when the consumer set is provably test-only; a wrong call surfaces immediately in review. |
| W5 splits a 2 166-line file that six tasks touch. | D3 splits it **first**, before any of the five fixes, so nothing gets re-based. |
| Half the `sweep`-provenance findings were never hand-confirmed. | The ledger records provenance per row; §8.1 requires spot-confirmation of the load-bearing ones before destructive work. |
| Sixteen waves is a large programme. | Each task is independently shippable and independently verifiable; any wave can stop after its gate without leaving a broken product. |

---

## 8. Open questions

1. **`gateStatus` — wire or drop (W1.4).** The column has zero producers and zero consumers. Wiring gives the release gate a real per-domain verdict it currently lacks; dropping is one migration and removes a permanently-wrong column. **Recommendation: wire it** — the release gate needs a domain-level verdict — and it feeds W9.3 and W17.7. This is a genuine fork, and the plan assumes wiring.
2. **`conversations` / `messages` ownership (W7.3).** Adding only `workspaceId` leaves any two sessions in one workspace reading each other's transcripts. Does this need a per-owner column, or is workspace-scope the intended boundary for an installation-scoped product? This blocks W7.3's backfill definition.
3. **Tenancy vs explicit single-tenant, for the 8 unscoped tables (W7.3).** P-20's own framing offers a fork: scope every table consistently, *or* drop the partial scoping and document single-tenant explicitly. **Recommendation: scope them all.** Partial scoping is the current state, and it is exactly what produced the live `schedules` cross-tenant trigger in W1.5.
4. **`vitest-axe` vs `@axe-core/playwright` in `apps/web` (W14.1).** ~~`vitest-axe` is declared and unused there, mirroring the unused `@axe-core/playwright` at the root.~~ **Refuted 2026-09-29 (ledger RF-12): `vitest-axe` is used.** `apps/web/src/test-axe.ts` imports `axe` from it and exposes `expectNoBlockingAxeViolations`, which fails on `serious` and `critical` violations; `packages/ui/src/test/axe.ts` does the same for the component library. Nothing is broken; the risk was entirely to the next reader, who was handed a documented reason to delete a package two suites depend on. Left visible rather than deleted so the correction is findable next to the claim it refutes.

---

## 9. Out of scope

Hosted SaaS; multi-tenant isolation; user/RBAC/SSO/SCIM administration; iOS device execution; Redis/Kafka/Kubernetes/Helm; a second orchestrator; a general workflow engine; arbitrary untrusted shell execution; MCP gateway; HTML scraping as a normalization path; Tauri desktop; mobile/native.

Also out by decision: multi-instance behaviour (D10); a token build step (D9/W17.5); tokenizing Tailwind's spacing and radius scales; localized READMEs and a translated site; a marketing site presenting aspirational capabilities as current; a CMS, search backend or analytics service; a blocking pixel-diff gate in PR CI (D6); adopting TanStack Query (D8).

**Not claimed:** that the bug count reaches zero. §3 is a point-in-time sweep of ~90 findings, not a proof, and the next sweep will find more. What §1 provides is that every confirmed defect has a severity and a disposition, nothing closes without proof, and `findings:check` makes the ledger's accuracy machine-verified.
