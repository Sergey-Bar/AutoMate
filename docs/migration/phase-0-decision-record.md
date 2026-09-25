# Phase 0 Decision Record

## Decision status

**PASSED FOR LOCAL-ONLY IMPLEMENTATION — production cutover, source overlay, and publication remain blocked pending the listed approvals.**

This record covers the clean migration worktree at commit `01cc19c8167e0e8365928862de463fd50caaee5c` on branch `migration/phase-0`. It does not approve Phase 1 or claim migration parity.

The durable specification is `docs/migration/unified-repository-migration.md`, copied byte-for-byte from `.kilo/plans/1790276458882-unified-repository-migration.md` with SHA-256 `c8918b47ee049cd5ba75269b17204e6dc1e4965de138631c100e8e105abbeb59`.

## Worktree and preservation

The original dirty checkout was not switched, reset, cleaned, stashed, or overwritten. The migration worktree was created from the explicit base commit in an external temporary directory. The original checkout remains on `feature/unified-platform` with its user changes.

| Evidence                      | SHA-256 or result                                                  |
| ----------------------------- | ------------------------------------------------------------------ |
| Tracked binary patch snapshot | `e42a2cbc4a83120b065185dc7547c6c5e8de7da3e79f4a0ddc060faf5cf0db62` |
| Exact untracked-file archive  | `5eb8ead108d1d5fe5bdc2edc1874c49ce3087b119e52e86484826f64a5d8feb7` |
| Original status               | 22 modified tracked paths, 0 staged paths, 15 untracked paths      |
| New worktree status           | clean at creation                                                  |
| Production data copied        | no                                                                 |

The source code snapshots were also verified with `git fsck --connectivity-only --no-dangling` and clean `git status --short --untracked-files=all`.

## Owner scope confirmation

The owner confirmed that AutoMate and the pinned Dashboard are local/sample-only. No production traffic, production data, or production cutover is authorized in this migration branch. The owner also confirmed that no Git remote is established; publication remains blocked.

The owner delegated the safest handling of the pinned Dashboard auth artifact. It is therefore treated as potentially sensitive: its contents were not inspected, copied, logged, or migrated. Security review remains required before any source archive or overlay decision.

## Dirty-file classification

Every path visible in the original worktree is listed exactly once. `keep` means preserve the intent in the migration branch; `reimplement` means do not port the current patch unchanged; `discard` means generated, stale, or unsuitable material. Historical material is archived outside the active branch before deletion.

