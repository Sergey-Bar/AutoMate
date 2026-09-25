# Unified Repository Migration Specification

## 1. Executive summary

The repository is already a partial pnpm/Turborepo consolidation, but it is not a reliable unified product. Structural cutover happened before behavioral parity, data compatibility, governance, and deployment convergence. The current tree contains real run ingestion and basic dashboard persistence alongside in-memory domain state, mock AI/agent endpoints, incompatible contracts, stale legacy files, and multiple conflicting deployment definitions.

This specification uses the current unified repository as the target base and ports proven behavior and data semantics from two pinned legacy sources. It does not merge repository roots, lockfiles, framework wiring, or generated artifacts.

### Authoritative baselines

| System | Immutable baseline | Provenance confidence |
|---|---|---|
| Unified target | `01cc19c8167e0e8365928862de463fd50caaee5c` plus the explicitly reviewed current working-tree changes | High for inspected files; working tree is dirty |
| AutoMate source | `https://github.com/Sergey-Bar/AutoMate.git` at `bce507ecc36e9f5cc33b3016741238b7fc834f0f` | High; exact commit inspected with `git show` |
| Automate-Dashboard source | `https://github.com/Sergey-Bar/Automate-Dashboard.git` at `b5a068538e433e09d816292852dba2a0a87acf22` | Commit existence confirmed; source not materialized in this plan-only session |
| QA-Doctor / Mjölnir reference | `https://github.com/Sergey-Bar/Mjolnir.git` at `d981ba356313ae8cea0538ca85c665e88b84c530`, clean local `main` | High; inspected as a read-only evidence/reporting reference, not a migration source |

A full untracked Dashboard candidate exists at `AutoMate/dashboard/`, but it identifies a different upstream and is not byte-verified. It is evidence for investigation only, not an authoritative migration input.

### Target outcome

A single-repository, single-tenant, workspace-ready **automation control plane** with:

- one React product dashboard and KPI experience;
- one stateless Hono control-plane API with explicit domain modules;
- one independently deployable runner agent that leases jobs and executes isolated OCI workloads;
- PostgreSQL as the transactional source of truth;
- S3-compatible artifact storage behind a port;
- Kilo Gateway as the dynamic AI provider/model catalog;
- temporary, versioned legacy reporter/API adapters;
- framework-independent business logic in a small number of deep workspace packages;
- one root toolchain and one executable governance command surface.

The unified repository is the only active development codebase. The pinned Dashboard baseline is the primary product/UX reference, not a repository to merge wholesale. AutoMate is frozen as a temporary extraction source and archived only after capability, data, consumer, and rollback gates pass.

## 2. Confirmed product decisions

1. **Tenancy:** one installation owns one tenant; `workspace_id` is explicit in domain data so multiple workspaces can be added later without redesigning identifiers.
2. **Runtime topology:** one control-plane monolith plus one separately deployable runner process. API, web, and runner are built from the monorepo, but the dashboard never executes customer automation code.
3. **Product:** a unified automation control plane, KPI dashboard, and pluggable runner for browser, API, performance, security, mobile, and arbitrary containerized tools.
4. **Repository authority:** develop only in the current unified repository. Use Dashboard as the UX reference and AutoMate as a frozen source archive.
5. **Scope:** core-first parity. A capability ships only when it works end to end with persistence, UI, contracts, runner behavior, and tests. Mock and half-wired surfaces are not parity.
6. **Identity:** installation-scoped credentials, revocable server-side sessions, scoped service credentials, and separately enrolled runner identities. Users, RBAC, SAML, and tenant administration are deferred.
7. **Run identity:** internal UUID plus unique workspace-scoped external run ID.
8. **Data cutover:** staged and reversible; no continuous dual-write.
9. **Artifacts:** S3-compatible object storage in hosted environments; filesystem adapter for local development.
10. **Reporter compatibility:** accept the legacy flat v1 protocol through a time-boxed adapter; new clients use the canonical contract.
11. **AI providers:** consume Kilo Gateway dynamically rather than embedding or freezing Kilo's provider catalog. Ollama remains an optional direct self-hosted adapter.
12. **Market composition:** Automate owns the canonical control plane, runner protocol, normalized evidence model, and product dashboard. External repositories are standards, tool engines, optional execution backends, or design references—not competing systems of record.

## 3. Current-state assessment

### 3.1 What is already unified

- The root workspace is an active pnpm/Turborepo monorepo: `pnpm-workspace.yaml:1-5`, `package.json:7-21`, and `turbo.json:2-21`.
- The current application shells are Hono API and React web: `apps/api/src/index.ts:58-113` and `apps/web/src/router.ts:2-63`.
- Reporter lifecycle ingestion, run/test normalization, basic run persistence, run listing, quarantine, quality gates, and SSE exist.
- The current PostgreSQL schema is the only safe target migration authority. It already adapts the source model to PostgreSQL: `packages/db/src/schema/dashboard.ts:1-8`.
- The current root has one lockfile and exact `pnpm@10.30.2`, which should win over both source lockfiles: `package.json:6`.

### 3.2 Material gaps and contradictions

- The ADR calls for a modular Hono/Effect platform, but the API is manually composed and most other domains are in-memory: `docs/architecture/unified-platform.md:9-33`, `apps/api/src/index.ts:34-111`.
- `shared-contracts` has no first-party consumer. API and web maintain local, incompatible schemas.
- Reporter, realtime, auth, and web symbols have multiple definitions.
- Conversations, messages, model configuration, connectors, vault state, and agent sessions are not durably wired to the target database.
- AI chat and test generation are deterministic mocks rather than provider-backed behavior: `apps/api/src/modules/orchestrator/chat.ts`, `apps/api/src/modules/orchestrator/test-gen.ts`, and `apps/api/src/modules/agents/`.
- The target assumes UUID run IDs while the API and source reporter accept arbitrary strings: `packages/db/src/schema/dashboard.ts:27-30,74-80,89-94` versus `apps/api/src/routes/reporter.ts` and the provisional Dashboard reporter.
- The migration tool is a prototype row copier. It lacks source-engine adapters, durable checkpoints, transactions across waves, target catalog validation, reconciliation, artifact transfer, vault conversion, and rollback: `tools/migrate-cli/src/migrate.ts:223-278,319-374`.
- Production config is read in two places and directly bypasses the config facade: `apps/api/src/config.ts:15-27`, `apps/api/src/index.ts:34-55,80-111`.
- The tracked router depends on ignored local `routes/automate/**` files because `.gitignore:34-37` unintentionally matches `automate` paths on case-insensitive filesystems.
- Current Compose, nginx, CI, environment, and documentation files describe different systems.

### 3.3 Source parity summary

| Capability | Current state | Core-first disposition |
|---|---|---|
| Reporter lifecycle and run/test persistence | Real but contract-drifting | Restore and make canonical |
| Run detail, quarantine, basic analytics, quality gates | Partially real | Complete, persist, and verify |
| Browser live updates | Process-local SSE | Preserve SSE, add durable outbox/cursor |
| Binary artifacts and reports | Missing end to end | Build against object storage |
| Installation login | Dirty, signed boolean cookie | Replace with revocable sessions |
| Source API keys/RBAC/SAML | Schema exists, behavior not migrated | Defer and exclude from launch |
| Model-backed chat | Mock | Restore with dynamic Kilo catalog |
| Provider adapters | Four in-memory model values | Replace with gateway/provider ports |
| GitHub/Jira/Slack connectors | Missing | Restore core outbound connectors |
| MCP | Missing/unwired in target and inconsistent in source | Defer behind a new ADR |
| Scheduling and inventory | Missing | Required control-plane core |
| Runner fleet, leases, capacity, offline reconnect | Missing | Required control-plane core |
| Playwright, k6, ZAP, Appium adapter policy | Partial/missing | First Playwright/k6/ZAP are required; Appium follows only after device lifecycle is proven |
| Advanced prediction, clustering, visual baselines | Mock, unwired, or missing | Defer |
| Webwright | Three incompatible contracts | Remove from launch; preserve history |
| Tauri desktop | Empty source shell | Do not migrate |
| i18n/RTL | Present in provisional source, absent in target | Defer |

### 3.4 Repository disposition

| Repository | Future state | Permitted use during migration |
|---|---|---|
| Current unified Automate | Sole active development repository and release source | Implement all approved product behavior, runner, dashboard, governance, and deployment |
| Automate-Dashboard | Primary UX/product reference and legacy data/protocol source | Port verified behavior and data semantics; do not merge its legacy server/migration architecture or continue feature development there |
| AutoMate | Frozen extraction source and temporary rollback archive | Preserve unique runner, protocol, connector, validation, and automation semantics until explicitly ported/replaced; then archive/delete after zero-consumer gates |
| QA-Doctor / Mjölnir | Read-only evidence/trust/ingestion reference | Copy or adapt approved ideas with tests; do not import its static-report CLI as the product architecture or track its generated artifacts |

## 4. Target repository architecture

### 4.1 Directory hierarchy

