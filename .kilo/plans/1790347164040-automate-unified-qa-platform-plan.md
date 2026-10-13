# Automate — One Product, Five Cumulative Capability Gates

**Plan type:** implementation-ready product and delivery plan  
**Canonical product name:** Automate everywhere  
**Target:** self-hosted, single-tenant, English-only QA automation control plane  
**Initial topology:** one host with optional additional remote runners  
**Source of truth:** this plan plus the current capability register; no feature may be described as operational without executable evidence

## 1. Executive decision

Build one Automate monolith with one shared execution and evidence model. The five requested “versions” are cumulative release gates, not five separate products or codebases. Every gate remains deployable and usable on its own, and no later gate may reintroduce mocks, duplicate contracts, or process-local production state.

The product promise is:

> Describe, generate, schedule, execute, observe, explain, and gate every QA activity across Web/E2E, API, Performance/Load, Security, and Mobile from one local-first control plane.

The user-facing name is **Automate**. Remove all legacy product names from routes, labels, documentation, generated artifacts, and user-visible descriptions. Keep the `@automate/*` package namespace unless a separate migration decision is approved.

## 2. Non-negotiable product guarantees

1. **Real execution only:** a successful run means an approved tool actually executed in an isolated runner. No static agent response, fixture-only response, or hard-coded KPI can satisfy an acceptance gate.
2. **Evidence before claims:** every pass, failure, gate, and AI conclusion references persisted evidence, provenance, completeness, and proof state.
3. **Honest uncertainty:** missing, malformed, unsupported, stale, or unavailable evidence is `unknown`, `partial`, `not_configured`, or `blocked`; it is never silently passed or counted as a product failure.
4. **Separated state:** execution phase, quality outcome, evidence completeness, proof, severity, and gate decision are independent dimensions.
5. **One contract authority:** API, web, worker, runner, reporter, connectors, and CLI use `@automate/shared-contracts`; compatibility decoders live only at ingestion seams.
6. **Secure by default:** runner code never executes inside the API process, secrets are short-lived and redacted, artifacts are authenticated, and untrusted code is isolated.
7. **No silent degradation:** if Ollama, Kilo, a device, a connector, or a tool is unavailable, the product shows the exact dependency and remediation rather than pretending success.
8. **Cumulative, reversible delivery:** migrations are additive, raw evidence is preserved, and rollback never deletes data or drops columns.

## 3. Current repository truth

The plan starts from the dirty working tree and does not discard or overwrite it.

- The current README describes the repository as local/sample-only and explicitly blocks production cutover (`README.md:12-16`, `README.md:247-255`).
- Reporter ingestion, basic persistence, RunExplorer, quality gates, and process-local SSE exist, but durable multi-instance behavior is not complete (`README.md:47-56`, `docs/migration/capability-register.md:21-30`).
- The API composition still selects in-memory run/execution/realtime/orchestration implementations when local configuration is used (`apps/api/src/index.ts:74-193`). Production must use durable adapters only.
- The API mounts canonical and legacy run routes together; `GET /api/v1/runs` merges two stores (`apps/api/src/index.ts:167-184`, `apps/api/src/routes/execution.ts:469-487`). The legacy runner route returns no jobs while `packages/runner-sdk` targets that dead protocol (`apps/api/src/routes/runner.ts`, `packages/runner-sdk/src/client.ts`).
- The deployed worker has lease primitives but passes no execution handler (`apps/worker/src/main.ts:38-77`), so a clean process can poll forever without running a job. This must be fixed before any execution claim.
- Run identity is inconsistent: `runs.id` is a PostgreSQL UUID (`packages/db/src/schema/dashboard.ts:126-129`) while the legacy repository can insert reporter string IDs (`apps/api/src/repositories/drizzle-run-repository.ts:33-57`).
- The two Compose topologies diverge: `docker-compose.unified.yml` includes worker/runner while `infra/compose/compose.dev.yml` does not (`docker-compose.unified.yml`, `infra/compose/compose.dev.yml:1-85`). Select one canonical topology and make the other a generated/compatibility artifact.
- Agent routes currently return `501 NOT_CONFIGURED` for the five domains (`apps/api/src/routes/agents.ts:3-65`).
- The runner currently wires only the Playwright process adapter (`apps/runner/src/main.ts:43-67`); the maturity registry marks most other integrations at L0 (`apps/api/src/execution/maturity.ts:15-176`).
- Projects, environments, and releases have schema definitions but no product CRUD routes; the web launch form requires pre-registered IDs (`packages/db/src/schema/execution.ts:80-150`, `apps/web/src/routes/dashboard.tsx`).
- Shared contracts contain multiple generations of run/event vocabulary, and `GET /api/v1/features` returns no capability negotiation (`packages/shared-contracts/src/schemas/`, `apps/api/src/routes/health.ts:46-50`). Canonicalize these seams in v1.
- AI gateway adapters exist in `packages/automation/`, but provider-backed conversations, approvals, durable tool runs, and product flows are not composed.
- The current web route manifest exposes only the command center, runs, run detail, analytics, and login (`apps/web/src/route-manifest.ts:1-11`).
- `docs/migration/phase-0-decision-record.md:160-178` records unresolved OCI, production, migration-apply, and external-consumer gates. This plan does not treat those gates as already passed.

