# Automate Consolidated Roadmap

> Single source of truth. Replaces all prior implementation plans (v3, MVP shipping, testing, UI/UX overhaul, Phase 24, Q-Ace MVP).
>
> **Date**: 2026-04-15
> **Baseline**: 4,478 tests passing · 11/13 packages ≥90% coverage (Dashboard server/client branches raised to ≥90%) · CI/CD operational · Auth, vault, rate-limiting, changesets, npm/GHCR/docs pipelines shipped

---

## What's Already Shipped

Everything below was delivered across previous plan cycles. Included here for context — do not re-implement.

| Capability | Automate | Dashboard |
|---|---|---|
| Auth (API key + sessions) | ✅ Bearer plugin, timing-safe | ✅ Full key lifecycle, httpOnly cookies, HMAC sessions |
| Rate limiting | ✅ @fastify/rate-limit, per-route | ✅ Plugin + per-route (login) |
| Vault (AES-256-GCM) | ✅ PBKDF2, per-IP rate-limit | — |
| Connectors (GitHub, Jira, Slack, SQL) | ✅ All with tests | — |
| Coverage thresholds | ✅ Server 95.7%/90.1% branches, Web 98.4%/94.4% branches | ✅ Server 93%+/90% branches, Client 91%+/90% branches, Reporter/CLI/Shared ≥90% |
| CI/CD (GitHub Actions) | ✅ E2E, nightly, security | ✅ CI, nightly mutation, lint-staged |
| E2E tests | ✅ 9 specs, AI/non-AI split | ✅ 8+ specs |
| PR integration | — | ✅ Schema, comparison, comment posting |
| NL query | — | ✅ SQL validation, table whitelist |
| AI Explain | — | ✅ OpenAI, Ollama, Anthropic |
| Reporter package | — | ✅ npm-published, standalone |
| CLI tool | — | ✅ @automate/cli |
| UI component library | — | ✅ Button, Input, Select, Toggle, Kbd |
| 404 page, onboarding wizard | — | ✅ With tests |
| Rename (Mission Control → Automate) | — | ✅ Complete, zero remnants |
| Env upgrades (TS 5.9, Fastify 5, Vite 7, Vitest 4, Drizzle 0.45) | ✅ | ✅ |
| Docker (compose + nginx + healthcheck) | ✅ + Ollama sidecar | ✅ + prod compose |
| i18n (EN + HE with RTL) | — | ✅ |
| Feature flags | — | ✅ env-driven |
| MCP server + gateway | — | ✅ 25+ files: gateway, proxy, Playwright MCP, auth, policy, registry, metrics, CLI |
| Inline style → Tailwind CSS 4 migration | — | ✅ Complete |
| QA architecture hardening (ESLint, shared types) | ✅ | ✅ |
| Mutation testing (Stryker) | ✅ Configured | ✅ 100% kill rate |
| Swagger/OpenAPI docs | ✅ `/api/docs` via @fastify/swagger | — |
| Accessibility E2E tests | ✅ axe-core Playwright integration | ✅ axe-core Playwright integration |
| Backup/restore scripts | — | ✅ `scripts/backup.ts`, `scripts/restore.ts` |
| Webhook notifications | — | ✅ Slack, Jira, GitHub, GitLab, Teams, email |
| Permalinks | — | ✅ Shareable run/test/step deep links |
| eslint-plugin-playwright | ✅ Configured | ✅ Configured |
| Pre-commit hooks | ✅ Husky + lint-staged | ✅ Husky + lint-staged |

---

## Workstream 1: Production Hardening ✅ COMPLETE

> **Owner**: Platform / Backend
> **Priority**: P0 — ship before any new features
> **Why**: Both products function well in dev. Production deployments need fail-fast safety and automated lifecycle management.

### 1.1 Dashboard: Startup policy ✅ SHIPPED

**Status: SHIPPED** — `apps/server/src/services/startup-policy.ts` (18 tests). Wired into `index.ts` bootstrap via `enforceStartupPolicy()`. Server exits with a clear error when production env is unsafe. Checks: `COOKIE_SECRET` set and not a known default, `CORS_ORIGIN` not `*`, auth enabled with at least one API key, `REPORTER_SECRET` set if reporter port exposed. Also added missing `COOKIE_SECRET` and `AUTOMATE_DASHBOARD_API_KEY` to `.env.example`.

### 1.2 Dashboard: Retention runner lifecycle ✅ SHIPPED