```text
.
├── apps/
│   ├── api/                  # control-plane API and scheduler
│   │   └── src/
│   │       ├── bootstrap/     # Effect config, dependency graph, lifecycle
│   │       ├── http/          # Hono routes, middleware, HTTP DTO mapping
│   │       ├── infrastructure/# OCI/storage/Kilo/connector adapters
│   │       ├── workers/       # outbox, scheduling, reconciliation workers
│   │       └── composition.ts # only cross-domain wiring entry point
│   ├── web/                  # product dashboard, run explorer, KPIs
│   │   └── src/
│   │       ├── app/           # router, providers, global layout
│   │       ├── features/      # runs, jobs, runners, automation, settings
│   │       ├── pages/         # thin route adapters only
│   │       └── shared/        # app-local UI helpers
│   └── runner/               # independently deployable execution agent
│       └── src/
│           ├── enrollment/   # scoped identity and capability registration
│           ├── lease/         # job acquisition, renewal, completion
│           ├── execution/     # process/OCI adapter and hard deadlines
│           ├── spool/         # encrypted durable offline event queue
│           ├── protocol/      # runner wire client
│           └── main.ts
├── packages/
│   ├── shared-contracts/      # jobs, leases, runs, events, artifacts
│   ├── config/                # typed environment schema
│   ├── auth/                  # control-plane, service, and runner identity
│   ├── db/                    # schema, migrations, repositories
│   ├── realtime/              # durable event transport and replay
│   ├── orchestration/         # inventory, schedules, jobs, leases, capacity
│   ├── reporting/             # run/check/attempt/step/evidence/KPI rules
│   ├── automation/            # conversation/model/tool-loop rules
│   ├── runner-sdk/            # agent lifecycle and event client
│   ├── tool-sdk/              # tool adapter manifest and execution context
│   ├── connectors/
│   │   ├── sdk/               # manifest, lifecycle, timeout/error contract
│   │   ├── github/
│   │   ├── jira/
│   │   └── slack/
│   ├── reporter/              # publishable Playwright reporter
│   └── ui/                    # React/Tailwind primitives with real consumers
├── runners/                   # pinned OCI images, not long-lived services
│   ├── generic/
│   ├── playwright/
│   ├── k6/
│   ├── zap/
│   └── appium/
├── tools/
│   └── migrate-cli/           # offline source inspection/import/verification
├── tests/
│   ├── contract/                 # producer/consumer and legacy-adapter fixtures
│   ├── integration/              # PostgreSQL, object-store, auth, connector tests
│   ├── e2e/                      # one Playwright authority
│   ├── performance/              # isolated k6 scenarios
│   └── fixtures/                 # sanitized source and migration fixtures
├── infra/
│   ├── compose/                  # one dev and one production topology
│   ├── docker/                   # API, web, runner, migration images
│   ├── nginx/                    # SPA and edge-proxy configuration
│   └── observability/            # structured logs/metrics configuration
├── docs/
│   ├── adr/
│   ├── architecture/
│   ├── migration/
│   └── runbooks/
├── .devcontainer/
├── .github/
├── .prettierignore
├── .prettierrc
├── eslint.config.js
├── tsconfig.base.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── turbo.json
└── package.json
```

Do not create empty `services/`, Kubernetes, Helm, Terraform, or microservice directories. A future isolated runtime earns a new ADR and, if justified, a `services/<name>/` boundary.

Set the pnpm workspace globs explicitly to `apps/*`, `packages/*`, `packages/connectors/*`, `tools/*`, and the retained E2E package. Do not rely on the current `packages/*` glob to discover nested connector packages.

### 4.2 Dependency direction

Enforce these rules with root ESLint `no-restricted-imports` patterns and Turbo's dependency graph:

1. `shared-contracts` may import Zod and standard library only.
2. `config` owns environment parsing and may expose typed, immutable configuration; it must not import application modules.
3. `orchestration` owns inventory, schedules, jobs, leases, capacity, idempotency, and retry policy. It must not import a concrete OCI runtime, Hono, React, or provider SDK.
4. `reporting` owns run/check/attempt/step/evidence/artifact and KPI rules. It must not import a concrete database, HTTP framework, or chart library.
5. `automation` owns conversation/model/tool-loop rules and must not import Kilo, connector, database, or HTTP implementations.
6. `db` implements persistence ports and may import domain types; domain packages never import `db`.
7. `auth` owns control-plane, service, and runner identity rules. HTTP middleware remains in `apps/api/src/http`.
8. `realtime` owns transport/replay behavior. Durable payload schemas remain in `shared-contracts`.
9. `apps/api` is the only application allowed to compose orchestration, reporting, AI, and infrastructure adapters into the control plane.
10. `apps/runner` may use `runner-sdk`, `shared-contracts`, `config`, and approved execution adapters. It must never import `db`, control-plane domain internals, or provider credentials from the API database.
11. `tool-sdk` contains only adapter contracts, capability manifests, normalized progress, and cancellation tokens. Tool-specific images must not import the web app or control-plane persistence.
12. `apps/web` may import contracts, auth session DTOs, realtime client schemas, and UI; it must not import API, DB, runner, connector, or migration internals.
13. `reporter` may import contracts only. It must not import the API, DB, or web application.
14. Connectors receive credentials through a narrow secret-provider port and may not import API routes, vault storage, or persistence implementations.
15. Cross-domain reads use explicit application ports or purpose-built read models, not direct table access from another domain.

### 4.3 Runtime and scaling model

The product has three deployable artifacts from one repository:

1. `api`: stateless control plane and scheduler;
2. `web`: product dashboard and KPI explorer;
3. `runner`: independently scalable execution agent.

Operational rules:

- The API and web tiers never execute customer automation code.
- The API is stateless behind the edge proxy and can run multiple instances.
- PostgreSQL is the transactional source of truth and durable job queue.
- Replace process-local scheduling and event state with transactional leases/outbox tables.
- Schedules create immutable job definitions; job state transitions are compare-and-set and idempotent.
- A runner enrolls with a one-time token, receives a scoped identity, advertises capabilities/tool versions/platform/capacity, and renews heartbeats.
- A job is leased with a deadline; the runner renews the lease while executing and must durably spool unsent terminal events/artifacts while disconnected.
- Reconnect replays events by monotonic sequence. Duplicate events are harmless and terminal state cannot be overwritten.
- A runner never receives the host-wide Docker socket, control-plane database credentials, or long-lived provider keys. Local rootless Podman may expose only the runner account's restricted provider socket.
- Heavy/dependency-sensitive tools execute in a one-job/one-OCI workload. Images are pinned by digest, run non-root, receive CPU/memory/time/network limits, and mount only read-only inputs plus private writable output.
- Lightweight approved tools may use a process executor, but arbitrary shell is opt-in and subject to explicit allowlists and the same hard deadline.
- Cancellation is layered: native tool cancel where available, then `SIGTERM`/grace, then hard kill. Partial reports and artifacts are retained and marked incomplete.
- Local development uses rootless OCI execution; a hosted deployment may implement the same execution port with Kubernetes Jobs. Do not hard-code either provider in domain code.
- S3-compatible object storage holds artifacts. PostgreSQL stores metadata, digests, ownership, and retention.
- Do not add Redis, Kafka, Kubernetes, or a general workflow engine until measured scale or a concrete requirement requires one.

### 4.4 Runner and tool contracts

A job envelope is immutable after lease and contains:

```text
jobId
workspaceId
automationId
tool
toolVersion
imageDigest
requiredCapabilities
input
environment
timeout
retryPolicy
secretReferences
artifactPolicy
idempotencyKey
```

Rules:

- `imageDigest` is mandatory for OCI jobs; mutable tags are discovery metadata only.
- `secretReferences` are resolved just in time and are not included in events, job logs, command lines, or spool metadata.
- A successful tool process is not automatically a successful run; the adapter must emit a normalized terminal result and artifact manifest.
- Lease ownership carries a fencing token. Every progress/terminal event includes job ID, lease ID, fencing token, attempt number, and monotonic sequence.
- Terminal state is monotonic: success, failed, cancelled, timed-out, incomplete, and infrastructure-failed cannot overwrite one another after the first accepted terminal transition.
- Retries create a new job attempt with a stable parent execution ID; they do not mutate historical attempts.

Canonical runner lifecycle:

```text
new -> enrolled -> online -> draining -> offline -> revoked
```

Canonical job lifecycle:

```text
queued -> leased -> running -> cancelling -> terminal
                    \-> expired/requeued
```

Canonical tool adapter contract:

```text
supports(capabilities)
validate(input)
prepare(job)
execute(context)
cancel(context)
collectArtifacts()
```

`context` exposes progress, cancellation, deadlines, bounded secret resolution, and an artifact directory. Adapters never receive control-plane database access.

## 5. Canonical data model

### 5.1 PostgreSQL schemas

Use logical schemas to make ownership explicit:

| Schema | Owner | Core tables |
|---|---|---|
| `identity` | auth | `installation_keys`, `sessions`, `service_credentials`, `runner_identities` |
| `orchestration` | orchestration | `automation_inventory`, `schedules`, `jobs`, `job_leases`, `runner_instances`, `runner_capabilities` |
| `reporting` | reporting | `workspaces`, `runs`, `checks`, `attempts`, `steps`, `evidence`, `artifacts`, `quarantine`, `quality_gates`, KPI/read models |
| `automation` | automation | `conversations`, `messages`, `model_profiles`, `flow_templates`, `tool_runs` |
| `integrations` | connectors | `connectors`, `connector_configs`, `vault_entries` |
| `audit` | auth/audit | `audit_events` |
| `system` | platform | `outbox_events`, `legacy_id_map`, `migration_runs`, `schema_migrations` |

Apply the existing PostgreSQL baseline first; move or recreate tables with new forward migrations. Never edit already-applied migration history.

### 5.2 Run identity

Use dual identifiers:

```text
workspaces.id          uuid primary key
workspaces.external_id text unique
runs.id               uuid primary key
runs.workspace_id     uuid not null
runs.external_id      text not null
unique(workspace_id, external_id)
```

- `id` is used by internal foreign keys.
- Workspace and run `external_id` values preserve source identifiers, artifact paths, bookmarks, and v1 API behavior.
- Maintain a reversible `system.legacy_id_map` for every translated run/workspace/user reference.
- v1 reporter requests accept `external_id`; v1 responses continue returning the familiar run identifier until clients are migrated.
- Reject duplicate external IDs within a workspace rather than overwriting another run.

### 5.3 Canonical execution evidence

Use one explicit hierarchy for every tool:

```text
Run
└── Check / Test
    └── Attempt
        └── Step
            ├── Evidence
            └── Artifact reference
```