## 4. The five QA domains

All domains use the same project, environment, release, run, job, lease, evidence, artifact, policy, and gate modules. Domain adapters are replaceable; none owns a separate database or dashboard.

| Domain | Primary engine | Required inputs | Canonical outputs and evidence | Failure semantics |
|---|---|---|---|---|
| Web/E2E and accessibility | Playwright Test | project, base URL, branch/commit, suite/selection, browser matrix | test/attempt/step events, Playwright JSON, JUnit, traces, screenshots, video, console/network evidence | product failure, flaky, blocked, config failure, timeout, and runner failure remain distinct |
| API | Bruno CLI; Newman/Postman compatibility | OpenAPI/JSON, collection, environment, auth references, base URL | request/response assertions, JUnit/JSON, sanitized request metadata, response bodies with secret redaction | assertion failure, schema failure, environment failure, auth failure, and infrastructure failure are typed |
| Performance/Load | k6 | scenario, VU/stages, thresholds, environment, data | JSONL/JSON, OTel/Prometheus-compatible metrics, threshold decisions, latency/error/throughput series | SLA breach is a quality result; tool/runtime failure is infrastructure; raw samples are not forced into test cases |
| Security | OWASP ZAP | target, scan profile, auth references, scope | alerts, risk/CWE/OWASP metadata, JSON/SARIF/HTML evidence, triage decisions | finding severity is separate from scan success; false-positive decisions are explicit and audited |
| Mobile | Appium 2 primary; Maestro compatibility adapter | app artifact, device/simulator, capabilities, flow, environment | per-step events, screenshots, video/logs, device metadata, JUnit/Allure-compatible results | device unavailable, app install failure, session loss, timeout, assertion failure, and infrastructure failure are distinct |

Accessibility is a first-class browser policy and adapter capability, not a hidden sixth product. The canonical persisted domain name is `performance`; `load` is accepted only as a compatibility/request alias and normalized at the API edge. A domain is `ready` only when its declared engine is installed, its adapter contract test passes, and a real run has been observed.

## 5. The five cross-cutting value layers

