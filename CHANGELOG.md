# Changelog

All notable changes to the Automate platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-11

### 🎉 Initial Release — Unified Automate Platform

The **Automate** platform is now production-ready. This MVP release delivers a unified, AI-orchestrated QA platform for Playwright test monitoring, live run inspection, failure triage, and quality gates.

### Architecture

**Monorepo Structure:**
- **API** (`@automate/api` v0.1.0) — Hono v4 unified backend with Effect-based services
- **Web Client** (`@automate/unified-web` v0.1.0) — React 19 + TanStack Router + Tailwind CSS 4
- **Database** (`@automate/db` v0.1.0) — PostgreSQL 16 with Drizzle ORM
- **Auth** (`@automate/auth` v0.1.0) — Unified session and API key management
- **Realtime** (`@automate/realtime` v0.1.0) — SSE event bus for live updates
- **Shared Contracts** (`@automate/shared-contracts` v0.1.0) — Type-safe Zod schemas
- **UI Library** (`@automate/ui` v0.1.0) — Tailwind CSS 4 component library

**Tech Stack:**
- Node.js 22+, pnpm 10+, TypeScript 5.9, Vitest 4, Playwright E2E
- PostgreSQL 16, Docker-ready deployment with nginx reverse proxy

---

### 🚀 Features

#### Core Platform

##### Live Run Monitoring
- **Real-time test execution streaming** via WebSocket and SSE
- Live progress tracking for active Playwright test runs
- Run status updates: `running`, `passed`, `failed`, `interrupted`
- Test-level status tracking with execution timing

##### Reporter Ingestion
- Playwright reporter integration via `@automate/reporter`
- **Multi-format payload support:**
  - JSON bulk upload (`POST /api/v1/reporter/upload`)
  - Multipart form-data with artifact files
  - JUnit XML parsing for CI pipeline compatibility
- Real-time event ingestion over WebSocket (`/api/v1/reporter/events`)
- Legacy format compatibility for `@automate/reporter` v1

##### Run Management
- **Run CRUD operations:**
  - List all runs with pagination and filtering (`GET /api/v1/runs`)
  - Get run details with full test breakdown (`GET /api/v1/runs/:runId`)
  - Run summary statistics (total, passed, failed, flaky, skipped)
- Git context tracking: branch, commit SHA, triggered by
- Duration and timing metrics per run and test
- Persistent storage with DrizzleORM + PostgreSQL

##### Failure Triage & Artifacts
- Screenshot storage and retrieval for failed tests
- Video recording capture for full test playback
- Playwright trace file access for deep debugging
- Step timing breakdown for performance analysis
- Error stack traces with source file links
- Test file and line number attribution

#### Dashboard Module

##### Run Intelligence
- Pass-rate analytics across historical runs
- Duration trend tracking and regression detection
- Run timeline visualization
- Test flakiness detection and reporting

##### Quality Gates
- **Configurable pass-rate thresholds** for CI/CD decisions
- Quality gate creation and management (`POST /api/v1/dashboard/quality-gates`)
- Gate status evaluation against run results
- Fail-fast gates for blocking deployments

##### Quarantine Management
- **Auto-quarantine** for consistently flaky tests
- Manual quarantine with reason annotation (`POST /api/v1/dashboard/quarantine`)
- Quarantine list and removal (`DELETE /api/v1/dashboard/quarantine/:id`)
- Test file and title-based quarantine matching

##### Test Explorer
- Search and filter tests by title, file, status
- Test history across runs
- Test-level pass rate and average duration

#### Orchestrator Module

##### AI Conversations
- **Conversational QA interface** for natural language test queries
- Context-aware chat with run history and test results
- AI-powered test explanation and root cause analysis
- Conversation persistence and retrieval

##### Model Configuration
- Multi-provider AI support (OpenAI, Anthropic, Ollama)
- Model selection and parameter tuning
- API key management per provider