| Path                                                                                                                        | State     | SHA-256                                                             | Classification | Disposition                                                                      |
| --------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------- |
| `.github/workflows/unified-ci.yml`                                                                                          | modified  | `64daf271c013dc8a954cae5fb96b79ef279e50592f887ee4faa173e00fd6f2a3`  | reimplement    | Rebuild root CI gates in Phase 1; do not port the automation-score change.       |
| `README.md`                                                                                                                 | modified  | `7f3bbd85a01bcf7c676441da226a66f27b400fc2c02f99febde2e9a6f0140f19`  | reimplement    | Rewrite against the capability register and canonical commands.                  |
| `apps/api/src/config.ts`                                                                                                    | modified  | `d4ae4c4871f3f94126c4dfdf46424c25507ccb80e57d77c27f80cccdaec8585d`  | reimplement    | Reimplement typed config ownership and the deprecated alias parser.              |
| `apps/api/src/index.ts`                                                                                                     | modified  | `83042baf015be5ee0ad99840e8249453dbfb28aca1cd3e9a9fe1ffd1b8c66926`  | reimplement    | Rebuild composition in Phase 3; do not add direct environment reads.             |
| `apps/api/src/middleware/auth.test.ts`                                                                                      | modified  | `50710125b5121dc959b7a6dc3e026592fcc9e71b076ff4aa476497205f085de8`  | reimplement    | Replace reachability-only tests with session contract and revocation tests.      |
| `apps/api/src/middleware/auth.ts`                                                                                           | modified  | `ebc7c1575c7d9f68cd05c59f61155b3d53b12df32041cf3a1485cc980fc5a629`  | reimplement    | Replace the signed-constant cookie with revocable server-side sessions.          |
| `apps/api/src/routes/auth.test.ts`                                                                                          | untracked | `57a9c4d9ad8522a89f8749121d15e5d826e3162610530609f6fc44e314567a46`  | reimplement    | Reimplement hermetic route tests against the canonical auth contract.            |
| `apps/api/src/routes/auth.ts`                                                                                               | untracked | `5fd311786e35765a76936b736cb0d1a820305ca15fbf9bc0fc43ef3196c30747`  | reimplement    | Reimplement login, logout, and session issuance with persistence.                |
| `apps/web/src/auth/auth.test.tsx`                                                                                           | modified  | `8aee1018aaafdfd399ee220004f87bda4a3a00c6548cb5d8a5edb73f38934e14`  | reimplement    | Replace the client flag and fragmented hook tests.                               |
| `apps/web/src/auth/AuthGuard.tsx`                                                                                           | modified  | `737a1f99392581e64a5fffd13c1633756fe34a66e01e8ec40cf7b0b1514a4dde`  | reimplement    | Use a shared server-authoritative session provider.                              |
| `apps/web/src/auth/useAuth.ts`                                                                                              | modified  | `81deaff8403cd2e5ce5c78b244bd569ebc1bca92048f7c9c9a9aaf50711f59ff`  | reimplement    | Replace per-hook state with one application-level auth state.                    |
| `apps/web/src/components/NavBar.test.tsx`                                                                                   | modified  | `81832cae29fd99766097e3083689d9d4fc7c0bf6362d0d049c53787c4a825d8a`  | reimplement    | Preserve session-derived visibility and logout intent with shared state.         |
| `apps/web/src/components/NavBar.tsx`                                                                                        | modified  | `7482f20f458a20d1cce08351110ddb5e6b5dfcdfaf8dea79b3d65f808a507ff9`  | reimplement    | Reuse approved UI primitives and accessible navigation semantics.                |
| `apps/web/src/components/Sidebar.tsx`                                                                                       | modified  | `e8c7c29d3cad3a84543e8f948377c6fcef1848166bfd9f6056f65afe12fcad43`  | reimplement    | Rebuild route IA and collapsed-link accessibility.                               |
| `apps/web/src/index.css`                                                                                                    | modified  | `f657cf44c7fc0c5e0eb4b320dbf914c9bbbadbec29817fb558ef7efdfd65bcbe`  | discard        | Unverified visual identity; retain only as design evidence.                      |
| `apps/web/src/router.test.tsx`                                                                                              | modified  | `fd90ee43739600eb2e837e83250b2937ecc80f509356d6a0ad83d303df66bb15`  | reimplement    | Rebuild route coverage around the launch route set.                              |
| `apps/web/src/routes/__root.tsx`                                                                                            | modified  | `4437527fd926a341a99e89e93ab237dc03c760324e94d4363d2f3e806c8ec7e3`  | reimplement    | Separate authenticated and unauthenticated layouts.                              |
| `apps/web/src/routes/login.tsx`                                                                                             | modified  | `4d8e0ed2e4cc7c39c7ca6afd52a940d41a8645eeb005b0b95581f5dfcbd12334`  | reimplement    | Reimplement masked login and accessible error handling.                          |
| `apps/web/src/vite-env.d.ts`                                                                                                | untracked | `424faf9241dd699dda995b367ed36665732da1e6ec1f33b2fd40394488ecac92`  | reimplement    | Add standard Vite types when the web package is rebuilt.                         |
| `apps/web/vite.config.ts`                                                                                                   | modified  | `1efa527af3a95f36485a66264a3a5cdbe20bc86fb4ee873033f301a26bcc8d90`  | reimplement    | Align proxy and one Playwright topology atomically.                              |
| `docker/.env.example`                                                                                                       | modified  | `c73a9bd499a4151d6483410ac303224bf6bb88d3111f364c01199d69be1433d3`  | reimplement    | Replace with one validated root environment example.                             |
| `docs/deployment.md`                                                                                                        | modified  | `299d84dccbb230ccbee9a24cc5f94f8983deb577efa46e835a1d0cd8eb35dc33`  | reimplement    | Rebuild after canonical infrastructure exists.                                   |
| `e2e/integration/test-results/.last-run.json`                                                                               | modified  | `96d879a8f41164927d2a26a7c326dcb963db4379e4e69a66510811dab442bf7c`  | discard        | Generated and not product truth.                                                 |
| `package.json`                                                                                                              | modified  | `c5f328fdbb171d3291324c659a7e2b84799dc4b2d1b11cff10b3673f8c34dfbb`  | reimplement    | Discard current automation-score and auth-bypass deltas; rebuild root commands.  |
| `pnpm-lock.yaml`                                                                                                            | modified  | `24fb869eb6b5cf843a93a6ba62e7e7e73962a096779e1c8d5dcaa7b2907b4954`  | reimplement    | Resolve dependency drift in focused manifest changes.                            |
| `.artifacts/automation-playwright-report.clean.json`                                                                        | untracked | `79685363e7fb04fbd263a9c0b7c1223578afb4393347e059402a159518ba8948`  | discard        | Generated, foreign, and invalid output.                                          |
| `.artifacts/automation-playwright-report.json`                                                                              | untracked | `e6d7d8408f77eac998c21b1432f4a83a06c39cb97ebe438de6aeaa0c8b35226a`  | discard        | Generated output with command error text.                                        |
| `.artifacts/automation-playwright-report.utf8.json`                                                                         | untracked | `25981ee0b3430ef98fd003af954537361cf17e65f16ea9805021477b8536f0c6`  | discard        | Generated output with encoding and command errors.                               |
| `.artifacts/automation-playwright-report.valid.json`                                                                        | untracked | `b6674240476a55047dfd88821dae110a7797f491289bd1d6d5f8955cb6600e43`  | discard        | Valid JSON but stale foreign-checkout evidence.                                  |
| `.artifacts/playwright-automate-report.json`                                                                                | untracked | `3e6f7a7fa4acf67130a217c57ffed1fceb8907447f20dcf8356ef28342cf6644`  | discard        | Not JSON; generated failure text.                                                |
| `.kilo/plans/1790276458882-unified-repository-migration.md`                                                                 | untracked | `c8918b47ee049cd5ba75269b17204e6dc1e4965de138631c100e8e105abbeb59`  | keep           | Durable copy is `docs/migration/unified-repository-migration.md`.                |
| `CLAUDE.md`                                                                                                                 | untracked | `cb86c410332798e6a3fac25b8c681b903ae13e684a7ac87370533449cf8a7e64`  | discard        | Local agent notes describe the dirty implementation and are not authority.       |
| `COMPLETION_SUMMARY.md`                                                                                                     | untracked | `c7058fd3947402f71fa3b5a7e3fc883130656a54da76b55c288435e436d308fb`  | discard        | Archive-only; readiness and test claims are unverified.                          |
| `DEPLOYMENT_READY.md`                                                                                                       | untracked | `39dab9b21851701209bbf8caca4c8ca1ec292321735840373b495af5772005c3`  | discard        | Archive-only; deployment claims are unsupported.                                 |
| `e2e/integration/test-results/vertical-slice-vertical-sl-3827e--passed-without-reload-T29--vertical-slice/error-context.md` | untracked | `f1f04cceb677e3de53ff0e9d6ab80f0f873e4fc065e571568a157c9816a7d269`  | discard        | Generated incident context; retain only outside the branch if needed.            |
| `e2e/integration/test-results/vertical-slice-vertical-sl-55025--exact-seeded-run-item-T29--vertical-slice/error-context.md` | untracked | `117396049906197e96f41913ba5235bfa48a823fa86cadd2cb0ba80cfac50400e` | discard        | Generated incident context; retain only outside the branch if needed.            |
| `scripts/automation-score.mjs`                                                                                              | untracked | `dfd251bc2bb090ae31423ad7eff32cf202e228b0761c1b2ba6b7fa29c802fff3`  | discard        | Wall-clock score and generated artifacts conflict with native Playwright status. |