| Layer | Deep module and responsibility | Product outcome |
|---|---|---|
| 1. Control plane | Projects, environments, releases, automation inventory, schedules, jobs, attempts, leases, runners, quotas, idempotency | One reliable place to request and operate every test |
| 2. Execution and evidence | Tool adapter interface, OCI/process execution, event ingestion, normalization, artifact storage, durable outbox/replay | Every result is traceable to real evidence |
| 3. Intelligence | Ollama/Kilo gateway, model catalog, generation, triage, RCA, flaky analysis, test-data and report tools | AI explains and accelerates work without becoming the source of truth |
| 4. Experience and connectivity | Web dashboard, CLI, REST API, SSE, CI triggers, GitHub/GitLab, Jira, Slack, webhooks, exports | People and systems can act on the same run state |
| 5. Trust and operations | Sessions, service/runner credentials, vault, audit, policy gates, observability, backup/restore, packaging, upgrade/rollback | The product is operable, recoverable, and safe for a self-hosted installation |

### Current 5 × 5 matrix

| Domain | L1 execution | L2 evidence | L3 orchestration | L4 intelligence | L5 governance/reporting |
|---|---|---|---|---|---|
| Browser/Playwright | partial host-process adapter | partial and lossy | partial queue; worker handler missing | missing (501) | partial gate/readiness/dashboard |
| API/Bruno | missing | missing | missing | missing | missing |
| Performance/k6 | missing | missing | missing | missing | missing |
| Security/ZAP | missing | missing | missing | missing | missing |
| Mobile/Appium | missing | missing | missing | missing | missing |

The first implementation priority is the shared spine, not the fifth column of the matrix. Do not add another domain provider until run identity, worker dispatch, evidence persistence, and artifact retrieval are real.

## 6. Target runtime and data flow

```text
Web / CLI / CI / webhook
          |
          v
Authenticated Automate API (Hono modular monolith)
          |
          | validate canonical contract + policy
          v
PostgreSQL transaction: run + job + outbox event
          |
          v
Worker: schedules, lease claims, recovery, normalization
          |
          v
Runner fleet: capability match -> isolated adapter -> artifacts/events
          |
          v
Evidence store: raw bytes + checksums + canonical projection
          |
          +--> AI analysis (Ollama default; Kilo optional)
          +--> quality gate / release readiness
          +--> durable outbox -> authenticated SSE/read models
          +--> connectors and notifications
```

### Runtime modules

- `apps/api`: authenticated HTTP interface, composition root, request validation, policy evaluation, read models, and admin/audit operations. It must never execute customer test code.
- `apps/worker`: PostgreSQL-backed scheduler, lease reaper, outbox consumer, normalization coordinator, and retry policy. It owns no provider credentials.
- `apps/runner`: independently startable agent with enrollment, short-lived credential, capability manifest, lease protocol, durable offline event spool, adapter selection, cancellation, and artifact upload.
- `apps/web`: React/TanStack Router product experience consuming only shared contracts and authenticated read APIs.
- `apps/cli`: a thin Automate CLI for `run`, `test`, `schedule`, `connect`, `doctor`, `replay`, `export`, and `backup` operations; it must use the public API and never the database directly.
- `packages/shared-contracts`: the only public wire vocabulary.
- `packages/db`: PostgreSQL schema, additive migrations, repositories, outbox/read models, and transaction-safe lease operations.
- `packages/reporting`, `packages/orchestration`, `packages/automation`, `packages/realtime`, `packages/auth`, and `packages/connectors`: framework-neutral domain logic behind narrow interfaces.
- `runners/*` and `infra/docker/*`: digest-pinned, non-root, resource-limited tool images kept separate from API and web images.

Do not add Redis, Kafka, Kubernetes, Helm, a second orchestrator, or a general workflow engine to the initial self-hosted product. PostgreSQL provides the durable queue and outbox; a later scale measurement can justify a different adapter without changing the domain interface.

## 7. Canonical data and contract decisions

### Versioning

- Define the new canonical run/event wire contract as `automate.run@2` (or an explicitly versioned equivalent) rather than silently changing the meaning of the current runner protocol.
- Keep `legacy-flat-v1` as a time-boxed reporter decoder and keep the runner protocol version independent.
- Version every tool adapter, connector, event envelope, export, and policy. Reject unknown incompatible versions with an explicit error.
- Use internal UUIDs for relational identity and a unique workspace-scoped external ID for reporter/source identity.