- `checks` are logical test definitions with stable identity, kind, suite, project, requiredness, producer, and source location.
- `attempts` preserve every producer-declared retry; `(check_id, attempt_index)` is unique inside a run.
- `steps` are recursive and ordered by ordinal plus stable ID. They own status, category, timing, error reference, and artifact links.
- `evidence` may attach to a run, check, attempt, or step and records producer, schema, digest, trust strength, and proof state.
- Keep execution status, severity, evidence strength, proof state, and final quality-gate outcome as separate dimensions.
- Derive `firstPass`, `finalStatus`, and `passedOnRetry` from ordered attempts. A fail-then-pass sequence is run-local retry recovery, not proof of historical flakiness.
- When a producer exposes only one final result, retry observability is `unknown`; never infer retries from duplicate IDs or report shards.
- Historical flakiness is computed only across comparable runs with compatible tool, environment, branch, and policy provenance.

Required evidence policy states:

```text
proof:      proven | unproven | inconclusive | contradictory | unavailable | stale
completeness: complete | partial | unknown | rejected
```

Every run records:

```text
expected checks
discovered checks
ingested checks
rejected checks
unsupported checks
missing required checks
reason codes
```

A missing, malformed, unsupported, or incomplete required check cannot silently become `passed` or `skipped`. A partial or unknown required scope is a non-pass policy state.

Version trust ceilings in policy rather than hard-coding them in adapters:

- unavailable/corrupt runtime evidence cannot exceed the configured low-trust ceiling;
- missing runtime corroboration cannot appear fully proven;
- partial runtime evidence caps trust;
- advisory evidence is reported but never gating;
- incomplete required scope cannot yield a 100%-proven run.

Bind structured toolchain provenance to runs, source artifacts, adapters, and attempts:

```text
tool name/version
adapter name/version/schema
package or binary digest
OCI image digest
runtime/OS/architecture
runner identity
command and effective-config hashes
```

### 5.4 KPI calculation contract

Every KPI stores or can derive:

```text
metric version
population/window
numerator
denominator
included/excluded run IDs by reason
dimensions
data freshness
completeness/proof ceiling
```

Rules:

- `firstPassRate` uses first-attempt outcomes; `finalPassRate` uses final run outcome.
- Historical flake requires multiple comparable runs and observed different first-attempt/final outcomes; missing retry detail remains unknown.
- Duration percentiles use explicit run/step timers and do not mix queue time with execution time.
- Runner utilization uses leased time over available runner capacity; idle/online/draining states remain distinguishable.
- Tool success is separate from test pass and infrastructure failure.
- Cost is tool version/runner duration-derived estimate or measured charge, with source and confidence.
- Incomplete, rejected, unsupported, stale, or unproven populations are never silently removed from a denominator.

### 5.5 Identity and secrets

- Bootstrap from `AUTOMATE_API_KEY` only on first initialization.
- Store high-entropy installation/service credentials as keyed hashes; compare using constant-time logic.
- Store only hashes of random session tokens. Sessions have expiry, revocation, last-use metadata, and an audit event.
- Enroll runners with one-time tokens, then issue scoped, rotatable identities bound to declared capabilities and allowed environments.
- Runner credentials authorize protocol operations only; job-scoped secrets are short-lived references delivered just in time and never persisted in runner logs.
- Keep `VAULT_SECRET` as the encryption key boundary. Re-encrypt migrated credentials into the target envelope format; never copy source ciphertext blindly.
- Remove user/RBAC/SAML semantics from launch code. Leave old tables dormant until a separately approved destructive migration after data review.

### 5.6 AI configuration and provider catalog

- Define an `AiGateway` port; do not compile provider/model IDs into source.
- Implement `KiloGatewayAdapter` against Kilo's OpenAI-compatible API and dynamically load `/models`; cache catalog metadata briefly and refresh on demand.
- Default configuration uses `KILO_GATEWAY_URL`, `KILO_API_KEY`, and `KILO_MODEL`.
- Store per-workspace model profiles as provider/gateway, model ID, generation parameters, and a vault secret reference.
- Keep `OllamaAdapter` optional for self-hosted operation.
- Tool execution uses an allowlisted registry, maximum steps, deadlines, and persisted tool-run records.
- Never log prompts containing credentials, raw vault values, or provider authorization headers.

Reference: Kilo Gateway documents an OpenAI-compatible endpoint and live model catalog at `https://kilo.ai/docs/gateway` and `https://kilo.ai/docs/gateway/models-and-providers`.

### 5.7 Artifact contract

- `reporting.artifacts` stores logical metadata, never an authoritative local path.
- Object key format: `workspaces/<workspace-id>/runs/<internal-run-id>/<artifact-id>/<version>`.
- Store SHA-256, byte size, content type, creation time, producer, and retention class.
- Downloads use short-lived signed URLs or an authenticated API stream.
- Filesystem and S3 adapters implement the same port and pass the same contract tests.

## 6. Cross-repository conflict and dependency resolution

### 6.1 Namespace and ownership conflicts

| Conflict | Canonical resolution |
|---|---|
| All three roots are named `automate` | Keep only the unified root manifest/lockfile; source manifests are read-only inputs |
| Legacy `apps/web` collides with target `apps/web` | Port behavior into the target app; never overlay trees |
| Fastify source servers vs Hono target | Reimplement source use cases behind Hono routes; do not retain Fastify runtime |
| `@automate/shared`, `@automate/dashboard-shared`, and `@automate/shared-contracts` | Keep `@automate/shared-contracts`; port and deduplicate schemas |
| `Permission` in auth and contracts | Contracts own wire values/types; auth consumes and re-exports only if needed |
| `ReporterEventSchema`/`RealtimeEventSchema` in API, realtime, and contracts | Contracts own event shape/version; realtime owns transport |
| Local web `RunSchema`, `TestSchema`, `MessageSchema` | Delete after web imports canonical contracts |
| Source reporter/CLI names | Restore `@automate/reporter`; keep `@automate/migrate-cli` separate; assess `@automate/cli` independently |
| `AUTOMATE_DASHBOARD_API_KEY` vs `AUTOMATE_API_KEY` | Deployment maps the old secret to `AUTOMATE_API_KEY`; do not expose both in app config |
| `SESSION_SECRET` vs `COOKIE_SECRET` | `COOKIE_SECRET` is canonical; time-boxed parser alias only |
| Source port 4000/4001 vs target 3000/SSE | Target ports/routes win; legacy reporter WS is adapter-only |
| Source SQLite migrations vs target PostgreSQL | Target Drizzle migrations win; source SQL is never executed |

### 6.2 Version conflicts

| Area | Conflicting state | Target |
|---|---|---|
| Node | Root says `>=22.0.0`, but locked packages require newer Node 22 minors | `.nvmrc` `22.19.0`; engines `>=22.19.0 <23` |
| pnpm | Source 10.6.5, source docs 9, target 10.30.2 | Exactly `pnpm@10.30.2` in root, CI, Docker, docs |
| TypeScript | Repeated `~5.9`, `^5.9.0`, `^5.9.3` | One catalog entry, `~5.9.3` |
| Zod | Dashboard source v3; target v4 | Port source schemas to Zod 4; no dual runtime |
| React | React 19 in all useful sources | One React 19 resolution; upgrade `lucide-react` to a React-19-compatible release |
| Vite | Source 7; target lock override 6.4.3 | Keep 6.4.3 during migration; upgrade separately only if a required feature demands it |
| Drizzle | Target package drift around 0.45.1/0.45.2 | One 0.45.x resolution through a pnpm catalog |
| Fastify/Hono | Source Fastify; target Hono | Hono only |
| Playwright | Source/current target older; verified current release 1.63.0 | Upgrade reporter, E2E, adapter fixtures, and the Playwright OCI image atomically; pin the image by digest |
| Python/Webwright | Floating uv/Python and broken image | Remove from launch; any future return requires a pinned ADR and clean image |

### 6.3 Dependency hygiene procedure

1. Add a pnpm catalog for TypeScript, ESLint, Vitest, Zod, Playwright, Node types, `pg`, and common test tools.
2. Remove or correct confirmed unused direct dependencies: API `pg`, `pg-mem`, and stale direct `@types/pg`; web router devtools; UI `tslib`; root unused `jscpd`; migrate CLI unused `@automate/db`.
3. Use Effect only in `apps/api/src/bootstrap` for validated configuration, service lifecycle, and composition; keep framework-neutral domain packages in plain TypeScript. Remove direct `effect` declarations from packages that do not import it.
4. Replace global major overrides with the narrowest verified parent selectors. Validate `minimatch`, `js-yaml`, UUID, Hono, and Vite consumers after each change.
5. Declare pnpm lifecycle/native-build permissions explicitly; `better-sqlite3` remains isolated to offline migration tooling.
6. Reject undeclared peers and prevent Node-only Vitest packages from acquiring `jsdom`.
7. One manifest/lock change per dependency PR; CI always performs a frozen clean install.

### 6.4 Reporter protocol resolution

- Name the source dialect `legacy-flat-v1`; never reuse version `1` for the nested target draft.
- Publish canonical nested events as v2 in `shared-contracts`.
- Normalize ISO timestamps, object/string errors, `timedOut`, and `interrupted` explicitly.
- Reject unknown event types into a quarantine/dead-letter record rather than silently dropping them.
- Fixture every source event transformation.
- Remove v1 only after authenticated telemetry shows no active v1 clients for the agreed observation window and all known reporter versions meet the minimum.

### 6.5 Tool adapter and evidence formats

The platform normalizes producer output without pretending every format has the same fidelity:

