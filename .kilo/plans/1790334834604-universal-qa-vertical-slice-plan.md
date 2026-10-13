# Root Workspace Universal QA Vertical Slice

## Decision summary

- Treat `C:\VS-Code-Projects\Github\Automate` as the authoritative workspace. Keep the ignored nested `AutoMate` checkout read-only and use it only as a future salvage reference.
- Implement one complete browser-domain vertical slice, not all 15 product waves. The slice must prove the universal architecture without presenting unsupported frameworks as supported.
- Keep the API as a Hono modular monolith, but move execution work into separate `apps/worker` and `apps/runner` processes. Use PostgreSQL as the durable queue and local filesystem artifact storage for this slice; do not add Redis, Kubernetes, or an object-store SDK yet.
- Make `@automate/shared-contracts` the authoritative wire contract. Separate execution phase from quality outcome so infrastructure/configuration failures cannot be reported as ordinary test failures.
- Use a Node/TypeScript `@playwright/test` runner for the reference integration. The Python `services/webwright` sidecar is an action bridge, not a Playwright Test suite runner; retain it only for compatibility and do not label it L5.
- Keep the current single-admin/API-key deployment model for the slice, add a separate short-lived runner credential, and explicitly defer multi-tenant RBAC, SSO, SCIM, and enterprise secret providers.
- Make unknown evidence visible as `UNKNOWN`/`NOT_CONFIGURED`; never synthesize `PASS` or `completed` for domains that were not executed.

## Current constraints to preserve

- The working foundation is reporter ingestion → run/test persistence → dashboard queries → local SSE (`apps/api/src/routes/reporter.ts`, `apps/api/src/services/reporter-persistence.ts`, `apps/api/src/routes/events.ts`).
- The current database already has useful dormant tables for results, attachments, schedules, workspaces, users, and audit (`packages/db/src/schema/dashboard.ts`, `packages/db/src/schema/automate.ts`), but runtime code wires only a subset.
- Shared contracts are currently disconnected from API/web consumers; run IDs, event names, and statuses have multiple incompatible vocabularies.
- `runs.id` is UUID while reporter uploads accept arbitrary strings; the compatibility path must preserve external IDs without making them internal primary keys.
- The current web router has unreachable/demo routes and the Tailwind build pipeline is incomplete. Do not expand those surfaces until the canonical route tree and styling pipeline are verified.
- Production deployment currently lacks a reliable migration path and the Compose/CI environment is inconsistent. This slice must fix that before calling the vertical slice deployable.

## Acceptance criteria

A user can:

1. Create a browser test run from the web or `POST /api/v1/runs` with project, environment, release, branch/commit, selection, timeout, and idempotency data.
2. See the run move through `QUEUED`, `ASSIGNED`, `PREPARING`, `RUNNING`, `COLLECTING`, `NORMALIZING`, `ANALYZING`, `GATE_EVALUATION`, and `COMPLETE` without losing phase transitions.
3. Register a Playwright runner, see capability/health data, and have the worker/runner claim work durably.
4. Cancel, timeout, recover a lost runner, and retry without duplicate jobs or inflated test counters.
5. Inspect normalized tests plus original Playwright JSON/JUnit, stdout/stderr, screenshots, video, and trace evidence.
6. See a deterministic release-readiness result with explicit browser status and `UNKNOWN`/`NOT_CONFIGURED` for non-browser domains.
7. Retry a failed browser run from the run detail page and see the new run linked to the original evidence.
8. Continue using legacy reporter uploads/events through a compatibility adapter while new clients use the canonical contract.

The slice is not complete if any non-browser `/run` endpoint still returns a successful static artifact, if a failed/infrastructure execution is counted as a product test failure, or if an artifact has no persisted checksum/metadata and authenticated retrieval path.

## Canonical contracts and data model

Add versioned schemas under `packages/shared-contracts/src/schemas/` and export them from the package index. Use camelCase on the wire, matching the current TypeScript codebase, and keep a compatibility decoder for legacy payloads.

Define these dimensions separately:

```text
RunPhase:   queued | assigned | preparing | running | collecting |
            normalizing | analyzing | gate_evaluation | complete |
            cancelled | timed_out | runner_lost | infra_failed |
            config_failed | blocked | partial

RunOutcome: passed | failed | unknown | partial | cancelled | timed_out |
            runner_lost | infra_failed | config_failed | blocked | null

TestStatus: queued | running | passed | failed | flaky | skipped |
            blocked | unknown | cancelled | timed_out

GateStatus: passed | failed | warning | unknown | not_evaluated
```

A run has a non-null phase at all times and a non-null outcome only when evidence permits an outcome. Terminal infrastructure/configuration states remain distinct from `failed` product tests. The API may expose a deprecated `status` projection for old clients, but `phase` and `outcome` become the only persisted source of truth.

The canonical normalized run must include, when known:

```text
id, externalId, source, framework, adapterVersion, testType, projectId,
environmentId, releaseId, branch, commit, suite, tests, summary, phase,
outcome, timestamps, runner, configuration, error, rawEvidenceRefs,
artifacts, policyEvaluation
```

Required evidence fields are nullable only when the source did not provide them; the UI must render those values as `UNKNOWN`, not as a successful default.

Add explicit schemas for:

- `CreateRunRequest`, `NormalizedRun`, `TestResult`, `AttemptResult`, and `RunEventEnvelope`.
- `RunnerManifest`, `RunnerRegistration`, `RunnerHeartbeat`, `JobClaim`, `JobEventBatch`, and `JobCompletion`.
- `ArtifactDescriptor`, `QualityPolicy`, `GateEvaluation`, `ReleaseReadiness`, and `ReleaseDecision`.
- `IntegrationMaturity` with `L0`–`L5`, capabilities, adapter version, and evidence/test status.

`GateEvaluation.status` uses `passed | failed | warning | unknown | not_evaluated`; `ReleaseDecision` is a separate `ready | ready_with_warnings | blocked | unknown` value.

The event envelope must carry a stable `eventId`, monotonically increasing per-run `sequence`, `occurredAt`, `type`, `runId`, and typed payload. Do not broadcast arbitrary reporter payloads to browser clients.

## Ordered implementation plan

### 1. Establish architecture truth and support boundaries

- Add an ADR for the root-workspace decision, PostgreSQL queue, separate worker/runner processes, local artifact adapter, and single-admin limitation. Record nested `AutoMate` as excluded from workspace builds and dependency analysis.
- Add a typed integration maturity registry and expose it through `GET /api/v1/integrations/maturity`.
- Register Playwright Test as an execution integration only after the slice passes; register generic JUnit/JSON as import integrations. Mark Cypress, Vitest, Jest, pytest, Bruno, Newman, k6, ZAP, Appium, Maestro, and other agents as catalogued/not configured until they have executable adapters.
- Replace static successful responses in `apps/api/src/modules/agents/domains.ts` with explicit `not_configured`/`not_implemented` responses. Do not claim an agent is healthy because it returned a Markdown checklist.
- Record the supported execution lifecycle, quality-gate semantics, and artifact-retention assumptions in the ADR. Update stale operational documentation only where it conflicts with verified commands or files.

**Done when:** every visible integration has a maturity level and evidence status, and no route or document labels a scaffold as implemented.

### 2. Make shared contracts authoritative

- Add the canonical schemas and a `legacyReporterAdapter` that maps old `run:start`, `test:begin`, `test:end`, and `run:end` events into the new event/result model.
- Add UUID generation at the API seam. Persist reporter/tool IDs as `externalId` plus source metadata; never write an arbitrary external string into the UUID `runs.id` column.
- Add `@automate/shared-contracts` as an API and web dependency. Replace duplicate response schemas in `apps/web/src/lib/api.ts` and route-local schemas with imports from the package.
- Make `@automate/realtime` consume or re-export the canonical event types instead of maintaining a second event vocabulary; keep its reconnect helper separate.
- Add contract tests for every phase/outcome distinction, `UNKNOWN` handling, event envelope validation, legacy mapping, and version rejection.
- Keep old event names accepted only at the ingestion adapter seam. New API, worker, runner, and web code use only the canonical names.

