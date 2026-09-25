# ADR 002: Unified Platform Migration Strategy

> **Superseded proposal:** This document records an earlier proposal. The approved target and phase gates are maintained in `docs/migration/unified-repository-migration.md`.

## Status
Proposed

## Context
The Q-Ace ecosystem currently consists of two independent monorepos: `Automate` and `Automate`. While they provide complementary value, they suffer from duplicated schemas, inconsistent API patterns, and fragmented user experiences. The PRD v2 defines Q-Ace as a unified AI QA platform. We need a strategy to consolidate these into a single, cohesive platform without disrupting existing production workflows.

## Decision: Modular Monolith
We will adopt a **modular monolith** architecture for the unified platform. This approach balances the development velocity of a single codebase with the clear boundaries of independent domains.

### Target Architecture
- **Backend**: Hono + Effect running on Node.js 24+.
- **Database**: PostgreSQL with Drizzle ORM.
- **Frontend**: React 19 + TanStack Router + Tailwind CSS 4.
- **Package Boundaries**:
  - `@automate/contracts`: Shared Zod schemas and API definitions (seeded from `shared-contracts`).
  - `@automate/ui`: Shared component library.
  - `@automate/db`: Centralized Drizzle schema and migrations.
  - `@automate/realtime`: Shared WebSocket logic.
  - `@automate/auth`: Unified authentication and session management.
  - `@automate/ai`: Centralized AI orchestration logic.
- **Applications**:
  - `apps/api`: The unified Hono-based API server (`@automate/api`).
  - `apps/web`: The unified React-based web dashboard (`@automate/unified-web`).

### Migration Strategy: Incremental Waves
Migration will proceed in five waves to minimize risk:
1. **Wave 1 (Foundation)**: Establish the new repository structure, shared packages, and CI/CD gates.
2. **Wave 2 (Shared Packages)**: Extract shared logic (auth, UI, contracts) into workspace packages.
3. **Wave 3 (Vertical Slice)**: Migrate one core domain (e.g., Results) to the new stack to verify the architecture.
4. **Wave 4 (Domain Migrations)**: Incrementally move domains from legacy monorepos.
5. **Wave 5 (Decommission)**: Sunset legacy apps once parity is verified.

### Legacy Parity Rules
- **Parity Definition**: A feature is considered "migrated" when it meets all functional requirements of the legacy version, passes all existing E2E tests, and satisfies unified security standards.
- **Decommission Gates**: Legacy services cannot be shut down until they have 0% traffic and all dependent systems have switched to the unified API.

## Consequences
- **Improved Consistency**: Unified schemas and UI components.
- **Lower Maintenance**: Reduced duplication of infrastructure and CI/CD logic.
- **Initial Overhead**: Migration requires significant upfront investment in tooling and foundation.

## Guardrails
- **Production Safety**: `db:push` is forbidden for production. All production schema changes MUST use the `db:generate` + `db:migrate` flow.
- **Secret Enforcement**: Production deployments require `AUTOMATE_SERVICE_SECRET`, `AUTOMATE_DASHBOARD_API_KEY`, `COOKIE_SECRET`, and `REPORTER_SECRET`.
- **Reporter Compatibility**: The existing `@automate/reporter` npm package must maintain compatibility. The unified platform must support its WebSocket protocol without requiring configuration changes.
- **Iframe Shell Integration**: The `apps/web` will serve as a temporary integration layer, hosting legacy apps in iframes while the unified dashboard is built. Decommission criteria: all functional modules moved to `apps/web`.

## API Versioning
All new API endpoints MUST be prefixed with `/api/v1`.
Responses SHOULD include a `X-API-Version` header.

## Agent Endpoint Alignment
The unified API will align with the PRD target surface:
- `POST /api/v1/agents/:domain/generate`
- `POST /api/v1/agents/:domain/run`
- `GET /api/v1/results/:run_id`

## Non-Goals
- Immediate rewrite of all legacy logic (favor incremental migration).
- Migration to microservices (stick to the modular monolith).
- Changing the underlying AI models as part of the architectural migration.