| Producer | Required input | Normalization rule |
|---|---|---|
| Playwright | JSON/report events | Preserve project/browser, every result/retry, recursive steps, errors, stdout/stderr, worker/shard, and attachments |
| JUnit-family tools | XML | Stream with bounded input; map suites/tests/status/duration/output; do not invent retries, steps, or attachments absent from the source |
| Robot Framework | JSON/XML/listener events | Preserve suites/tests/keywords, tags, messages, and emitted files; use Rebot only as a source adapter |
| k6/Locust | JSONL/CSV/JSON/OTel/Prometheus | Normalize thresholds and metrics separately from pass/fail checks; do not force load samples into JUnit |
| OWASP ZAP | JSON/SARIF/API events | Map alerts to security findings and retain native reports as immutable artifacts |
| Appium/WebDriver | Host-framework JUnit/Allure plus driver logs | Do not treat WebDriver events as a complete result model |
| Sonar/DefectDojo | Generic quality/SARIF records | Keep source coverage, findings, and gate outcomes as typed external authorities |
| Arbitrary CLI | JUnit, Allure, canonical JSON, or artifact manifest | Reject unsupported output with an explicit non-pass completeness state |

Rules:

- All parser limits, malformed-input handling, reason codes, and discovery behavior are versioned and tested.
- Semantic fingerprints recursively sort object keys, preserve logical paths, and use total ordering for checks, attempts, and steps.
- Occurrence identity (`workspace/run/attempt`) is separate from semantic check/evidence identity.
- Duplicate report shards and parallel-worker ordering are contract-tested.
- SARIF, Allure HTML, JUnit XML, and machine-contract exports are optional projections/artifacts, never competing sources of truth.
- The canonical machine export is a versioned read projection such as `automate.run-export@<version>` containing completeness, proof, producer identity, checks, attempts, steps, evidence references, and artifact digests.

### 6.6 QA-Doctor / Mjölnir integration boundary

Reimplement or reference these proven concepts:

- bounded, streaming JUnit parsing rather than the current regex parser;
- explicit skip/partial reasons for malformed, oversized, or unsupported reports;
- run-local retry semantics that preserve every declared attempt;
- evidence/proof/completeness separated from scan score and truth;
- trust ceilings for unavailable, corrupt, partial, missing, and advisory runtime evidence;
- deterministic evidence/SARIF ordering and run identity;
- artifact collection on failed and partial scans;
- source-only Playwright reporter packaging with Playwright as a peer dependency and no copied runtime;
- visible, fingerprinted, expiring suppression policy with fail-closed handling;
- one calculation engine for web, JSON, SARIF, and quality-gate projections.

Do not copy these Mjölnir shapes or unwired features:

- flat `ForensicsReport` or `EvidenceRecord` as the Automate system of record;
- boolean `verified` or `[UNPROVEN]` title sentinels;
- retry inference from repeated IDs alone;
- Playwright parsing that keeps only the first/last result and drops steps, attachments, stdout/stderr, and project identity;
- committed/generated `FLAKY.md` as a product artifact;
- evidence-graph, trend, quarantine, suppression-gate, and remote-worker features that remain planned or unwired in QA-Doctor;
- the current static one-report HTML renderer as the product dashboard.

Reference evidence in `C:\VS-Code-Projects\Github\QA-Doctor`:

- `src/forensics/parse-junit.ts:38-248` — bounded SAX parsing.
- `src/forensics/analyze.ts:203-233` and `src/forensics/types.ts:119-130` — retry/final-state concepts.
- `src/engine/runtime-corroboration.ts:19-78` and `src/engine/trust-summary.ts:39-85` — trust ceilings.
- `src/engine/evidence-core.ts:9-69` — evidence concepts requiring a better wire shape.
- `src/engine/sorting.ts:3-30` and `src/reporter/sarif.ts:121-187` — deterministic projections.
- `src/engine/run-identity.ts:13-73` — producer/config identity concepts, with canonical JSON to be corrected.
- `docs/ARCHITECTURE.md:5-9,77-87` and `docs/research/verification-trust-ecosystem-2026.md:69-82,196-241,459-477` — local CLI boundaries, trust/completeness rules, runner, and KPI gaps.

QA-Doctor supplies evidence and ingestion policy. Automate supplies scheduling, durable execution, distributed runners, product database, OCI images, KPI dashboards, and orchestration.

## 7. Rationalization and pruning specification

The static audit found approximately 16,000–24,000 removable source lines and at least 11 direct dependencies before optional Webwright/UI cuts. Treat these as cleanup categories, not deletion quotas; preserve behavior first, then delete residue.

### 7.1 Delete after parity gates

#### Legacy checkouts and generated state

- `/AutoMate/`, including its nested `dashboard/` candidate, installed dependencies, SQLite/WAL/SHM files, logs, reports, and agent state.
- `.artifacts/`, tracked Playwright `test-results/`, tracked `__pycache__/*.pyc`, `*.log`, local DB/WAL/SHM files, `dist/`, `coverage/`, `.turbo/`, `.vite/`, and stale worktrees.

Before deletion, archive both pinned source commits and produce checksums for any retained data/fixtures. Never delete the only local copy of an unmigrated database or vault.

#### Obsolete documentation

Delete or move to a historical archive after extracting still-valid decisions:

- `PRODUCTION_READY.md`
- `RELEASE-v1.0.0.md`
- `DEPLOYMENT_READY.md`
- `COMPLETION_SUMMARY.md`
- `.github/RELEASE_SUMMARY_v1.0.0.md`
- `.github/COMMIT_MSG_v1.0.0.txt`
- `docs/QA_MASTER_PLAN.md`
- `docs/PRD-MVP-gap-analysis.md`
- `docs/plans/qace-consolidated-roadmap.md`
- `docs/cleanup-plan.md`
- `docs/release-notes-v2.md`

Replace the parity matrix with a generated, evidence-backed capability register. Do not preserve contradictory readiness claims as current documentation.

#### Duplicate infrastructure and scripts

After the canonical Compose/edge proxy passes smoke tests, delete:

- `docker-compose.yml`, `docker-compose.unified.yml`, and `docker-compose.test.yml` after their valid behavior is moved under `infra/compose/`.
- redundant root/docker/nginx configurations after consolidation under `infra/nginx/`.
- `scripts/first-boot.sh`, `scripts/first-boot.ps1`, `docker/init-entrypoint.sh`.
- obsolete `scripts/perf-smoke.ts` and legacy `perf/automate-smoke.js`, `perf/dashboard-smoke.js`, `perf/dashboard-load.js` after equivalent current scenarios are defined.
- `scripts/automation-score.mjs`; use native Playwright exit status and optional JSON reporter output.
- `scripts/unify-preflight.mjs` only after replacing it with a repository-boundary check for nested roots, duplicate lockfiles, forbidden env names, and generated artifacts.

#### Mock, unwired, and deferred product surfaces

Remove from the launch tree unless completed as part of a core slice:

- canned agent endpoints and unused agent UI/hooks;
- empty accessibility API and unreachable accessibility pages;
- hard-coded trends, leaderboards, and performance dashboards;
- duplicate/unregistered run detail, trace, and dashboard pages;
- legacy schedule UI/hooks with no API; replace them with the canonical inventory/schedule/jobs UI rather than carrying unwired mocks;
- MCP UI/hooks with no server implementation;
- unused GitHub/settings/integration pages that duplicate canonical routes;
- Webwright UI, clients, FastAPI service, compose entry, and Python dependencies until one authenticated, tested contract exists;
- unused UI primitives/stories with no production consumer.

Do not delete source contracts or tests before their canonical replacement passes contract and acceptance tests.

### 7.2 Keep and rationalize

- `packages/shared-contracts`: make canonical, split by domain, remove Node-incompatible JSON import assertions, and make API/web/reporter consume it.
- `packages/auth`: keep only installation identity, session, and secret-hash responsibilities.
- `packages/db`: keep one PostgreSQL owner and domain repositories; remove dormant target-only schemas only through forward migrations after data review.
- `packages/realtime`: retain transport/replay code; remove duplicate payload schemas.
- `packages/ui`: retain only primitives with product consumers or an explicitly maintained design-system workflow.
- Reporter/run ingestion, basic run detail, quarantine, quality gates, and current vertical-slice E2E: retain and improve.
- Drizzle migration metadata: retain as operational source.

### 7.3 Repository-boundary repair

Change legacy ignore rules from broad `Automate/`/`AutoMate/` patterns to a root-only `/AutoMate/` rule. The current rules at `.gitignore:34-37` can match `apps/web/src/routes/automate/**` on Windows and make a clean checkout differ from the local machine.

The repository boundary check must fail when:

- a nested `.git`, workspace manifest, or lockfile exists under the unified root;
- a source Dockerfile/Compose/nginx file is reintroduced outside `infra/`;
- a second ESLint/Prettier/TypeScript base config is added;
- production code reads undeclared environment variables;
- generated artifacts or local databases become tracked;
- tests contain `.skip` or `.only`;
- legacy mock modules are registered in production composition.

## 8. Verified QA market analysis and role recommendations

### 8.1 Method and conclusion

Snapshot date: **2026-09-24**. Counts are exact GitHub stars observed during this plan session and are mutable. Only repositories with at least 1,000 stars are ranked. Evaluation used first-party repositories, release feeds, licenses, architecture, tool integrations, result/artifact formats, distributed execution, and container/OCI fit. Ranked candidates were actively released or maintained in the surrounding weeks; push recency alone was not treated as a substitute for stability or license review.

No qualifying repository supplies the entire target:

- canonical `Run > Check > Attempt > Step > Evidence/Artifact` state;
- automation inventory and scheduling;
- distributed runner enrollment, leases, heartbeats, capacity, cancellation, and reconnect;
- product dashboard plus KPI cockpit;
- Playwright, API, load, security, mobile, and arbitrary OCI tools;
- a complete permissive open-source license.

Automate therefore owns the product core and composes the following layers.

### 8.2 Dashboarding and reporting shortlist