**Done when:** API request/response tests, web parsing tests, and runner fixtures all compile against the same exported contracts.

### 3. Add durable persistence and idempotent ingestion

Extend the existing schema additively; do not rewrite the baseline migration or discard the dormant evidence tables.

Add or migrate the following persisted concepts:

- `runs`: `external_id`, source/framework/adapter/test type, project/environment/release IDs, `phase`, `outcome`, idempotency key, runner/job references, timeout/cancel fields, error code/message, and timestamps. Keep the old status column only as a transition compatibility projection while all runtime code moves to phase/outcome.
- `runners`: runner identity/version, OS/architecture, capabilities, labels, slots, health, token hash/expiry/revocation, and last heartbeat.
- `execution_jobs`: run ID, attempt, priority, available time, lease owner/expiry, heartbeat, job state, idempotency key, and terminal error.
- `run_events`: run ID, sequence, source, event key/hash, type, payload, and received timestamp with a uniqueness constraint.
- `artifacts`: run/test/result scope, kind, content type, storage key, checksum, size, expiry, and legal-hold metadata. Migrate existing `attachments` rows into this table and keep `attachments` as a deprecated compatibility alias for one window.
- `projects`, `environments`, `releases`, `quality_policies`, and `gate_evaluations` with workspace scoping. Only one workspace/project needs to be usable initially, but IDs must not be discarded.
- `audit_events` writes for enqueue, cancel, retry, runner registration, artifact access, and policy evaluation.

Implement an `ExecutionStore` seam with Drizzle and in-memory adapters. The Drizzle adapter must use transactions for job claiming and event application. The in-memory adapter exists for fast tests and local development only; production startup must continue to require PostgreSQL.

Apply reporter events as follows:

1. Validate the envelope.
2. Insert the event key/hash in the same transaction as the state change; a duplicate returns success without applying counters again.
3. Upsert the test/attempt record.
4. Recompute run summary counts from persisted attempts/results rather than incrementing counters for every event.
5. Persist step/stdout/stderr evidence instead of discarding it.
6. Publish only a redacted canonical event after commit.

**Done when:** duplicate reporter events, duplicate uploads, and concurrent event batches produce one stable run summary and one event sequence.

### 4. Add the execution API and worker

Add an API module with these versioned routes:

```text
POST /api/v1/runs
GET  /api/v1/runs
GET  /api/v1/runs/:runId
POST /api/v1/runs/:runId/cancel
POST /api/v1/runs/:runId/retry
GET  /api/v1/runs/:runId/artifacts
GET  /api/v1/artifacts/:artifactId
GET  /api/v1/releases/:releaseId/readiness
GET  /api/v1/runs/:runId/gate
GET  /api/v1/quality-policies
POST /api/v1/quality-policies
GET  /api/v1/integrations/maturity
```

`POST /api/v1/runs` validates the shared `CreateRunRequest`, scopes it to the current workspace, generates a UUID, creates the run and first job in one transaction, and returns `202` with the canonical run. The `Idempotency-Key` header is mandatory for production requests and has a database uniqueness constraint.

Add `apps/worker` as a separately started TypeScript process. It must:

- Poll/recover due schedules and create runs with deterministic schedule/idempotency keys.
- Reap expired leases, mark lost runners distinctly, and requeue only attempts allowed by policy.
- Enforce queue priority, available time, capability matching, concurrency/slots, starvation prevention, and workspace/project quotas represented by the current schema.
- Use `FOR UPDATE SKIP LOCKED` (or an equivalent tested PostgreSQL transaction) for claims.
- Expose a health/readiness signal and shut down gracefully.

Add `croner` to `apps/worker` to evaluate the existing `schedules.cron_expr` with timezone validation. Support the existing schedule model and reject unsupported blackout-window features explicitly rather than pretending they work.