### Canonical evidence hierarchy

Persist and expose:

```text
Run
└── Check / Test
    └── Attempt
        └── Step
            ├── Evidence
            └── Artifact reference
```

Each run/check/attempt records producer, framework, adapter/schema version, tool version, image digest, OS/architecture, branch/commit, environment, effective configuration hash, runner identity, timestamps, and status dimensions. Evidence records include digest, source, trust/proof state, completeness, and reason codes.

Required policy dimensions:

```text
proof:       proven | unproven | inconclusive | contradictory | unavailable | stale
completeness: complete | partial | unknown | rejected
```

A missing required check, malformed report, unsupported format, stale evidence, or unavailable domain cannot produce a green release decision.

### Durable state rules

- Use PostgreSQL as the source of truth for runs, jobs, attempts, leases, runners, schedules, events, policies, gates, AI tool runs, connectors, and audit.
- Use MinIO/S3-compatible storage for artifact bytes; PostgreSQL stores only metadata, checksums, ownership, and retention.
- Create a run and its first job in one transaction. Require an idempotency key in production.
- Claim jobs with `FOR UPDATE SKIP LOCKED` or an equivalently tested atomic transaction; use fencing tokens and lease renewal.
- Make terminal transitions monotonic. Duplicate or stale events are acknowledged without double-applying counters.
- Publish only committed, redacted canonical events. Use a durable outbox and cursor-based replay for SSE; reconnecting clients refetch the affected run when a cursor gap occurs.
- Keep in-memory adapters for tests only. Production startup must reject missing PostgreSQL, vault, cookie, artifact, and runner configuration.
- Apply forward migrations only. Preserve legacy columns/tables and raw artifacts through a compatibility window; remove them only after zero-consumer evidence and an approved destructive migration.

## 8. Five cumulative release gates

Each release is a gate. A later release is blocked if the earlier gate is not reproducible from a clean checkout.

### Automate v1 — Truthful Core

**Goal:** one fully durable, observable browser run with no fake product claims.

1. Freeze the current dirty tree, record the baseline, and create focused implementation branches without resetting or stashing user work.
2. Make `automate.run@2`, one runner protocol, the legacy reporter decoder, quality policy, artifact, and integration-maturity schemas canonical in `packages/shared-contracts`; collapse the three existing contract generations behind that authority.
3. Add additive PostgreSQL migrations for execution, evidence, outbox, projects, environments, releases, policies, audit, and artifact metadata. Backfill conservative phase/outcome mappings; leave unknown provenance unknown.
4. Collapse the split-brain API: choose one canonical run repository/read model and one `/api/v1/runs` contract; stop merging canonical and legacy stores, and keep legacy reporter routes only as bounded ingestion adapters.
5. Fix identity at the seam: generate UUIDs for internal rows, preserve reporter/source values as workspace-scoped external IDs, and reject any repository that writes arbitrary strings into the UUID primary key.
6. Replace route-local schemas and duplicate web/API types with shared-contract imports. Replace the lossy canonical/reporter projections with the full `Run → Check → Attempt → Step → Evidence/Artifact` model.
7. Make the API composition root select durable PostgreSQL, object storage, durable outbox/SSE, and durable auth in production. Keep development fakes explicit and test-only; do not mount the legacy runner protocol in production.
8. Wire a real worker execution handler to the durable job store and the canonical runner dispatch. A worker that only reaps leases and never executes a job is not ready.
9. Add authenticated CRUD and capability negotiation for projects, environments, and releases. The dashboard must not require manually seeded IDs, and `/api/v1/features` must report real readiness per domain and layer.
10. Complete session revocation, installation/service/runner credential separation, vault references, artifact path safety, upload limits, and authenticated downloads.
11. Implement the run lifecycle: enqueue, idempotency, cancel, retry, lease expiry, runner loss, partial evidence, deterministic quality gate, and cursor/`Last-Event-ID` replay.
12. Select one canonical Compose topology containing migration, PostgreSQL, MinIO, API, web, worker, runner, health checks, and one-click startup. Make the divergent file a compatibility/generated artifact, and keep tool images separate.
13. Consolidate the web route tree around Command Center, Runs, Run Detail, Analytics, Login, and Settings; remove visible links to unreachable or placeholder surfaces.