## Source decisions

### AutoMate

The pinned source is `bce507ecc36e9f5cc33b3016741238b7fc834f0f`, tree `6c7b2a31ea9268929a17b839fb87ff5f2b2a6f8d`. It is a frozen extraction source, not an overlay. The source declares SQLite for the main and vault databases, carries a versioned Drizzle migration plus an inline migration path, and includes tracked SQLite/WAL/SHM residue that must be classified before any archive or import decision.

The local AutoMate checkout is on a different feature commit (`547f9d2709261f6bfea187faba2d732c406a0846`). The owner confirmed there is no production deployment in scope, so the pinned source remains frozen locally and no credential revocation, write freeze, or source deletion is authorized by this record.

### Dashboard

The pinned source is `b5a068538e433e09d816292852dba2a0a87acf22`, tree `53c5be4fc2b43a5fa35dfeca20a9c9ca020ab0c4`. The local `AutoMate/dashboard/` candidate is materially different: it has different repository/package identity, SQLite versus claimed PostgreSQL persistence, different reporter authentication, different auth and feature flags, different routes, tests, and deployment. The candidate is evidence only and must not be overlaid.

The pinned Dashboard commit tracks `apps/server/.automate/auth.json` with Git blob `a3122fc30615e7ccb1cc89735a7943e62346b24d`. Its contents were not inspected or copied. Under the owner-confirmed safest-handling policy, it remains quarantined as potentially sensitive and requires security review before migration.

