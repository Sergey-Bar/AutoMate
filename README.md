<h1 align="center">Automate</h1>

> **Migration status:** Local/sample-only implementation is active. Production cutover, publication, credential rotation, and source decommission remain blocked. Current capability truth is `docs/migration/capability-register.md`; the phase record is `docs/migration/phase-0-decision-record.md`.

Automate is a unified QA control plane built around canonical evidence, durable run history, isolated runner execution, and a product dashboard. The migration specification is `docs/migration/unified-repository-migration.md`.

## Workspace

| Path | Responsibility |
|---|---|
| `apps/api` | Hono API, ingestion, auth, reporting, and composition |
| `apps/web` | React/Vite product surface |
| `apps/runner` | Runner protocol and execution boundary |
| `packages/shared-contracts` | Browser/Node/API-safe Zod contracts |
| `packages/reporting` | Proof, completeness, KPI, and gate policies |
| `packages/reporter` | Playwright, JUnit, and legacy producer adapters |
| `packages/realtime` | Versioned replay and SSE boundaries |
| `packages/orchestration` | Job state machines and schedules |
| `packages/automation` | Dynamic AI gateways and streaming ports |
| `packages/connectors` | Connector SDK and bounded adapters |
| `packages/db` | PostgreSQL schema and forward migrations |
| `tools/migrate-cli` | Resumable migration planning and control plane |
| `infra` | Local-only deployment assets |

## Prerequisites

- Node.js `22.19.x`
- pnpm `10.30.2`
- PostgreSQL 16 for persistent environments

## Setup

```bash
pnpm install --frozen-lockfile
pnpm dev
```

The development server uses the API and web workspace scripts. Production configuration is owned by `packages/config`; do not add unscattered environment reads.

## Validation

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:contract
pnpm test
pnpm coverage:ratchet
pnpm build
pnpm db:check
pnpm security:verify
pnpm verify
```

The current browser E2E is `pnpm test:e2e` and passes the authenticated local vertical slice. The passing API slice is `pnpm test:e2e:api`; production session topology remains outside local scope.

## Configuration

Required persistent settings include `DATABASE_URL`, `COOKIE_SECRET`, and `VAULT_SECRET`. Bootstrap credentials are `AUTOMATE_API_KEY` and optional provider settings are `KILO_GATEWAY_URL`, `KILO_API_KEY`, and `OLLAMA_BASE_URL`. Secret values are never logged or stored in Git.

## Current boundaries

- Reporter and dashboard views consume canonical run/check/attempt/evidence contracts.
- Sessions are revocable and cookie-backed; production durability is being completed in the identity migration tranche.
- Runner, OCI, and local rehearsal assets are local-only until their execution gates pass.
- Webwright, canned AI agents, and deferred connector/admin surfaces are not launch capabilities.
- No production publication, remote push, registry push, or destructive migration is authorized by this repository state.

See `docs/migration/capability-register.md` for evidence-backed status and `docs/migration/unified-repository-migration.md` for the complete phase gates.