**v1 gate:** a clean local install can migrate, authenticate, enqueue a real Playwright run, execute it through the worker/runner path, stream durable events, inspect normalized evidence and artifacts, cancel/retry, recover a lost lease, and evaluate a release policy. No production path uses an in-memory store or the dead legacy runner protocol.

### Automate v2 — Five-Domain Execution

**Goal:** all five QA domains execute through the same control plane.

1. Add a small `packages/tool-sdk` interface with `supports`, `validate`, `prepare`, `execute`, `cancel`, and `collectArtifacts`; keep tool-specific code in adapters.
2. Add an execution-provider interface with a rootless OCI adapter and an explicitly allowlisted process adapter. The API never receives a host runtime socket or customer command.
3. Add capability manifests, tool/version/image digest checks, resource limits, network policy, deadline enforcement, cancellation escalation, ephemeral workspace cleanup, and TLS-protected remote-runner transport.
4. Implement and pin the Playwright, Bruno, k6, ZAP, and Appium adapter images under `runners/`; retain JUnit/Playwright JSON as ingestion adapters.
5. Add Bruno collection generation/import and sanitized request/response normalization.
6. Add k6 JSONL/OTel ingestion and threshold evaluation without inventing test retries from metric samples.
7. Add ZAP JSON/SARIF ingestion, risk/CWE projection, and explicit AI/manual triage state.
8. Add Appium device/session lifecycle, device capability discovery, app install/reset, screenshots/logs/video, and a remote-device adapter. iOS jobs require a macOS-capable runner and are otherwise `not_configured`, never passed.
9. Add durable runner event spooling and replay for disconnected runners, monotonic sequence handling, and terminal completion idempotency.
10. Add runner and worker views for enrollment, capabilities, health, leases, slots, queue latency, starvation, and cancellation.

**v2 gate:** every domain has a real pass fixture, failure fixture, cancellation path, timeout path, retry/recovery path, native evidence, and authenticated artifact retrieval. A missing device or image blocks that domain explicitly. At least one local and one remote runner path are contract-tested; if no second host is available, the two-runner protocol test remains mandatory before release.

### Automate v3 — Intelligence and Automation

**Goal:** AI accelerates and explains work while remaining auditable and subordinate to evidence.

1. Implement the `AiGateway` interface with Ollama as the local default and Kilo Gateway as an optional configured provider. Load model catalogs dynamically; never hard-code a provider/model list.
2. Persist model profiles, conversations, messages, tool calls, tool results, prompts/response digests, provider metadata, token/cost estimates, cancellation, and failure reasons. Never persist or log raw secret values.
3. Add an allowlisted tool loop with maximum steps, deadlines, cancellation, schema validation, approval state, and durable tool-run records.
4. Implement cross-domain generation: requirement/spec to browser, API, load, security, and mobile test plans; generated artifacts remain drafts until parsed/validated and explicitly accepted.
5. Implement the product AI modules: Bug Polisher, Test Analyzer, Test Summary, API Designer, Logic Auditor, STR Master, Test Data Generator, and UI Inspector. Every output is linked to its source evidence and can be exported without becoming an untracked system of record.
6. Add failure triage, flaky clustering, duration anomaly explanation, security false-positive review, and release narrative generation with explicit uncertainty and citations.
7. Add provider health, timeout, rate-limit, cancellation, offline fallback, and redaction tests. A provider outage must leave the run and evidence usable without an AI narrative.