### QA-Doctor / Mjölnir

QA-Doctor is a clean, read-only reference at `d981ba356313ae8cea0538ca85c665e88b84c530`, tree `c44660685f33a52ae408cd2b0ab3921190c56578`. No QA-Doctor code or generated report is imported.

## Traceability decisions

| QA-Doctor concept                         | Decision | Target treatment                                                                    |
| ----------------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| Bounded streaming JUnit parsing           | adapt    | Add bounded parser and explicit partial/malformed states in the reporting boundary. |
| Run-local retry semantics                 | adapt    | Preserve every declared attempt and derive first/final outcomes separately.         |
| Proof, completeness, and trust ceilings   | adapt    | Make evidence dimensions explicit and policy-driven.                                |
| Deterministic evidence and SARIF ordering | adapt    | Reimplement as a canonical projection with stable ordering.                         |
| Run identity and provenance               | adapt    | Bind identity and toolchain provenance to canonical runs and attempts.              |
| Artifact collection                       | adapt    | Port the collection intent to the shared artifact-storage port.                     |
| Source-only reporter packaging            | cite     | Preserve the packaging discipline, not the old package surface.                     |
| Suppression policy                        | reject   | No accepted product requirement or suppression data contract yet.                   |
| Evidence graph and advanced trends        | reject   | Product dashboard and reporting package remain canonical.                           |
| Remote worker pool architecture           | reject   | Use the Automate execution-provider port and durable runner protocol.               |
| Committed static HTML report              | reject   | Use authenticated product views and immutable artifacts.                            |
| Boolean `verified` sentinel               | reject   | Use proof and completeness dimensions instead.                                      |

## Phase 0 gate

| Check                                                              | Status                     | Required action                                                                      |
| ------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------ |
| Source commits materialized and clean                              | passed                     | none                                                                                 |
| Dashboard provenance verified                                      | passed                     | none                                                                                 |
| Dirty inventory complete                                           | passed                     | none                                                                                 |
| QA-Doctor traceability recorded                                    | passed                     | none                                                                                 |
| Capability register recorded                                       | passed                     | none                                                                                 |
| Production data sources reproducible                               | passed for scope           | Owner confirmed local/sample-only scope; no production data migration is authorized. |
| AutoMate deployed SHA confirmed                                    | passed for scope           | No production deployment is in scope; pinned source remains frozen locally.          |
| Active consumers, traffic, jobs, and reporter versions inventoried | passed for scope           | No production traffic or jobs; local-only consumers remain unknown.                  |
| Rollback retention and credential rotation approved                | deferred                   | Required before any production or decommission action.                               |
| Product, data, security, and engineering approvals                 | local scope approved       | Formal production sign-off remains deferred.                                         |
| Dashboard auth artifact security review                            | blocked for source overlay | Do not inspect, copy, or migrate the tracked artifact.                               |
| Target Git remote established                                      | blocked for publication    | Required before publication; local implementation may proceed without it.            |

## Phase 1 validation evidence

| Gate                  | Result                    | Evidence                                                                                                                                                                                  |
| --------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen install        | passed with host override | `pnpm install --frozen-lockfile --config.engine-strict=false` completed without lockfile mutation; the committed policy is now Node `>=24.0.0 <25` (see the runtime contract note below). |
| Formatting            | passed                    | Scoped governance-file `pnpm format:check` passed; legacy product formatting is not silently rewritten.                                                                                   |
| Lint                  | passed                    | Root `pnpm lint` passed, including browser/shared-contract import boundaries.                                                                                                             |
| Typecheck             | passed                    | Root and workspace typechecks passed after removing ignored child-route imports.                                                                                                          |
| Drizzle check         | passed                    | `drizzle-kit check` reported a consistent migration graph.                                                                                                                                |
| Unit tests            | passed                    | Full Turbo test suite passed; the PGlite API suite is covered with 30-second hook/test limits.                                                                                            |
| Build                 | passed                    | Full Turbo build passed; build configs exclude test sources.                                                                                                                              |
| Security              | passed                    | High-severity audit threshold passed after scoped overrides; remaining findings are 2 low and 12 moderate.                                                                                |
| API E2E               | passed                    | `pnpm test:e2e:api` passed 3 API vertical-slice tests.                                                                                                                                    |
| Local integration     | passed                    | PGlite identity integration passed installation bootstrap and session revocation persistence tests.                                                                                       |
| Browser E2E           | passed                    | Authenticated `pnpm test:e2e:vertical` passed all 5 API/browser/SSE cases using the canonical session route.                                                                              |
| Full verify composite | passed                    | Full `pnpm verify` passed under the then-pinned runtime; the engine policy no longer rejects a Node 24 launcher (see the runtime contract note below).                                    |