##### Test Generation (Preview)
- AI-driven Playwright test generation from natural language
- Feature-flagged endpoint (`POST /api/v1/orchestrator/test-gen`)
- TypeScript `.spec.ts` output with `test()` blocks

#### Agents Module (Preview)

##### Browser Agent
- Natural language → Playwright test code generation
- Configurable base URL and browser target
- Multi-browser support (Chromium, Firefox, WebKit)
- Feature-flagged (`browser-agent`)

##### API Agent
- OpenAPI spec → REST test case generation
- HTTP method and endpoint coverage analysis

##### Load Agent
- Scenario description → k6 performance script generation
- SLA threshold configuration

##### Security Agent
- Target URL → OWASP ZAP scan orchestration
- Vulnerability triage and severity classification

#### Connectors Module

##### Credential Vault
- **AES-256-GCM encrypted storage** for connector credentials
- PBKDF2 key derivation (100k iterations) from master passphrase
- Create, read, update, delete vault entries
- Memory-only passphrase storage (never persisted)
- NIST-compliant secret generation (32-byte entropy)

##### Connector Registry
- Pluggable connector architecture for external integrations
- GitHub, Jira, Slack connector scaffolding
- Connector lifecycle hooks (install, enable, disable)

#### Authentication & Security

- **API key authentication** for reporter and API endpoints
- Session cookie-based auth with `httpOnly`, `Secure`, `SameSite=Strict`
- Auth middleware guards for all protected routes
- Startup policy enforcement (require `DATABASE_URL` in production)
- Permission-based access control foundation

#### Developer Experience

- **pnpm workspace** with Turborepo orchestration
- Full TypeScript strict mode, no `any` types allowed
- ESLint enforcement: `no-explicit-any`, `prefer-const`, unused vars with `_` prefix
- Vitest 4 unit tests with high coverage thresholds:
  - `@automate/api`: 93% statements
  - `@automate/unified-web`: 91% statements  
  - `@automate/shared-contracts`: 100% all metrics
- Playwright E2E test suite (6 core specs)
- Docker Compose for local development and production deployment

---

### 🛠️ Technical Improvements

#### Build & CI/CD
- GitHub Actions workflows:
  - **Unified CI** — lint, typecheck, test, build on PR/push
  - **Nightly Quality Gates** — security scans (Semgrep, gitleaks, pnpm audit)
  - **Integration Tests** — E2E Playwright suite
  - **Docker Publish** — automated image builds on tag push
- Turborepo caching for incremental builds
- `pnpm verify` gate script (build + test + typecheck + lint)

#### Testing
- 366 unit tests across all packages (passing)
- Test coverage ratcheting to prevent threshold regression
- In-memory test fixtures for fast unit testing
- Vitest globals mode for streamlined test authoring

#### Type Safety
- Zod schema validation on all API boundaries
- Shared contracts package for client/server type alignment
- Drizzle ORM type-safe database queries
- Effect-based dependency injection in services

---

### 📚 Documentation

- [README.md](README.md) — Quick start guide and project overview
- [AGENTS.md](AGENTS.md) — AI agent guidelines for contributors
- [docs/migration-guide.md](docs/migration-guide.md) — v1 → v2 migration steps
- [docs/deployment.md](docs/deployment.md) — Production deployment checklist
- [docs/QA_MASTER_PLAN.md](docs/QA_MASTER_PLAN.md) — Comprehensive QA strategy
- [docs/PRD-MVP-gap-analysis.md](docs/PRD-MVP-gap-analysis.md) — Feature roadmap

---

### 🔐 Security

- No credentials in source control (`.env` required, `.env.example` provided)
- Vault encryption at rest with AES-256-GCM
- SQL injection protection via parameterized Drizzle queries
- Path traversal sanitization in artifact uploads
- No sensitive data logged to stdout/stderr

---

### 🚧 Known Limitations (Post-MVP)

The following capabilities are **feature-flagged** and disabled by default in v1.0:

- AI test generation (browser, API, load, security agents) — partial implementation
- Conversational QA with codebase awareness — preview only
- GitHub/Jira/Slack integrations — connector scaffolding present
- Auto-quarantine ML model — manual quarantine only in v1.0
- Error clustering and similarity detection — roadmap item
- Baseline management and visual regression — planned for v1.1
- RBAC and SSO — single API key auth in v1.0

See [docs/PRD-MVP-gap-analysis.md](docs/PRD-MVP-gap-analysis.md) for the full feature matrix.

---

### 🐛 Bug Fixes

- Fixed TypeScript compilation errors in `dashboard/index.ts` (missing type imports)
- Fixed Hono `Context` type extraction in `reporter.ts` multipart parsing
- Fixed path sanitization to prevent directory traversal in artifact uploads
- Fixed race condition in realtime event bus subscription handling

---

### 📦 Dependencies

#### Core Runtime
- `hono@4.12.29` — Fast web framework
- `react@19.0.0` — UI library
- `@tanstack/react-router@1.96.1` — Type-safe routing
- `drizzle-orm@0.40.x` — Type-safe ORM
- `zod@4.4.3` — Schema validation
- `effect@3.x` — Functional effect system

#### Development
- `typescript@5.9.0` — Type checking
- `vitest@4.1.5` — Unit testing
- `@playwright/test@1.50.0` — E2E testing
- `turbo@2.10.4` — Monorepo build system
- `eslint@9.21.0` — Linting

See [pnpm-lock.yaml](pnpm-lock.yaml) for the complete dependency tree.

---

### 🎯 Migration Notes

#### From Standalone Dashboard or Automate Installation

If migrating from a legacy installation:

1. **Database:** Migrate from SQLite to PostgreSQL 16
   - Export data using provided migration CLI (`@automate/migrate-cli`)
   - Create new Postgres database and apply Drizzle schema
   - Import legacy data with `pnpm --filter @automate/migrate-cli exec migrate`

2. **Environment Variables:**
   - Rename `SQLITE_PATH` → `DATABASE_URL` (Postgres connection string)
   - Add `AUTH_SECRET` for session cookie signing (32-byte random string)
   - Update `OLLAMA_BASE_URL` if using external AI provider

3. **API Routes:**
   - All endpoints now prefixed with `/api/v1`
   - Old: `/runs` → New: `/api/v1/runs`
   - Old: `/conversations` → New: `/api/v1/conversations`

4. **Reporter Configuration:**
   - Update `@automate/reporter` to v2.x (compatible with new upload endpoint)
   - Set `AUTOMATE_API_URL=http://localhost:3000` and `AUTOMATE_API_KEY=<your-key>`

See [docs/migration-guide.md](docs/migration-guide.md) for detailed instructions.

---

### 🙏 Acknowledgments

This release represents the unification of the Dashboard and Automate projects into a single, cohesive platform. Thank you to all contributors who helped validate the MVP scope and prioritize the right features for v1.0.

---

### 📋 Release Checklist

- [x] All 28 Turborepo tasks passing (`pnpm verify`)
- [x] TypeScript strict mode with zero compilation errors
- [x] 366 unit tests passing with coverage thresholds met
- [x] E2E test suite (Playwright) passing
- [x] Security scans clean (Semgrep, gitleaks, pnpm audit)
- [x] Docker images build successfully
- [x] Documentation complete (README, migration guide, deployment guide)
- [x] TODO comments improved with roadmap context
- [x] License file added (MIT License)
- [x] All package versions bumped to 1.0.0
- [ ] Git tag `v1.0.0` created and pushed (manual step)
- [ ] Docker images published to registry (automated on tag push)

---

## [Unreleased]

### Planned for v1.1.0
- Baseline management for visual regression detection
- Enhanced auto-quarantine with ML-based flakiness prediction
- Error clustering and deduplication
- Full GitHub/Jira/Slack connector implementations
- Multi-tenant support with RBAC
- Grafana dashboard provisioning for run metrics

---

[1.0.0]: https://github.com/yourorg/automate/releases/tag/v1.0.0