**v3 gate:** Ollama and Kilo contract tests pass with mocked transport and real configured smoke tests; generated artifacts are syntax/schema validated; tool calls are bounded and audited; no credential or prompt secret can enter logs, events, artifacts, or UI payloads; a provider outage fails closed without changing a test outcome.

### Automate v4 — Connected Operations

**Goal:** Automate participates in the team’s delivery lifecycle without becoming a second source of truth.

1. Complete automation inventory, cron/timezone schedules, blackout/misfire policies, quotas, priorities, and policy-aware release triggers.
2. Add GitHub and GitLab webhook/signature verification, pull-request/merge-request triggers, commit metadata, status checks, and rerun commands.
3. Add Jira issue creation/update, Slack notifications/actions, generic signed webhooks, and outbound delivery logs. Keep connector credentials in the vault and make every operation idempotent.
4. Add connector retry/backoff, dead-letter handling, approval gates, artifact attachments, and audit events.
5. Add the CLI and public API for run creation, cancellation, retry, schedules, connector health, evidence export, replay, doctor, and backup status.
6. Add optional adapter/plugin discovery using the existing tool/connector manifests; reject unsigned or untrusted adapters from the production execution path.
7. Expand the web product to the complete route set: command center, runs, run detail, evidence, jobs, runners, schedules, policies, AI workspace, integrations, settings, audit, health, and backup/restore.
8. Add role-appropriate projections over one canonical model; do not create separate hard-coded dashboards per tool.

**v4 gate:** a signed CI event can create a run, a failed run can create/update a Jira item and Slack notification, a retry is idempotent, connector outage is visible and recoverable, and every action is auditable from the UI/API/CLI.

### Automate v5 — Product Hardening and Release

**Goal:** a clean, secure, recoverable self-hosted installation that can be called production-grade only with evidence.

1. Complete security hardening: threat model, dependency and image scanning, secret scanning, SSRF/target allowlists, path traversal protection, CSP/security headers, rate limits, secure cookies, constant-time credential checks, and least-privilege service accounts.
2. Finish S3/MinIO storage parity, retention/legal hold, signed downloads, artifact lifecycle cleanup, and storage reconciliation.
3. Add structured logs, metrics, traces, health/readiness, queue/runner dashboards, alerts, and redaction tests. Do not log prompts, tokens, raw credentials, or unrestricted artifact bodies.
4. Add native PostgreSQL and object-store backup, restore rehearsal, migration checkpoints, checksum reconciliation, and documented rollback. `migrate:apply` remains blocked until resumable waves and restore evidence exist.
5. Add performance budgets for API latency, dashboard load, run start, event freshness, artifact transfer, and queue behavior. Measure before introducing any additional infrastructure.
6. Add accessibility, keyboard, screen-reader, contrast, focus, empty/error/loading, and responsive checks to every visible route.
7. Pin runtime/tool images by digest, generate SBOMs, sign/verify release artifacts, and add upgrade/rollback scripts for the single-host topology.
8. Rewrite the capability register, README, deployment guide, API/CLI references, recovery runbook, and product naming around verified Automate behavior. Remove all stale legacy-brand and readiness claims.
9. Add a clean-checkout rehearsal, migration rehearsal, full E2E suite, domain smoke suite, security suite, performance suite, and release checklist.

**v5 gate:** a new operator can install from a clean checkout, configure secrets, start the full stack, run all five domains, inspect evidence, recover from runner/API/storage failure, restore a backup, upgrade and roll back, and pass every validation command with no mock in the product path.

## 9. Implementation workstreams and file ownership