### Runtime contract note

The gate evidence in this section was collected under the previous runtime major, which this repository no longer pins; the pre-change values remain in git history. On 2026-09-25 the committed runtime contract moved to Node 24: root engines `>=24.0.0 <25`, `.nvmrc`/`.node-version` `24.21.0`, CI `NODE_VERSION: 24.x`, and Docker base images `node:24.21.0`. The engine-policy block on a Node 24 launcher is therefore resolved, and the full `pnpm verify` composite must be re-run under the new contract before this evidence is refreshed.

## Phase implementation status

| Phase | Local implementation status                                                                                         | Remaining boundary                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 0     | complete                                                                                                            | Production provenance and source-auth security review remain deferred.                 |
| 1     | complete for local governance                                                                                       | CI still lacks external secret-scanning jobs; Node 24.21.0 is the release runtime.     |
| 2     | contracts, adapters, API result boundary, and fixtures implemented                                                  | Durable outbox and full producer breadth remain Phase 3/5 work.                        |
| 3     | config owner, cookie sessions, identity schema, session repository, artifact store, and replay boundary implemented | Two-instance PostgreSQL/SSE tests and vault/audit retention are not yet proven.        |
| 4     | canonical KPI/gate policies and RunExplorer API/UI implemented                                                      | Dashboard projections still need durable database read models.                         |
| 5     | orchestration state machine, runner SDK, runner control routes, and local guard implemented                         | OCI images are unbuilt; rootless execution and leases are not container-verified.      |
| 6     | dynamic Kilo/Ollama gateway adapters implemented                                                                    | Persisted chat/tool runs, approvals, and provider sandbox tests are not wired.         |
| 7     | connector SDK, bounded adapters, and versioned vault envelope implemented                                           | Durable connector configs, credentials, and artifact-backed executions are not wired.  |
| 8     | deterministic plan/state/catalog/artifact/vault transfer primitives and real target-DB verification implemented     | Resumable apply remains intentionally blocked until real wave/restore evidence exists. |
| 9     | loopback rehearsal guard and local compose assets implemented                                                       | Docker/Podman rehearsal is blocked on unavailable local container tooling.             |
| 10    | obsolete Webwright, mock API/UI surfaces, legacy deployment files, and stale docs removed                           | Dormant source data and historical artifacts remain retained externally.               |

## Current blockers

- `pnpm migrate:apply` intentionally refuses non-dry-run writes until resumable waves, native backups, and restore verification are enabled.
- `pnpm oci:verify` correctly fails because the three runner image digests are unbuilt; no Podman runtime is installed and the Docker Desktop daemon is not running on this host.
- Authenticated full E2E now passes all 5 vertical-slice cases; production browser sessions remain outside local scope.
- The pinned Dashboard auth artifact remains quarantined and was never opened.
- No production data, remote, registry, credential rotation, or publication action is authorized.

## Phase 1 review closure

The independent review findings are now addressed as follows:

- Root Playwright discovery, API E2E, central TypeScript, pnpm catalog, forward migration, contract, runner, and migration commands are implemented; OCI commands are present but truthfully blocked until images are built.
- Boundary preflight passes 36 checks, including nested repository/tool authority, generated output, and test marker checks.
- API/web/shared-contract and new domain-package coverage floors are measured and enforced; the ratchet passes.
- Obsolete Webwright, mock API/UI, legacy deployment, and stale documentation surfaces are removed.
- External Gitleaks/Semgrep services and production-grade secret scanning remain deferred; the local tracked-file secret scan now passes.

The local-only implementation gate is passed for the governance work completed so far. The full migration plan remains active; production cutover, source overlay, decommission, and publication remain blocked until the deferred approvals and security review are complete.