| Repository | Stars | License | Best alignment | Product disposition |
|---|---:|---|---|---|
| [reportportal/reportportal](https://github.com/reportportal/reportportal) | 2,031 | Apache-2.0 | Central launch/test/step/log/artifact ingestion and QA drill-down | Benchmark the product model; do not deploy initially because it duplicates persistence, search, queues, and UI |
| [allure-framework/allure2](https://github.com/allure-framework/allure2) | 5,544 | Apache-2.0 | Stable test identity, nested steps, attachments, history, retries, and strong report UX | Support Allure result export/import compatibility and borrow UX semantics |
| [grafana/grafana](https://github.com/grafana/grafana) | 76,889 | AGPL-3.0 | Fleet KPIs, trends, annotations, alerts, runner utilization, queue and duration metrics | Optional internal/portfolio dashboard over a dedicated read model; do not replace the product UI |
| [SonarSource/sonarqube](https://github.com/SonarSource/sonarqube) | 11,021 | LGPL-3.0 | Source coverage, static quality, branch measures, and quality gates | Optional external quality authority represented as typed checks; not the result store |
| [DefectDojo/django-DefectDojo](https://github.com/DefectDojo/django-DefectDojo) | 4,957 | BSD-3-Clause | Security scanner normalization, finding fingerprinting, lifecycle, risk, and SLA KPIs | Borrow the finding model or integrate only when AppSec lifecycle is enabled |

### 8.3 Test-runner shortlist

| Repository | Stars | License | Role in the portfolio | Isolation/result notes |
|---|---:|---|---|---|
| [microsoft/playwright](https://github.com/microsoft/playwright) | 96,636 | Apache-2.0 | Primary browser/API runner | Shard externally, merge reports centrally, publish JSON/JUnit/blob and artifacts; official OCI images |
| [grafana/k6](https://github.com/grafana/k6) | 31,570 | AGPL-3.0 | Primary programmable load/performance runner | One-job OCI or execution segment; ingest JSONL/OTel/Prometheus and enforce thresholds |
| [zaproxy/zaproxy](https://github.com/zaproxy/zaproxy) | 15,823 | Apache-2.0 | Primary DAST/security runner | Isolated scan container, stop API, JSON/SARIF, native HTML/XML/Markdown/PDF artifacts |
| [appium/appium](https://github.com/appium/appium) | 22,006 | Apache-2.0 | Mobile/native runner | Device/simulator fleet is an infrastructure concern; host framework supplies test result semantics |
| [locustio/locust](https://github.com/locustio/locust) | 28,180 | MIT | Python-native load alternative | Ephemeral master plus worker containers; JSON/CSV/HTML/OTel |
| [SeleniumHQ/selenium](https://github.com/SeleniumHQ/selenium) | 34,514 | Apache-2.0 | Legacy/cross-language browser compatibility and Grid | WebDriver/BiDi is not a result model; framework adapters supply reports |
| [vitest-dev/vitest](https://github.com/vitest-dev/vitest) | 17,042 | MIT | High-throughput JS/TS unit/component runner | External shards plus blob merge; JSON/JUnit/TAP/HTML |
| [junit-team/junit-framework](https://github.com/junit-team/junit-framework) | 7,058 | Eclipse-2.0 | JVM execution platform | Small pinned JRE image; stream Open Test Reporting XML and listener events |
| [robotframework/robotframework](https://github.com/robotframework/robotframework) | 11,914 | Apache-2.0 | Low-code and heterogeneous compatibility layer | JSON/XML/listener events; Pabot/Rebot for sharding/merging |
| [cypress-io/cypress](https://github.com/cypress-io/cypress) | 51,025 | MIT | Secondary browser/component engine | Keep only for existing suites; overlaps Playwright and lacks comparable open distributed sharding |
| [postmanlabs/newman](https://github.com/postmanlabs/newman) | 7,253 | Apache-2.0 | Postman collection/API execution adapter | JSON/JUnit and custom reporters; no native scheduler |

### 8.4 Control-panel and orchestration shortlist

| Repository | Stars | License | Strength | Constraint/disposition |
|---|---:|---|---|---|
| [kubeshop/testkube](https://github.com/kubeshop/testkube) | 1,661 | MIT + Testkube Community License | Closest QA-specific product, test workflows, OCI tools, artifacts, schedules, events, optional agent | Full fleet/dashboard is commercial and license is mixed; benchmark and optional Agent API, not foundation |
| [windmill-labs/windmill](https://github.com/windmill-labs/windmill) | 17,879 | AGPL-3.0 | Fully OSS UI/API, schedules, queues, workers, health, retries, Docker/nsjail | General workflow product, not QA model; optional separate-service pilot, never embed casually |
| [triggerdotdev/trigger.dev](https://github.com/triggerdotdev/trigger.dev) | 14,518 | Apache-2.0 | Durable TS tasks, schedules, concurrency, retries, isolated per-run containers | Duplicates the planned control plane and lacks test/case inventory; study only |
| [woodpecker-ci/woodpecker](https://github.com/woodpecker-ci/woodpecker) | 12,142 | Apache-2.0 | Lean server/DB, pull agents, queue, UI/API, cron, per-step OCI | Weak automatic step retry and no QA result model; CI backend reference |
| [kestra-io/kestra](https://github.com/kestra-io/kestra) | 27,468 | Apache-2.0 core; enterprise gates | Excellent workflow UX, triggers, retries, logs, API, Docker | Worker groups, autoscaling, K8s runner, and HA are commercial; UX study only |
| [argoproj/argo-workflows](https://github.com/argoproj/argo-workflows) | 17,003 | Apache-2.0 | Kubernetes-native DAGs, schedules, retries, artifacts, REST/gRPC, pod isolation | No runner inventory or QA semantics; future execution backend after measured need |

Do not run multiple orchestrators initially. Define one internal execution-provider port—lease, dispatch, status, cancel, capacity, logs, artifacts—and choose at most one backend per deployment.

### 8.5 Eight-role recommendation matrix

A repeated winner is intentional: roles need different depth of the same durable platform, not four unrelated systems.

| QA role | Dashboard/reporting | Test runner | Control panel/orchestration | Multi-language/multi-tool |
|---|---|---|---|---|
| General QA Engineer | ReportPortal (2,031) | Playwright (96,636) | Testkube (1,661), as product reference/optional agent | Robot Framework (11,914) |
| SDET / Automation Engineer | Allure 2 (5,544) | Playwright (96,636) | Testkube (1,661), workflow and OCI patterns | Robot Framework (11,914) |
| Performance Engineer | Grafana (76,889) | k6 (31,570) | Windmill (17,879), optional isolated-job pilot | Testkube (1,661), k6/JMeter/Gatling/Locust workload catalog |
| Security / AppSec Tester | DefectDojo (4,957) | OWASP ZAP (15,823) | Testkube (1,661), dedicated ZAP/container patterns | Robot Framework (11,914), heterogeneous API/browser/process composition |
| Mobile / Native QA Engineer | Allure 2 (5,544) | Appium (22,006) | Windmill (17,879), device-job workflow reference | Robot Framework (11,914), AppiumLibrary and remote libraries |
| DevOps / CI Engineer | Grafana (76,889) | Playwright (96,636) | Woodpecker (12,142), lean Apache CI backend | Testkube (1,661), arbitrary OCI test workloads |
| QA Lead / Test Manager | ReportPortal (2,031) | Playwright (96,636) | Testkube (1,661), inventory/scheduling/product benchmark | Robot Framework (11,914), broad existing-suite compatibility |
| Automation Platform Engineer / Architect | ReportPortal (2,031) | Playwright (96,636) | Testkube (1,661), closest QA control-plane reference | Robot Framework (11,914), language-neutral adapter layer |

The matrix is a curated market benchmark, not an instruction to embed all 32 choices. Automate implements the common control plane once and supplies role-specific views over the same normalized data.

### 8.6 Adoption tiers

**Build and integrate in Automate:**

- canonical contracts, database, scheduler, runner protocol, product dashboard, and KPI read models;
- Playwright first;
- k6 and OWASP ZAP in the first runner portfolio;
- JUnit, Playwright JSON, SARIF, k6 metric, and ZAP JSON adapters;
- optional Allure export compatibility;
- Appium after the runner/device lifecycle is proven;
- Grafana only as an optional internal/portfolio KPI surface.

**Use as an optional backend or study source:**

- ReportPortal for reporting UX and ingestion semantics;
- Testkube Agent/TestWorkflow semantics and QA product behavior;
- Windmill or Argo behind the execution-provider port only when a documented pilot proves benefit;
- Robot Framework for low-code/heterogeneous suites;
- Woodpecker for CI conventions;
- Locust, Selenium, Vitest, JUnit, Cypress, and Newman as tool adapters when customer inventories require them.

**Do not make launch dependencies:**

- a second full control plane from Trigger.dev, Kestra, Windmill, or Woodpecker;
- AGPL components embedded into proprietary application code without license review;
- Testkube commercial control-plane assumptions;
- SonarQube, DefectDojo, Appium, or mobile device infrastructure before those workflows enter the agreed launch scope;
- arbitrary HTML/report scraping as a normalization path.

### 8.7 Product-specific dashboard requirements

The product dashboard, not Grafana, owns:

- run/check/attempt/step/evidence exploration;
- retries, flake history, and incomplete/unproven states;
- logs, screenshots, videos, traces, reports, and security findings;
- runner health, capabilities, leases, queue time, and capacity;
- job inventory, schedules, policies, budgets, and cancellation;
- pass rate, flake rate, duration percentiles, queue latency, runner utilization, success rate, and tool cost;
- drill-through from every KPI to canonical affected runs/checks.

Product role views are projections of the same canonical evidence:

| Role | Primary cockpit | Required drill-through |
|---|---|---|
| General QA Engineer | Recent runs, failed checks, environment | Failed check → attempts → steps → artifacts |
| SDET / Automation Engineer | Flake trends, retries, producer coverage | Comparable runs and producer provenance |
| Performance Engineer | Throughput, latency percentiles, saturation, thresholds | Metric window → request samples → threshold result |
| Security / AppSec Tester | Alert lifecycle, severity, affected target, SLA | Finding → scanner evidence → run/artifact |
| Mobile / Native QA Engineer | Device/OS/browser matrix and session history | Device session → test → driver log/artifact |
| DevOps / CI Engineer | Queue latency, runner health, capacity, tool cost | Queue/job → runner/lease → image/tool version |
| QA Lead / Test Manager | Quality posture, missing scope, trend, capacity, SLA | KPI → affected checks/runs → policy/gate reason |
| Automation Platform Engineer / Architect | Runner fleet, toolchain versions, reliability, events, security | Event cursor → job attempt → tool image/config/artifact |

Grafana may consume a separate read model or bounded-cardinality metrics, but individual test names, stack traces, and run IDs must not become Prometheus labels.

## 9. Unified governance and developer environment

### 9.1 Toolchain authority

- Node `22.19.0`, pnpm `10.30.2`, TypeScript `5.9.3`.
- PostgreSQL 16 for development, integration, and migration tests.
- MinIO is the local S3-compatible integration-test implementation; the application uses only the shared storage port.
- Rootless Podman is the local OCI execution provider; a hosted provider may implement the same port with Kubernetes Jobs.
- Corepack reads `packageManager`; no `latest` package-manager installs.
- Add `.nvmrc`, `.python-version` only if a retained Python service survives pruning, and a Dev Container based on the pinned Node/PostgreSQL/MinIO/rootless-OCI versions.
- Cache the pnpm store, not `node_modules`.

### 9.2 TypeScript, lint, and formatting

- One root `tsconfig.base.json` with strict ES2022 semantics.
- Each package has an all-source `tsconfig.json` and a build-specific `tsconfig.build.json` that excludes tests.
- Typecheck includes tests; build never emits tests or declarations into production output.
- One root ESLint 9 flat config covering `apps`, `packages`, `tools`, `tests`, and root TypeScript scripts.
- Retain no-`any`, no TypeScript suppression, type-only imports, unused-variable, promise-safety, import-boundary, and test-discipline rules.
- One direct Prettier dependency and root `format`/`format:check` scripts. Keep formatting separate from ESLint correctness rules.
- Add `.gitattributes` for deterministic line endings.

### 9.3 Environment management

Create `packages/config` as the sole owner that parses environment once and injects immutable typed configuration.

Canonical variables:

```text
NODE_ENV
HOST
PORT
DATABASE_URL
AUTOMATE_API_KEY
COOKIE_SECRET
REPORTER_SECRET
VAULT_SECRET
PUBLIC_APP_URL
ARTIFACT_S3_ENDPOINT
ARTIFACT_S3_REGION
ARTIFACT_S3_BUCKET
ARTIFACT_S3_ACCESS_KEY_ID
ARTIFACT_S3_SECRET_ACCESS_KEY
KILO_GATEWAY_URL
KILO_API_KEY
KILO_MODEL
OLLAMA_BASE_URL                 # optional
RUNNER_API_URL
RUNNER_ID
RUNNER_ENROLLMENT_TOKEN         # bootstrap only; remove after enrollment
RUNNER_CAPACITY
RUNNER_SPOOL_PATH
RUNNER_HEARTBEAT_SECONDS
RUNNER_OCI_PROVIDER
RUNNER_OCI_SOCKET                # local rootless provider only
```

Rules:

- One root `.env.example`; examples are validated against the config schema.
- Production fails fast for missing/invalid required values.
- No `dotenv` dependency; use Node's native `--env-file` for local development.
- `SESSION_SECRET`, `AUTOMATE_DASHBOARD_API_KEY`, and reporter query-token auth are migration aliases with telemetry/deprecation warnings, not documented canonical settings.
- `RUNNER_ENROLLMENT_TOKEN` is accepted only during enrollment and must not be retained in runner configuration after identity issuance.
- `RUNNER_OCI_SOCKET` is a local rootless-provider setting; production runners use the execution-provider interface and never mount a host-wide runtime socket.
- Remove unused `AUTOMATE_SERVICE_SECRET`, dead feature flags, and `CORS_ORIGIN` until CORS middleware exists. Retain `OLLAMA_BASE_URL` only as an optional self-hosted adapter setting.
- Declare all build-affecting variables in Turbo task `env`/`globalEnv`; environment values must not leak across cache keys.

### 9.4 Root command surface

CI, hooks, containers, and documentation may invoke only these root commands:

```text
pnpm install --frozen-lockfile
pnpm dev
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:contract
pnpm test:integration
pnpm test:runner
pnpm test:e2e
pnpm test:performance
pnpm oci:build
pnpm oci:verify
pnpm db:generate
pnpm db:check
pnpm db:migrate
pnpm migrate:plan
pnpm migrate:validate
pnpm migrate:apply
pnpm migrate:verify
pnpm smoke:local
pnpm security:verify
pnpm license:check
pnpm verify
```

`pnpm verify` covers clean boundary checks, formatting, lint, all-source typecheck, unit/contract tests, migration drift, API/web/runner builds, and OCI manifest validation. Service-dependent E2E, isolated runner integration, infrastructure smoke, image execution, and publication remain explicit root commands invoked by named CI jobs.

### 9.5 Tests and coverage

- Unit tests remain colocated.
- Contract tests validate canonical schemas, runner enrollment/lease/event contracts, v1 reporter adapters, tool manifests, auth/session responses, and every connector/producer fixture.
- Integration tests run against real PostgreSQL, the artifact-storage port, and a rootless OCI provider.
- Runner tests cover two API instances, competing leases, renewal, cancellation, hard kill, offline spool/replay, duplicate events, stale events, capacity limits, and secret redaction.
- Producer-adapter tests cover Playwright JSON, bounded JUnit XML, Robot JSON, k6 JSONL/OTel, ZAP JSON/SARIF, and explicit unsupported/partial outcomes.
- One root Playwright config owns all product E2E specs; remove the duplicate child config and undeclared root `npx` workflow.
- Use native Playwright status; do not gate PRs on hosted-runner wall-clock timing.
- Current executable API/web coverage floors are 85%, while documentation claims 93/91/100. First measure a clean baseline, prohibit decreases, require at least 90% for new domain packages, and raise final package thresholds only when the tests actually enforce the documented values.
- Shared contracts require exhaustive schema and property tests; migrations require clean, prior-version, rollback/forward, and reconciliation tests.
- OCI images are smoke-tested by digest and must prove non-root execution, resource limits, read-only inputs, artifact output, and cleanup.

### 9.6 CI and release

Use stable required checks:

- `quality`
- `unit-and-coverage`
- `integration`
- `runner`
- `e2e`
- `oci`
- `security`
- `infra`

Rules:

- CI invokes root scripts; it does not duplicate package lists.
- Every workspace, root config, tool, service, test, infrastructure file, and lockfile triggers an appropriate check.
- Actions are pinned to reviewed commit SHAs; permissions default to `contents: read`.
- Gitleaks, Semgrep, audit, and license checks are blocking for high/critical findings.
- Use Dependabot or Renovate consistently, not both.
- Publication consumes the exact verified commit, produces SBOM/provenance, signs API/web/runner/tool images, and records immutable digests.
- Tool images are versioned independently enough to pin a digest but released from the same reviewed source commit and governance gate.
- No release workflow may depend on mutable tags or rebuild an unverified tree.
- Add CODEOWNERS for root governance, auth, contracts, DB migrations, CI, security, and infrastructure.

## 10. Data migration specification

### 10.1 Source inventory gate

Before implementation claims parity or imports data, materialize both pinned commits in isolated read-only worktrees and record:

- repository URL and commit;
- source manifest and lockfile hashes;
- actual database engine and migration history;
- table/column/index/constraint/row-count catalog;
- source file checksums and WAL state;
- external config, artifact, blob, and vault locations;
- active clients and reporter versions.

If the pinned Dashboard commit differs materially from `AutoMate/dashboard/`, discard candidate-derived assumptions and regenerate the Dashboard parity/dependency map from the pinned tree.

### 10.2 Migration tool redesign

Replace the single `TABLES` array and row copier with a versioned migration plan:

```text
migrate:plan      inspect sources and emit a sanitized manifest/diff
migrate:validate  validate source and target catalogs, IDs, JSON, timestamps, paths
migrate:apply     execute a named, resumable wave
migrate:verify    reconcile counts, checksums, aggregates, FKs, paths, and APIs
```

Required properties:

- Source adapters for SQLite and PostgreSQL; do not assume both sources are SQLite.
- Streaming/keyset reads rather than loading full tables into memory.
- Explicit field transforms for dual IDs, timestamps, JSON, booleans, enums, and null defaults.
- Per-wave transaction, migration lock, durable checkpoint, idempotency ledger, and exact conflict policy.
- Strict failure: zero unexplained row errors, invalid references, missing artifacts, or schema mismatches.
- Sanitized machine-readable report with no credentials or prompt/secret payloads.
- Target catalog validation before any write.
- Separate artifact and vault migration commands; row import must never claim those are complete.

### 10.3 Migration waves

1. **Foundation:** installation identity, default workspace, system tables, and dual-ID maps.
2. **Orchestration:** verified automation inventory and schedules; never infer active runner leases from historical rows.
3. **Reporting evidence:** workspaces, runs, checks, attempts, steps, and evidence.
4. **Reporting aggregates:** quarantine, quality gates, and only those failure classifications with verified source semantics.
5. **Artifact binaries:** object copy, checksum verification, key/path rewrite, retention metadata, and attachment ownership.
6. **Automation:** conversations, messages, flow templates, model profiles, tool runs.
7. **Integrations:** connector configuration and separately re-encrypted vault data.
8. **Audit:** supported audit rows with actor semantics normalized to installation/service/runner actors.

### 10.4 Cutover and rollback

1. Rehearse backup and restore on sanitized production-like data.
2. Run a full bulk import into an isolated target.
3. Execute zero-error reconciliation and application read checks.
4. Put source services into a short, announced write freeze.
5. Take final source and vault backups; record checksums.
6. Run a final verified delta or restart from the final immutable snapshot.
7. Switch edge traffic and credentials to the target.
8. Run canary smoke and migration verification.
9. Keep legacy services startable but read-only until acceptance.
10. Roll back traffic if health, reconciliation, auth, or critical E2E gates fail.

Prefer forward database fixes. Data cutover rollback means restoring/repointing from rehearsed backups, not editing migration history or attempting an unverified down migration.

## 11. Failure modes and controls

| Failure mode | Control |
|---|---|
| Legacy run ID rejected or overwritten | Dual IDs, legacy map, unique workspace/external key |
| Reporter event silently lost | Canonical v2 schema, v1 normalization fixtures, dead-letter record |
| Unsupported/malformed report appears as pass | Bounded adapters, explicit completeness/proof state, missing-required-check policy |
| Two runners execute the same lease | Atomic lease acquisition, fencing token, renewal deadline, terminal-state compare-and-set |
| Disconnected runner loses terminal result | Encrypted durable spool, monotonic event sequence, idempotent replay, artifact reconciliation |
| Tool container escapes limits | Rootless OCI, no host runtime socket, non-root image, seccomp/AppArmor/capability/network policy, hard deadline |
| Cancellation leaves browser/container orphan | Native cancel, process-tree cleanup, runtime provider reconciliation, hard-kill test |
| Duplicate result shards inflate flake metrics | Producer attempt identity, shard identity, deterministic deduplication, historical comparability checks |
| Multi-instance SSE misses events | Transactional outbox, durable cursor, replay, heartbeat |
| Imported conversations remain invisible | Replace in-memory application stores before cutover |
| Artifact rows point to dead files | S3 manifest, checksums, path rewrite, serving smoke tests |
| Vault migration loses credentials | Separate decrypt/re-encrypt/verify command; rotate after acceptance |
| Provider outage breaks all chat | Kilo model catalog is dynamic; per-profile timeout/fallback and clear errors |
| Connector duplicate side effects | Idempotency keys, operation-specific retry policy, execution audit |
| Env/cache contamination | Typed config, Turbo env declarations, no secret build-time variables |
| CI passes locally different systems | Root commands as sole interface, frozen install, canonical Compose |
| Legacy files re-enter the build | Automated nested-root/duplicate-config check |
| Source and target drift during migration | Freeze source, immutable backups, final delta, no continuous dual-write |

## 12. Phased execution roadmap

Each phase should be implemented as focused changes with its own gate. Do not combine data import, feature restoration, and cleanup into one irreversible change.

### Phase 0 — Freeze provenance and product truth

1. Create a clean migration branch/worktree without discarding current uncommitted changes.
2. Record the current dirty-file inventory and classify each change: keep, discard, or reimplement.
3. Materialize both pinned source commits in isolated worktrees.
4. Verify Dashboard commit provenance against the local candidate and record it as the UX reference, not an overlay source.
5. Freeze AutoMate development and record its active consumers, production traffic, background jobs, data, and unique capabilities.
6. Produce `source-manifest` inventories for code, databases, artifacts, credentials, and active clients.
7. Pin QA-Doctor/Mjölnir at `d981ba3` in a traceability matrix and classify each concept as copy, adapt, cite, or reject.
8. Replace stale parity claims with a capability register using: real, mock, missing, deferred, obsolete.

**Gate:** both source commits and all production data sources are reproducible; the repository disposition and QA-Doctor traceability decisions are approved; no migration code proceeds from an unverified snapshot.

### Phase 1 — Establish one toolchain and governance root

1. Pin Node/pnpm/TypeScript and add pnpm catalog/native-build policy.
2. Add shared TypeScript base/build configs and root ESLint/Prettier policy.
3. Make format/lint/typecheck/build/test cover all workspaces, tools, runner, and tests.
4. Fix the root-only legacy ignore rule and add repository-boundary validation.
5. Replace partial `verify` and duplicated CI package lists with root commands.
6. Remove confirmed unused dependencies and unsafe global override candidates.
7. Add pinned rootless OCI, MinIO, PostgreSQL, and image-verification development services.

**Gate:** frozen clean install, formatting, lint, typecheck, unit tests, API/web/runner builds, and OCI manifest validation pass from a clean checkout.

### Phase 2 — Canonical contracts, evidence, and producer adapters

1. Make API, web, auth, realtime, orchestration, reporting, reporter, and runner consume `@automate/shared-contracts`.
2. Define `Run > Check > Attempt > Step > Evidence/Artifact`, proof, completeness, and quality-gate contracts.
3. Split contracts by bounded context and remove duplicate symbols.
4. Define canonical v2 reporter events and the `legacy-flat-v1` adapter.
5. Implement bounded JUnit parsing and lossless Playwright JSON ingestion; add k6, ZAP, Robot, and generic CLI adapters.
6. Define the runner enrollment, capability, lease, heartbeat, event, cancellation, and terminal-state protocol.
7. Add deterministic ordering, duplicate-shard handling, recursive canonical fingerprints, and toolchain provenance.
8. Implement `automate.run-export@<version>` and SARIF as output-only projections.
9. Add fixture-driven producer/consumer and migration tests for every transformation.

**Gate:** no production module defines a competing public schema; unknown/partial evidence is never a pass; v1/v2, runner protocol, and every producer fixture pass contract tests.

### Phase 3 — Persistence, identity, and platform services

1. Add the target PostgreSQL schemas and forward migrations without editing applied history.
2. Implement workspace/run dual identifiers and legacy ID mapping.
3. Implement installation keys, revocable sessions, scoped service credentials, and runner identities.
4. Add transactional outbox, job/event cursors, and durable SSE replay.
5. Add object-storage and filesystem adapters with shared contract tests.
6. Remove production dependence on process-local state.

**Gate:** clean and prior-version migrations pass; two API instances prove durable events and session revocation; storage adapters pass identical contract tests.

### Phase 4 — Reporting, evidence, and KPI product slice

1. Persist reporter lifecycle, checks, every attempt, recursive steps, evidence, and artifacts.
2. Implement run list/detail/explorer, quarantine, quality gates, and truthful summary analytics.
3. Build product views for incomplete/unproven/contradictory/stale evidence and missing required checks.
4. Implement pass rate, flake rate, duration percentiles, queue latency, runner utilization, success rate, and cost read models.
5. Rebuild web features on canonical contracts and remove random/hard-coded dashboards and orphan routes.
6. Publish an optional Grafana-compatible read model for internal portfolio KPIs without replacing product drill-down.

**Gate:** a producer can send v1/v2 through a clean stack and the user can inspect every exact check/attempt/step/evidence/artifact and drill from each KPI to affected runs.

### Phase 5 — Control plane, OCI runner, and multi-tool execution

1. Implement automation inventory, schedules, immutable job definitions, atomic leases, fencing tokens, renewal, capacity, and cancellation.
2. Implement runner enrollment, capability advertisement, heartbeats, health, version, and graceful shutdown.
3. Implement encrypted offline spool, monotonic events, idempotent replay, and terminal-state reconciliation.
4. Implement the execution-provider port with rootless OCI as local default and an allowlisted process executor only for approved lightweight tools.
5. Implement `tool-sdk` manifests, validate/prepare/execute/cancel/collect behavior, deadlines, progress, and artifact manifests.
6. Add immutable `runners/playwright`, `runners/k6`, and `runners/zap` OCI images.
7. Implement runner/job/lease/capacity/cancel views in the product dashboard.
8. Test competing leases, API restart, network partition, stale events, duplicate replay, resource limits, hard kill, and artifact cleanup.
9. Benchmark Testkube Agent and one Windmill/Argo pilot behind the execution-provider port; adopt at most one, never a second control plane.

**Gate:** two runners and two API instances complete sharded jobs exactly once from the user-visible outcome perspective; dashboard/API loss does not lose terminal state or artifacts; untrusted images cannot access host runtime credentials.

### Phase 6 — Real AI automation

1. Implement the AI gateway port and dynamic Kilo model catalog.
2. Add optional Ollama adapter and persisted model profiles.
3. Port conversation/message persistence and the bounded tool loop.
4. Add real streaming, cancellation, timeout, usage, provenance, and audit handling.
5. Build settings/chat UI against canonical contracts.
6. Delete mock response paths only after real acceptance passes.

**Gate:** configured Kilo and Ollama profiles can stream a tool-enabled conversation, survive restart, and produce persisted/auditable tool runs without exposing secrets.

### Phase 7 — Connectors, vault, and optional tool breadth

1. Port the connector SDK/manifest/lifecycle rules.
2. Implement GitHub, Jira, and Slack adapters with bounded clients.
3. Move credentials to version-encrypted vault storage and audit access.
4. Add connector contract fixtures and failure-mode tests.
5. Add Appium only after device/simulator lifecycle, isolation, and cleanup tests exist.
6. Add Robot Framework, Locust, Selenium, Vitest, JUnit, or Newman adapters when a verified customer inventory requires them.
7. Add a minimal integrations UI tied to real health/execution results.

**Gate:** each enabled connector/tool passes a sandboxed end-to-end job, timeout, retry/idempotency, artifact, and credential-rotation test.

### Phase 8 — Migration tool and rehearsals

1. Add source adapters, transforms, checkpoints, target validation, and reconciliation.
2. Implement artifact and vault migration separately.
3. Build sanitized production-like fixtures and migration E2E tests.
4. Rehearse full import, backup/restore, application reads, and rollback on staging.
5. Record every unmapped source column/file with an explicit disposition.

**Gate:** repeated rehearsal imports are deterministic, resumable, and produce zero unexplained discrepancies.

### Phase 9 — Production cutover

1. Announce and enforce the source write freeze.
2. Take final immutable backups and checksums.
3. Run the final import/delta and verification.
4. Rotate credentials, enroll initial runners, and switch edge traffic.
5. Run canary health, auth, reporter, runner, artifact, AI, connector, and product E2E checks.
6. Keep legacy services read-only and startable until acceptance is signed.

**Gate:** reconciliation is exact, critical workflows pass, rollback remains viable, and no source writes are lost.

### Phase 10 — Rationalize and decommission

1. Delete migrated source-only packages, manifests, lockfiles, SQL, workflows, and deployment files.
2. Delete mock/deferred product surfaces and unused UI primitives.
3. Delete generated reports, test results, caches, local databases, and nested checkout residue.
4. Replace historical release/readiness documents with current ADRs/runbooks and a generated capability register.
5. Revoke legacy credentials and remove legacy routes only after zero-active-consumer evidence.
6. Archive the pinned AutoMate and Dashboard baselines; delete AutoMate only after retention and rollback requirements are signed off.

**Gate:** one active repository, one lockfile, one contract authority, three intentional deployables, no nested Git roots, no production mocks, and all governance checks green.

## 13. Validation and acceptance criteria

The migration is complete only when all of the following are true:

- A clean checkout has no dependency on ignored local files.
- `pnpm install --frozen-lockfile` succeeds without lock mutation.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:runner`, `pnpm build`, `pnpm oci:verify`, and `pnpm verify` pass.
- Contract, integration, runner, E2E, OCI, infrastructure, and security jobs pass from canonical root commands.
- API, web, runner, and reporter share one contract authority; no duplicate event schemas remain.
- No production domain uses an in-memory store.
- `Run > Check > Attempt > Step > Evidence/Artifact` survives concurrent ingestion, duplicate shards, retries, incomplete data, and deterministic reordering.
- Missing, malformed, unsupported, stale, contradictory, or unproven evidence cannot silently pass a required quality gate.
- Workspace/run identity survives legacy import and remains unique.
- Events and terminal state survive API restart, network partition, and multi-instance routing.
- Atomic leases prevent two active runners from owning the same job; fencing tokens reject stale completion.
- Tool OCI images run by digest, non-root, resource-limited, network-restricted, and without host runtime credentials.
- Artifacts and vault credentials pass checksum/decrypt verification through disconnected-runner reconciliation.
- Product KPIs drill through to canonical affected runs/checks; Grafana remains optional and bounded-cardinality.
- Kilo model discovery is dynamic and no static provider catalog is required.
- Every enabled Playwright/k6/ZAP/additional tool path is real end to end; deferred capabilities are absent or explicitly feature-disabled without mock responses.
- At most one external orchestration backend is enabled behind the execution-provider port; Automate remains the canonical control plane and product dashboard.
- Source/target row, aggregate, FK, path, and credential reconciliation has zero unexplained discrepancies.
- Legacy traffic is zero, credentials are revoked, rollback has expired, source deployments are decommissioned, and AutoMate is archived/deleted under the approved retention decision.

## 14. Explicitly out of scope

- Multi-tenant SaaS isolation, users, RBAC, SAML, and organization membership.
- MCP, visual-diff baselines, predictive/advanced analytics, NL-to-SQL, code-generation UI, agent repair workflows, and i18n/RTL.
- A long-lived Webwright service, desktop/Tauri applications, and the legacy setup/admin CLI.
- Microservice decomposition beyond the single dedicated runner, Redis, Kafka, Kubernetes, Helm, Terraform, read replicas, and table partitioning.
- Embedding a complete external control plane such as Testkube, Windmill, Trigger.dev, Kestra, or Woodpecker as the Automate system of record.
- Branding changes or renaming the `@automate` package namespace.

Each deferred item requires a separate ADR, acceptance criteria, and migration slice; none should remain as a mock in the launch product.

## 15. Evidence index

### Exact AutoMate baseline

- `bce507e:apps/server/src/db/schema.ts:20-40` — text primary/foreign keys and source table shape.
- `bce507e:apps/server/src/db/vault/repository.ts:15-79` — separate vault schema and encryption round trip.
- `bce507e:apps/server/src/session/session-vault.ts:33-76` — additional session/vault key derivation.
- `bce507e:apps/server/src/session/create-session-repository.ts:153-190,262-320` — API-key, workspace, and session behavior.
- `bce507e:apps/server/src/run/run-event-bus.ts:29-68` — process-local event transport.
- `bce507e:apps/server/src/tool-registry/http-server.ts:1820-1945` — source run/query/upload API behavior.
- `bce507e:apps/server/src/http-server.ts:166-207` — source local configuration and bind behavior.
- `bce507e:apps/server/src/mcp/gateway/runtime.ts:187-220,297-340` — source MCP scope, approval, and concurrency behavior.
- `bce507e:apps/webwright/src/client.py:28-53,111-145` and `bce507e:apps/webwright/src/main.py:46-85` — three-way Webwright contract drift.
- `bce507e:docs/OPENCODE_COMPATIBILITY.md:1-14` and `bce507e:docs/OPENCODE_PRD.md:1-15` — intended source product scope.

### Provisional Dashboard candidate, pending pinned-commit verification

- `AutoMate/dashboard/apps/server/src/db/schema.ts` — `pgTable` source model.
- `AutoMate/dashboard/apps/server/drizzle/meta/_journal.json:1-16` and `AutoMate/dashboard/apps/server/drizzle/0000_mighty_malcolm_colcord.sql:1-20` — SQLite metadata/SQL paired with PostgreSQL runtime.
- `AutoMate/dashboard/apps/server/src/services/auth.ts:8,103-145` — legacy session cookie/token format.
- `AutoMate/dashboard/apps/server/src/services/vault.ts:32-94` and `apps/server/src/vault/crypto.ts:1-38` — inconsistent vault envelopes and iteration counts.
- `AutoMate/dashboard/apps/server/src/services/startup-policy.ts:25-70` — required environment and artifact/vault directories.
- `AutoMate/dashboard/apps/server/src/services/connector-registry.ts:18-34,115-129` — durable/in-memory connector mode split.
- `AutoMate/dashboard/apps/server/src/services/scheduler.ts:27-45` — candidate legacy scheduler semantics requiring verification, not an accepted scheduler implementation.
- `AutoMate/dashboard/apps/server/src/services/feature-flags.ts:80-123` — post-MVP features enabled contrary to environment/docs.
- `AutoMate/dashboard/packages/reporter/src/index.ts:26-55,100-184,266-301` — legacy flat reporter protocol and test IDs.
- `AutoMate/dashboard/README.md:235-249` — candidate upstream differs from the confirmed private Dashboard baseline.

### QA-Doctor / Mjölnir reference

- `C:\VS-Code-Projects\Github\QA-Doctor\docs\ARCHITECTURE.md:5-9,77-87` — local static report/CLI boundaries and missing product control plane.
- `C:\VS-Code-Projects\Github\QA-Doctor\docs\research\verification-trust-ecosystem-2026.md:69-82,196-241,459-477` — trust/completeness, run-local retries, remote-runner and KPI gaps.
- `C:\VS-Code-Projects\Github\QA-Doctor\src\forensics\parse-junit.ts:38-248` — bounded streaming JUnit parser.
- `C:\VS-Code-Projects\Github\QA-Doctor\src\forensics\analyze.ts:203-233` — attempt/final-state derivation.
- `C:\VS-Code-Projects\Github\QA-Doctor\src\engine\runtime-corroboration.ts:19-78` and `src\engine\trust-summary.ts:39-85` — trust ceilings.
- `C:\VS-Code-Projects\Github\QA-Doctor\src\engine\sorting.ts:3-30` and `src\reporter\sarif.ts:121-187` — deterministic projections.
- `C:\VS-Code-Projects\Github\QA-Doctor\packages\playwright-reporter\package.json:1-27` and `src\index.ts:1-32` — source-only reporter packaging discipline.

### Current unified target

- `package.json:1-49`, `pnpm-workspace.yaml:1-5`, `turbo.json:1-23` — current governance root.
- `docs/architecture/unified-platform.md:1-63` — current proposed migration intent.
- `apps/api/src/index.ts:34-111` — current composition and in-memory fallbacks.
- `apps/api/src/config.ts:1-28` — current environment contract.
- `apps/api/src/routes/reporter.ts` and `apps/api/src/realtime/realtime-bus.ts` — current local protocol and process-local transport.
- `apps/api/src/modules/orchestrator/chat.ts`, `test-gen.ts`, and `modules/agents/browser.ts` — current mock behavior.
- `packages/db/src/schema/dashboard.ts:27-70,416-625` — current UUID run model and deferred identity/agent tables.
- `tools/migrate-cli/src/migrate.ts:61-221,223-278,319-374` — current migration coverage and failure model.
- `.gitignore:34-42` — nested legacy checkout and agent-state patterns that affect tracked routes.
- `docs/db-migration.md:166-215` and `docs/migration-guide.md:1-43` — current migration claims and command drift.
- `.github/workflows/unified-ci.yml:38-113,148-188` — current incomplete path filters and build coverage.

### 2026 QA market evidence

Star counts in Section 8 were verified on 2026-09-24 from the canonical GitHub repositories and are mutable snapshots. Architecture/licensing claims were checked against first-party project documentation. Primary repositories evaluated include:

- `https://github.com/reportportal/reportportal`
- `https://github.com/allure-framework/allure2`
- `https://github.com/grafana/grafana`
- `https://github.com/SonarSource/sonarqube`
- `https://github.com/DefectDojo/django-DefectDojo`
- `https://github.com/microsoft/playwright`
- `https://github.com/grafana/k6`
- `https://github.com/zaproxy/zaproxy`
- `https://github.com/appium/appium`
- `https://github.com/locustio/locust`
- `https://github.com/SeleniumHQ/selenium`
- `https://github.com/vitest-dev/vitest`
- `https://github.com/junit-team/junit-framework`
- `https://github.com/robotframework/robotframework`
- `https://github.com/kubeshop/testkube`
- `https://github.com/windmill-labs/windmill`
- `https://github.com/triggerdotdev/trigger.dev`
- `https://github.com/woodpecker-ci/woodpecker`
- `https://github.com/kestra-io/kestra`
- `https://github.com/argoproj/argo-workflows`

Repositories below the 1,000-star threshold are excluded from the ranked shortlist and role matrix even when they are architecturally relevant.