| Workstream | Primary boundaries | Required outcome |
|---|---|---|
| Spine collapse | `apps/api/src/routes`, `apps/api/src/index.ts`, `apps/worker/src/main.ts`, `packages/runner-sdk` | One run store, one runner protocol, one worker dispatch, no legacy/canonical split brain |
| Contract authority | `packages/shared-contracts`, `packages/reporter`, `packages/realtime` | One versioned vocabulary, legacy decoder, fixture matrix |
| Persistence | `packages/db`, `packages/db/drizzle`, `apps/worker` | Durable queue, evidence hierarchy, outbox, read models, migrations |
| API composition | `apps/api/src/index.ts`, `bootstrap`, `http`, routes, middleware | Production-only durable composition and authenticated versioned routes |
| Runner/execution | `apps/runner`, `packages/runner-sdk`, new `packages/tool-sdk`, `runners/*` | Enrollment, leases, cancellation, spool, OCI/process adapters |
| Reporting/KPIs | `packages/reporting`, API read models, web feature modules | Pass/final/flake, duration, queue, utilization, cost, completeness, proof |
| AI | `packages/automation`, API AI modules, AI schemas/repositories | Ollama/Kilo gateway, bounded tool loop, durable conversations/tool runs |
| UX | `apps/web`, `packages/ui`, route manifest, accessibility tests | Complete product cockpit and deep run/evidence drill-through |
| Connectivity | `packages/connectors`, API integration routes, CLI, CI adapters | Signed, retrying, auditable GitHub/GitLab/Jira/Slack/webhook flows |
| Operations | `infra/compose`, `infra/docker`, `.env.example`, CI, runbooks | Single-host deployment, remote runner enrollment, backup/restore, observability |
| Quality | `tests/contract`, `tests/integration`, `e2e`, package tests | Real-domain acceptance, failure injection, security, performance, recovery |

Keep framework-neutral policy and state logic in packages. Adapters belong at seams; avoid adding a new microservice or generic abstraction for a single implementation.

## 10. Validation and measurable 10/10 gate

### Required root commands