Add a separate runner authentication middleware using `RUNNER_REGISTRATION_SECRET` and short-lived runner tokens. Keep reporter authentication on `REPORTER_SECRET`; do not reuse either secret for the dashboard API key.

Add structured errors with `code`, `message`, `requestId`, and safe details. Emit request IDs and audit records without logging tokens, environment secrets, or raw artifact contents.

**Done when:** API tests can enqueue, inspect, cancel, and retry a run without starting a browser, and worker tests prove lease expiry, duplicate claims, and capability matching.

### 5. Implement the reference Playwright runner

Create `apps/runner` as an independently startable Node 22 process with `@playwright/test` pinned to the version already used by `e2e/integration`. Do not use the Python action bridge as the canonical suite runner.

Runner protocol routes:

```text
POST /api/v1/runners/register
POST /api/v1/runners/:runnerId/heartbeat
POST /api/v1/runners/:runnerId/jobs/claim
POST /api/v1/jobs/:jobId/events
POST /api/v1/jobs/:jobId/artifacts
POST /api/v1/jobs/:jobId/complete
```

The runner must:

- Register capabilities (`playwright`, browser names, OS/architecture, labels, slots) and heartbeat.
- Claim only jobs matching its capabilities and lease them atomically.
- Execute a pre-registered local project/configuration using an argument array, never a shell-interpolated arbitrary command.
- Restrict target URLs to the environment/project allowlist, use an ephemeral workspace, and redact secrets from logs.
- Enforce timeout, cancellation, slot/concurrency limits, and cleanup in `finally` blocks.
- Use a custom Playwright reporter that writes typed NDJSON events for live upload while retaining native Playwright JSON and JUnit output.
- Upload raw report, stdout/stderr, screenshots, video, trace, and configured HTML/report files through the artifact endpoint.
- Send a completion payload only for the current lease; a late or duplicate completion is rejected/idempotently acknowledged.
- Convert runner loss, tool startup failure, configuration failure, and test failure into distinct terminal states.

Add a small browser smoke project at `e2e/fixtures/playwright-smoke` with a pass fixture and an explicitly selected failure fixture. Configure the normal root Playwright command to ignore that fixture directory; the normal test command must not contain `.only` or `.skip`.

Add `apps/runner/Dockerfile` with Chromium dependencies, a non-root user, resource limits, a read-only/ephemeral workspace, health signaling, and the same short-lived registration configuration. Keep the runner image separate from the API image.

**Done when:** a real Playwright project runs remotely, emits live events, stores native evidence, and can be cancelled/timed out without leaving a process or workspace behind.

### 6. Build the artifact and ingestion pipeline

Move the existing parsing logic out of the route handler into focused ingestion adapters:

```text
apps/api/src/ingestion/
  legacy-reporter.ts
  playwright-json.ts
  junit.ts
  normalized-result.ts
```

- Parse Playwright JSON and JUnit into the canonical normalized model.
- Preserve the original uploaded bytes and format before normalization; attach a checksum and source metadata to every normalized result.
- Reject unsafe paths, unsupported content types, and uploads over the configured size limit.
- Store artifact bytes through a small `ArtifactStore` seam with local filesystem and test-memory adapters. Never put binary data in PostgreSQL.
- Serve artifacts only through authenticated, path-safe download routes; do not expose filesystem paths as public URLs.
- Keep raw evidence when parsing fails, mark the run `partial` or `unknown` as appropriate, and surface the parser error rather than dropping evidence.

**Done when:** a failed Playwright run retains its original report and failure artifacts and the dashboard can retrieve each through metadata, not placeholder URLs.

### 7. Add deterministic quality and release intelligence

Implement a pure `evaluateQualityGate` module in the API. It must accept the normalized run, domain statuses, policy, and policy version/hash and return a deterministic `GateEvaluation` containing status, reasons, evidence references, and evaluated timestamp.

The first default policy requires browser evidence and treats the other domains as `NOT_CONFIGURED` unless explicitly required. The evaluator must implement these cases:

- Product test failure or threshold breach → `GateEvaluation.status=failed` and `ReleaseDecision=blocked` with a product reason.
- Missing required domain, missing report, or unavailable environment → `GateEvaluation.status=unknown` and `ReleaseDecision=unknown`, never green.
- Runner/infrastructure/configuration failure → `GateEvaluation.status=failed` with an explicit infrastructure/configuration reason, a distinct run state, and `ReleaseDecision=blocked`; never inflate the product-failure count.
- Only non-required domains missing → visible `NOT_CONFIGURED`, not a pass.
- Same evidence plus same policy version → byte-for-byte equivalent decision fields.

Persist policy and evaluation records, associate them with the release, and expose readiness through the release endpoint. Include a simple previous-successful-run comparison for pass rate and duration; defer statistical anomaly detection and AI narrative to later waves.

Add a deterministic release-readiness view that shows browser, API, mobile, performance, security, accessibility, and other required domains with explicit status values. Only browser may be `PASS` in this slice.

**Done when:** table-driven tests cover pass, product failure, infrastructure failure, missing evidence, unknown required domain, warning, and repeatability.

### 8. Replace fragmented web surfaces with one honest vertical slice

- Make `/dashboard` the Release Command Center and move the current run list to `/dashboard/runs` (or preserve an equivalent canonical route without duplicate route files).
- Reuse or adapt `apps/web/src/routes/dashboard/index.tsx`; remove the duplicate registration/placeholder ambiguity in `apps/web/src/router.ts`.
- Add a run launch form for registered project/environment/release, commit/branch, and test selection.
- Add run detail views for phase, outcome, test attempts, failure context, event timeline, artifact links, gate result, and cancel/retry actions.
- Connect the existing SSE stream to run list/detail state using the canonical event schemas. Reconnect and re-fetch after a missed event; do not rely on a process-local event being delivered exactly once.
- Display API/load/security/mobile as `UNKNOWN` or `NOT_CONFIGURED` with no runnable success state until adapters exist.
- Remove/disable dead navigation to unregistered routes and stale placeholder timeline/network/video/screenshot data. Keep deferred AI, MCP, GitHub, alerts, and authoring routes either explicitly experimental or unreachable.
- Add a route-manifest test and an all-visible-links smoke test so component tests cannot pass for routes users cannot reach.
- Consolidate new execution calls through one API client using shared-contract schemas. Do not add TanStack Query or Zustand solely for this slice; extend the existing hook pattern unless a second consumer makes a shared cache necessary.
- Repair the Tailwind v4 dependency/plugin/import pipeline so the existing utility classes and new command-center components render in the production build.

**Done when:** a user can navigate from command center to a live run, inspect real evidence, cancel/retry, and return to the updated release status without placeholder data.

### 9. Make deployment and CI run the slice

- Add `apps/worker` and `apps/runner` to the workspace build/test/typecheck/lint graph and the root `verify` filters.
- Add a one-shot migration service or entrypoint that builds `@automate/db`, includes `packages/db/drizzle`, and runs `db:migrate` before the API/worker become ready.
- Update `docker-compose.unified.yml` as the canonical local stack with PostgreSQL, API, web, worker, runner, migrations, and an artifact volume. Include `RUNNER_REGISTRATION_SECRET`, `REPORTER_SECRET`, `COOKIE_SECRET`, `ARTIFACT_ROOT`, and non-placeholder production values in the example environment.
- Add DB-aware readiness checks; `/health` may remain liveness, but readiness must fail when PostgreSQL or required runtime dependencies are unavailable.
- Fix the API image so migration files and compiled DB code are present. Keep the API and runner on separate networks/surfaces where the runner needs outbound access to registered test environments.
- Repair the integration Playwright configuration’s port, auth, and service-wait assumptions. Add a real vertical-slice scenario covering pass, failure evidence, cancellation, and retry.
- Update CI path filters and job dependencies so DB build precedes migration, runner/worker tests run, and the Compose smoke test uses current health endpoints.

**Done when:** a clean checkout can install, migrate, start the canonical Compose stack, execute the smoke project, and pass the browser vertical-slice E2E test.