**Status: SHIPPED** — `apps/server/src/services/retention-runner.ts` (14 tests). Factory function `createRetentionRunner()` with configurable interval (default 1h). Invokes existing `runRetentionCleanup()` when retention is enabled. Wired into server bootstrap with graceful shutdown (`stop()` on SIGTERM/SIGINT).

### 1.3 Automate: Pre-commit hooks ✅ SHIPPED

**Status: SHIPPED** — Husky + lint-staged already configured in Automate root. `package.json` has `"prepare": "husky"` and `"lint-staged": { "*.{ts,tsx}": ["eslint --fix", "vitest related --run"] }`. Pre-commit hooks run ESLint auto-fix + `vitest related --run` on staged files, mirroring Dashboard's setup. No further action needed.

### 1.4 Cross-repo: Production hardening verification scripts ✅ SHIPPED

**Status: SHIPPED** — `scripts/verify-prod-hardening.ts` in both repos. Dashboard: 10/10 checks pass. Automate: 8/8 checks pass. Checks: no default secrets in `.env.example`, auth-required documented, CORS not wildcarded in Docker examples, coverage thresholds present, security headers plugin configured, rate limiting configured. Also added `AUTOMATE_API_KEY` to Automate `.env.example`.

---

## Workstream 2: Multi-Provider AI Support

> **Owner**: AI Platform
> **Priority**: P0 — core product differentiator per PRD
> **Why**: Automate supports 3 providers (Ollama, OpenAI, Anthropic) via `apps/server/src/agent/providers.ts`. Dashboard supports 3 providers. PRD targets 10+ providers as competitive moat.

### 2.1 Expand shared schemas to multi-provider enum

**Scope**: Both repos.

- Automate `packages/shared`: Expand `ModelConfigSchema.provider` from `['ollama', 'openai', 'anthropic']` to full set: `ollama`, `openai`, `anthropic`, `google`, `azure-openai`, `groq`, `mistral`, `openrouter`, `cohere`, `bedrock`
- Dashboard `packages/shared`: Create `ai-provider-schema.ts` with shared provider type (Dashboard already has 3 providers wired ad-hoc — formalize the contract)

### 2.2 Automate: Provider adapter registry

**Clarification**: `apps/server/src/agent/providers.ts` already supports Ollama, OpenAI, and Anthropic. Adding a new provider requires implementing the adapter interface and wiring it into the registry. The current implementation does not use an adapter pattern — each provider is a direct switch-case branch in `providers.ts`.