Run from the repository root after implementation:

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contract
pnpm test:integration
pnpm test:runner
pnpm coverage:ratchet
pnpm build
pnpm db:check
pnpm security:verify
pnpm test:e2e
pnpm oci:verify
pnpm migrate:validate
pnpm migrate:verify
pnpm smoke:local
```

Do not treat cached output, stale `.last-run` files, or mock-only tests as evidence.

### Product acceptance matrix

| Area | Required evidence |
|---|---|
| Spine | canonical and legacy routes cannot return different run identities; UUID/external-ID mapping; worker executes a claimed job; dead runner protocol is unreachable |
| Contracts | every producer/consumer fixture, legacy mapping, version rejection, unknown-field behavior, deterministic ordering |
| Database | clean migration, prior-version migration, concurrent claims, lease expiry, idempotency, transaction rollback, outbox replay |
| Auth | installation bootstrap, session expiry/revocation, service/runner scopes, constant-time checks, secret redaction |
| Web/E2E | real pass/fail, steps, retries, screenshots/video/trace, cancellation, timeout, browser matrix |
| API | OpenAPI/collection generation/import, auth references, positive/negative/boundary assertions, sanitized responses |
| Performance | real k6 script, threshold pass/fail, metrics freshness, raw evidence, tool failure distinction |
| Security | real ZAP scan, JSON/SARIF, risk/CWE, triage, authenticated evidence, false-positive state |
| Mobile | device enrollment, app install, real flow, screenshots/logs, unavailable-device state, cancellation/reset |
| AI | Ollama/Kilo streaming, tool calls, cancellation, redaction, persisted run, provider outage, generated-artifact validation |
| UX | all visible routes reachable, keyboard/screen-reader behavior, live updates, no placeholder data, evidence downloads |
| Operations | clean install, migration-first startup, readiness, remote runner, backup/restore, upgrade/rollback, observability |

### Performance budgets

- Dashboard usable after reconnect: under 2 seconds for the initial local load.
- API read/write p95: under 300 ms for ordinary authenticated requests, excluding AI/tool execution.
- Live event freshness: under 2 seconds for a connected local runner.
- Playwright execution start: under 5 seconds after a valid claim.
- k6 metric visibility: under 5 seconds after the runner emits a sample batch.
- Artifact processing: bounded by configured byte/size limits and streamed rather than loaded without bound.
- Queue and runner behavior: no duplicate terminal completion, no lost lease, and bounded starvation under the documented quota policy.

### Definition of “100% operational”

A release earns the 10/10 claim only when:

1. All five domains have a real executable adapter and a passing acceptance scenario.
2. All five value layers have a production implementation, not a placeholder route.
3. The clean-install and recovery path passes on the supported host topology.
4. No product-visible success path depends on a mock, static response, in-memory production store, or unverified external capability.
5. Every visible capability has executable evidence and an updated capability-register status.
6. Security, accessibility, performance, backup/restore, migration, and rollback gates pass.
7. Missing optional infrastructure is reported as an explicit blocked/not-configured state, never as a pass.

## 11. Rollout, migration, and rollback

1. Record and preserve the current dirty tree; create a clean implementation branch/worktree without resetting or discarding user changes.
2. Apply additive schema migrations and dual-read compatibility only. Keep legacy reporter endpoints and old IDs during the observation window.
3. Run a sanitized migration rehearsal, backup/restore rehearsal, row/aggregate/checksum reconciliation, and application read checks.
4. Deploy API contracts and ingestion adapters before switching the web UI to canonical execution routes.
5. Start one isolated worker and runner, then remote runners, and run pass/failure/cancel/timeout/recovery smoke tests.
6. Switch CI and connectors only after the five-domain matrix passes.
7. Keep rollback available by stopping worker/runner processes and routing clients to the prior compatible UI/API. Never delete evidence, drop columns, or revoke source credentials as part of rollback.
8. Remove legacy code, tables, and documentation only after zero-consumer evidence, retention approval, and a separately approved destructive migration.

## 12. Risks and explicit boundaries

| Risk | Required response |
|---|---|
| OCI runtime is unavailable on the current host | Do not claim v2/v5; provide a verified runtime prerequisite and fail readiness until images can be built and run |
| iOS requires a macOS-capable device host | Advertise capability truthfully; block iOS jobs on unsupported hosts without synthetic results |
| k6 AGPL obligations | Keep k6 as an external/pinned execution image and complete license review before redistribution |
| Generated tests can inject code | Treat generated artifacts as untrusted drafts; parse/validate, review/approve, and execute only in isolated runners |
| External providers or connectors fail | Preserve evidence, show dependency failure, retry safely, and never rewrite the product outcome |
| Large traces/videos/reports | Enforce upload, storage, retention, and streaming limits at trust boundaries |
| Legacy IDs/statuses conflict | Keep one compatibility decoder and reject ambiguous mappings rather than guessing |
| Single-tenant blast radius | Use least privilege, local-only binding by default, secure secrets, audit, and remote-runner enrollment controls |

Explicitly out of scope for this self-hosted single-tenant release: hosted SaaS, multi-tenant isolation, user/RBAC/SSO administration, Tauri, Webwright, a second external orchestrator, Redis/Kafka/Kubernetes/Helm, arbitrary untrusted shell execution, and HTML scraping as a normalization path. These are safety or scope boundaries, not silently degraded product features; any future addition requires its own ADR and acceptance gate.

## 13. Resolved product decisions

- One monolithic Automate product, not five independent products.
- Five QA domains and five cross-cutting value layers in the same system.
- Self-hosted local deployment with optional remote runners.
- Single-tenant, secure installation model.
- Ollama local AI by default, Kilo Gateway optional.
- All available devices are supported through capability-aware runners; unavailable devices are explicit.
- English-only product and documentation.
- Automate is the only product name; all legacy naming is removed from the product surface.
- Full measurable gate; no compromises on evidence, security, recovery, or truthfulness.