## Validation gates

Run and record these before declaring the slice complete:

```text
pnpm verify
pnpm --filter @automate/api test
pnpm --filter @automate/shared-contracts test
pnpm --filter @automate/db test
pnpm --filter @automate/unified-web test
uv run --project services/webwright pytest services/webwright/tests
uv run --project services/webwright ruff check services/webwright
uv run --project services/webwright mypy services/webwright/src
pnpm --filter @automate/integration-tests exec playwright test
pnpm --filter @automate/integration-tests exec playwright test vertical-slice.spec.ts
docker compose -f docker-compose.unified.yml config
```

Add focused tests at these seams:

- Shared contract parsing and legacy mapping.
- HTTP enqueue/detail/cancel/retry and runner authentication.
- PostgreSQL job claim, lease heartbeat, expiry, and idempotency under concurrent requests.
- Runner fake adapter for pass, product failure, cancellation, timeout, and late completion.
- Artifact path safety, checksum, size limit, retention metadata, and authenticated retrieval.
- Gate evaluator truth table and deterministic repeated evaluation.
- Web route completeness, release state rendering, live event updates, and real artifact links.

Use a real PostgreSQL migration test and a real runner/browser E2E test in addition to mocks. Do not accept cached coverage or stale `.last-run` artifacts as validation.

## Rollout and rollback

1. Apply additive schema changes and backfill old runs with conservative phase/outcome mappings. Leave unknown source/framework fields unknown; do not infer evidence.
2. Deploy compatibility ingestion and canonical read/write mapping while keeping legacy reporter endpoints operational.
3. Start the worker and one isolated Playwright runner; run pass/failure/cancel smoke tests against a disposable environment.
4. Switch the web command center to canonical execution endpoints only after migration and E2E gates pass.
5. Keep legacy routes and old columns for one compatibility window. Remove them only after downstream reporter and UI consumers are confirmed migrated.

Rollback is non-destructive: stop worker/runner, route the web app back to the existing dashboard, and leave additive tables/raw evidence in place. Never roll back by deleting evidence or dropping columns. Take a database backup before applying the migration.

## Explicitly deferred

- Cypress, Selenium, WebdriverIO, Vitest, Jest, pytest, Bruno, Postman/Newman, k6, JMeter, Gatling, ZAP, Appium, Maestro, Pact, accessibility, visual, mutation, and coverage adapters beyond the shared ingestion seam.
- Generic ingestion formats beyond Playwright JSON and JUnit.
- Full AI agents/model gateway/evaluation datasets, ChatOps, notifications, issue/defect sync, VCS/CI bidirectional integrations, and connector SDK/plugin ecosystem.
- Organization/workspaces/teams/RBAC/ABAC, OIDC/SAML/SCIM, Vault/cloud secret providers, Kubernetes/Helm/HA, multi-instance event broker, and advanced retention/legal hold.
- Failure clustering, flake intelligence, anomaly detection, test selection, quality graph, cost intelligence, and executive reporting beyond the deterministic first release view.

These are subsequent waves gated by the same maturity registry and contract tests. No later integration may be marketed as L5 until the Golden Integration Contract is evidenced.

## Risks and mitigations

- **PostgreSQL queue semantics:** test claims against real PostgreSQL, not only PGlite; use transactions and unique constraints as the source of truth.
- **Playwright image/runtime size:** pin one browser/runtime combination for the reference runner and defer multi-browser matrices until the protocol is proven.
- **Multipart memory use:** enforce bounded artifact/report sizes before parsing and stream runner event batches.
- **Legacy ID/status drift:** keep decoding at one adapter seam and assert canonical responses in HTTP tests.
- **UI route drift:** generate/check a route manifest and remove visible links to deferred surfaces.
- **Security claims:** keep runner commands/URLs allowlisted, tokens short-lived, artifacts authenticated, and production deployment single-admin until identity/tenant work lands.
- **SSE scale:** use durable run events and reconnect/re-fetch semantics now, but advertise single-instance deployment only; add a broker before HA claims.