**Deliverable**: Adapter registry pattern. Each provider implements `{ buildModel, validate }`. AI SDK packages (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/azure`) provide the model builders. Unconfigured providers return typed `NotConfigured` errors.

**Tier priority**:
- Tier 1 (must ship): Ollama, OpenAI, Anthropic, Google Gemini, Azure OpenAI
- Tier 2 (OpenAI-compatible): Groq, Mistral, OpenRouter, Cohere
- Tier 3 (feature-flagged): Amazon Bedrock

### 2.3 Automate: Provider capabilities + fallback

**Deliverable**: `provider-capabilities.ts` — capability flags per provider (tools, jsonMode, vision, streaming). Deterministic fallback chain when configured provider lacks required capability.

### 2.4 Dashboard: Expand AI Explain to additional providers

**Problem**: `ai-explain.ts` handles openai/ollama/anthropic with ad-hoc conditionals. Adding Google/Azure/Groq requires more branches.

**Deliverable**: Refactor to provider registry (same pattern as Automate). Add request-shape tests per provider. Tier 2 providers that are OpenAI-compatible should use the OpenAI adapter with custom baseURL.

### 2.5 Dashboard: AI Settings UI — provider-specific fields

**Deliverable**: Update `AISettings.tsx` to show dynamic config fields per provider (e.g., Azure needs API version + deployment name, Ollama needs base URL only). Tests for conditional rendering.

### 2.6 Provider support matrix document

**Deliverable**: `docs/ai-provider-support-matrix.md` — table showing provider × repo × status (Supported / Partial / Planned). Include auth env vars, known limitations, fallback behavior.

---

## Workstream 3: PRD Alignment Scaffolds

> **Owner**: Product Engineering
> **Priority**: P1 — strategic positioning work
> **Why**: PRD v2 defines Q-Ace as a unified AI QA platform across 5 domains. Current code has no shared contract or agent routing layer. These scaffolds enable future domain expansion without overbuilding now.

### 3.1 PRD capability gap matrix

**Deliverable**: `docs/PRD-MVP-gap-analysis.md` — map every PRD P0/P1 capability to `Exists | Partial | Missing`, with owner repo, proposed module path, and acceptance criteria. Living document updated as capabilities ship.

### 3.2 Q-Ace unified result schema

**Deliverable**: `Automate/packages/shared/src/qace-result-schema.ts` — Zod v4 schema for normalized test execution results across all QA domains (browser, api, load, security, mobile). Minimal MVP fields: `run_id`, `agent`, `status`, `summary`. Exported from `@automate/shared`.

### 3.3 Agent route scaffold in Automate

**Deliverable**: `apps/server/src/routes/agents.ts` + `services/agent-registry.ts`. Thin scaffold: `POST /agents/:domain/generate` and `POST /agents/:domain/run`. Browser domain wired to existing chat orchestrator. All other domains return `501 NOT_IMPLEMENTED` with typed response. Tests verify contract.

---

## Workstream 4: Engineering Excellence (NEW)

> **Owner**: Engineering across both teams
> **Priority**: P2 — quality-of-life and long-term health
> **Why**: Items identified from R&D stakeholder perspectives that aren't in any prior plan.

### 4.1 Database migration strategy *(DBA / Backend)*

**Problem**: Both repos use `db:push` (Drizzle Kit) which overwrites schema without migration history. Works for dev/greenfield but is dangerous for production databases with real data.

**Deliverable**: Switch to `db:generate` + `db:migrate` pattern. Generate SQL migration files tracked in git. Add migration-on-startup option for Docker deployments.

### 4.2 Error tracking integration *(SRE)*

**Problem**: Sentry packages are installed in both products but `Sentry.init()` is NOT called in either server bootstrap. Dashboard has `SENTRY_DSN` env var documented. Automate has no error tracking configured.

**Deliverable**: Wire Sentry (or equivalent) in both server bootstraps behind feature flag. Structured error context (user action, route, request ID). Source maps uploaded in CI.

### 4.3 Bundle size monitoring *(Frontend)*

**Problem**: No automated check prevents bundle size regressions. Client bundles could silently bloat.

**Deliverable**: Add `bundlesize` or Vite's `build.rollupOptions.output.manualChunks` analysis to CI. Fail PR if main bundle exceeds budget (300KB gzipped for Dashboard, 250KB for Automate web).

### 4.4 Visual regression testing *(QA)*

**Problem**: Both QA Master Plan and PRD mention it. Neither repo has it.

**Deliverable**: Playwright visual comparison tests for key Dashboard pages (runs list, run detail, analytics, settings). Baseline screenshots committed to repo. CI runs on PR with diff threshold.

### 4.5 Performance baselines *(QA / SRE)*

**Problem**: Automate nightly runs k6, but there's no baseline tracking or regression detection. Dashboard has no performance testing.

**Deliverable**: Define response-time budgets for critical API endpoints (Dashboard: `/api/runs` list < 200ms for 10K rows, `/api/tests` < 150ms). Store baselines. CI alerts on >20% regression.

### 4.6 API versioning strategy *(Architecture)*

**Problem**: Both APIs are unversioned. Breaking changes have no migration path for consumers (reporter, CLI, integrations).

**Deliverable**: Decision doc: header-based vs. URL-prefix versioning. For MVP: add `X-API-Version` response header with current version. Document breaking-change policy.

### 4.7 Cross-product integration *(Product)*

**Problem**: Automate and Dashboard are independent products. PRD envisions Automate triggering test runs on Dashboard and consuming results.

**Deliverable**: Thin integration layer — Automate connector for Dashboard API. `POST /agents/browser/run` in Automate sends a test run command to Dashboard's reporter port. Results flow back via webhook or polling. Feature-flagged.

### 4.8 Documentation site completeness *(DX / Technical Writing)*

**Problem**: `docs-site/` (Starlight) exists but coverage of API reference, deployment guides, and integration tutorials is unknown.

**Deliverable**: Audit docs-site content against actual features. Fill gaps: getting started, deployment (Docker + bare metal), reporter setup, API reference (auto-generated from OpenAPI), integration guides (Slack, GitHub, Jira).

---

## Workstream 5: Security Posture (NEW)

> **Owner**: Security / Platform
> **Priority**: P1 for items 5.1–5.3, P2 for the rest
> **Why**: Auth and vault exist but production deployment security has gaps.

### 5.1 CORS lockdown documentation

**Problem**: Both `.env.example` files default CORS to `*` or `localhost:5173`. Production deployments may copy these defaults.

**Deliverable**: `.env.production.example` in both repos with restrictive defaults. Docker compose examples use explicit origins. Startup policy (1.1) validates CORS is not wildcarded in production.

### 5.2 Secret rotation documentation

**Problem**: No documented procedure for rotating API keys, vault password, or cookie secret without downtime.

**Deliverable**: `docs/operations/secret-rotation.md` covering: API key rotation (Dashboard — generate new, revoke old), vault password change (Automate — re-encrypt procedure), cookie secret rotation (session invalidation impact).

### 5.3 Reporter authentication enforcement

**Problem**: `REPORTER_SECRET` is optional. Unset means any WebSocket client can push fake test results into the Dashboard.

**Deliverable**: When `NODE_ENV=production`, require `REPORTER_SECRET`. Startup policy check (from 1.1). Document in deployment guide.

### 5.4 Dependency vulnerability SLA

**Problem**: Nightly security scans run but there's no defined SLA for patching.

**Deliverable**: Document: Critical CVE → patch within 48h, High → 1 week, Medium → next sprint. Integrate Dependabot or Renovate for automated PRs.

### 5.5 CSP headers audit

**Problem**: Automate has CSP headers mentioned in README but neither repo's CSP policy has been audited against actual inline scripts/styles.

**Deliverable**: Audit and tighten CSP in both servers. Add CSP violation reporting endpoint. Test with Playwright that pages load without CSP violations.

---

## Execution Priority

| Phase | Workstreams | Gate |
|---|---|---|
| **Now** | 1 (Production Hardening) | All verification scripts pass, startup policy enforced |
| **Next** | 2 (Multi-Provider AI) + 5.1–5.3 (Security) | Provider conformance tests pass, provider matrix published |
| **Then** | 3 (PRD Alignment) + 4.1–4.3 (DB migrations, error tracking, bundle size) | Schema contract tested, agent scaffold returns 501 for unimplemented |
| **Later** | 4.4–4.8 (Visual regression, perf, versioning, integration, docs) + 5.4–5.5 | Baselines captured, docs audited |

---

## Intentionally Deferred

The following PRD P0/P1 items are acknowledged but explicitly deferred. They are out of scope for current delivery cycles and require separate planning.

| Item | Scope | Rationale |
|---|---|---|
| Multi-provider AI (10+ providers) | Automate + Dashboard | Tier 1 done (Ollama/OpenAI/Anthropic). Tier 2/3 require design validation. |
| Provider adapter registry pattern | Automate | Current switch-case works; refactor needed before adding Tier 2. |
| Google Gemini / Azure OpenAI | Automate | Tier 1 priority complete. Tier 2 deferred until usage signal. |
| Dashboard: AI Settings UI dynamic fields | Dashboard | Dependent on provider registry being formalized. |
| Q-Ace unified result schema | Automate shared | Requires cross-product API contract design. |
| Agent route scaffold (`/agents/:domain`) | Automate | PRD strategic — no current user demand. |
| Database migration strategy (db:generate) | Both | Non-trivial migration for existing deployments. |
| Startup policy enforcement (fail-fast) | Dashboard | Operational hardening — P0 for production deployments. |
| Retention runner lifecycle | Dashboard | Required before unbounded DB growth in production. |
| RBAC / role-based access control | Dashboard | Multi-role auth requires schema migration and session redesign. Deferred to market-standard-roadmap. |
| SSO / SAML 2.0 authentication | Dashboard | Enterprise auth requires IdP integration design. Deferred to market-standard-roadmap. |
| Append-only audit trail | Dashboard | Compliance logging requires schema additions and query API. Deferred to market-standard-roadmap. |

## QA Master Plan Acknowledged Gaps (P2–P4)

These gaps were explicitly accepted during the QA Master Plan cycle and require future cycles to address:

- Playwright visual regression testing (baseline screenshots not yet in repo)
- Performance baselines tracked in CI (k6 thresholds defined but no regression DB)
- API versioning strategy (currently unversioned; breaking change policy not documented)
- Cross-product integration (Automate → Dashboard test run trigger)
- Secret rotation runbook (documented procedure for API key/vault password rotation)
- CSP headers audit (both servers need audit against actual inline scripts)
- Dependency vulnerability SLA (nightly scans run; no defined patch SLA)

---

## Delivery Summary — Current Cycle

> This section records what was shipped during the `unified-delivery` plan cycle (Tasks 1–33). It serves as the authoritative record for the Final Verification Wave and as a baseline for the next cycle (`market-standard-roadmap`).

### Coverage Achieved (All Packages)

| Package | Statements | Branches | Functions | Lines | Gate |
|---|---|---|---|---|---|
| `@automate/server` | 97.6% | 92.8% | 99.1% | 98.4% | ✅ ≥93% / ≥86% |
| `@automate/web` | 91%+ | 94.4% | 88%+ | 93%+ | ✅ ≥91% / ≥86% |
| `@automate/shared` | 100% | 100% | 100% | 100% | ✅ ≥100% |
| `@automate/connector-sdk` | 85%+ | 100% | 100% | 83%+ | ✅ ≥85% |
| `@automate/connector-github` | 97%+ | 80%+ | 100% | 97%+ | ✅ ≥97% / ≥80% |
| `@automate/connector-jira` | 100% | 70%+ | 100% | 100% | ✅ ≥100% / ≥70% |
| `@automate/connector-slack` | 100% | 70%+ | 100% | 100% | ✅ ≥100% / ≥70% |
| `@automate/connector-sql-browser` | 100% | 100% | 100% | 100% | ✅ ≥100% |
| `@automate/api` | 96.2% | 86.6% | 97.2% | 97.2% | ✅ ≥93% / ≥81% |
| `@automate/unified-web` | 93.7% | 90.1% | 93.8% | 96.2% | ✅ ≥91% / ≥81% |

All 13 packages meet or exceed their configured Vitest coverage thresholds. Thresholds are ratcheted — they cannot regress without a failing CI gate.

### Infrastructure Shipped This Cycle

| Deliverable | Repo | Status |
|---|---|---|
| Startup policy (fail-fast production guard) | Dashboard | ✅ Shipped — `startup-policy.ts`, 18 tests |
| Retention runner lifecycle | Dashboard | ✅ Shipped — `retention-runner.ts`, 14 tests |
| Pre-commit hooks (Husky + lint-staged) | Automate | ✅ Verified operational |
| Production hardening verification scripts | Both | ✅ `scripts/verify-prod-hardening.ts` — 10/10 Dashboard, 8/8 Automate |
| Demo seed data (idempotent) | Automate | ✅ `scripts/seed-demo.ts` |
| Coverage ratchet tooling | Both | ✅ `pnpm coverage:ratchet` operational |
| Changesets (versioning + changelog) | Both | ✅ `@changesets/cli` installed, `.changeset/config.json` present |
| CI workflow — Automate | Automate | ✅ `.github/workflows/ci-automate.yml` |
| CI workflow — Dashboard | Dashboard | ✅ `.github/workflows/ci-dashboard.yml` |
| Nightly mutation + security audit | Both | ✅ Separate nightly workflows per product |
| npm publish pipeline | Dashboard reporter | ✅ `.github/workflows/publish-npm.yml` |
| Docker publish pipeline (GHCR) | Dashboard | ✅ `.github/workflows/publish-docker.yml` |
| Docs deploy pipeline (Starlight) | Dashboard | ✅ `.github/workflows/deploy-docs.yml` |
| k6 load test baseline | Automate | ✅ `k6/load-test.js` with thresholds |
| Lighthouse CI budget | Automate web | ✅ `lighthouserc.json` with performance budget |
| Bundle size guard | Dashboard client | ✅ Vite build budget enforced in CI |
| Consolidated roadmap (this document) | Both | ✅ Replaces all prior plan documents |

### Test Suite Totals

| Repo | Unit Tests | E2E Specs | Mutation Kill Rate |
|---|---|---|---|
| Automate | 1,743 | 9 specs | Configured (Stryker) |
| Automate | 2,735 | 8+ specs | 100% (29/29 mutations) |
| **Total** | **4,478** | **17+ specs** | **All gates green** |

### Next Cycle

The `market-standard-roadmap` plan (44 tasks, Momus-approved) is queued and ready to execute. It covers: multi-provider AI expansion, PRD alignment scaffolds, engineering excellence improvements, and security posture hardening — all workstreams defined in this roadmap.

---

## Operating Principles

1. **TDD always**: Failing test → implement → passing test → commit.
2. **Atomic commits**: One task = one commit = one rollback unit.
3. **No silent partials**: Unimplemented providers/domains return typed `NotImplemented` / `NotConfigured` with tests.
4. **Coverage ratchet**: Never lower thresholds. Use `pnpm coverage:ratchet --update` after raising coverage.
5. **Evidence before claims**: Run verification commands before marking anything done.

---

## Verification Commands (Quick Reference)

### Automate (run from `Automate/`)
```bash
pnpm verify               # build + test + typecheck + lint
pnpm test -- --coverage    # all tests with coverage
pnpm exec playwright test  # E2E (requires Ollama for full suite)
```

### Dashboard (run from `Automate/`)
```bash
pnpm lint && pnpm typecheck
pnpm --filter @automate/api test
pnpm --filter @automate/unified-web test
pnpm test:e2e              # E2E (requires running server)
```
