# PRD-MVP Gap Analysis — Q-Ace Ecosystem

> **Living document.** Update status column as capabilities ship.
>
> **Source PRD:** `docs/PRD_Automate_Ecosystem_v2.md` (v2.0, March 2026)
> **Roadmap reference:** `docs/plans/qace-consolidated-roadmap.md` (baseline 2026-04-15)
> **Analysis date:** 2026-04-16
> **Verified against:** actual codebase (not just roadmap claims)

---

## Summary Statistics

| Status | Count |
|---|---|
| ✅ Exists | 17 |
| 🟡 Partial | 14 |
| ❌ Missing | 27 |
| **Total tracked** | **58** |

---

## Current MVP Definition — Dashboard-First

The MVP has been narrowed to the strongest validated product surface: **Automate as a self-hosted Playwright run intelligence dashboard**. The MVP promise is one end-to-end flow:

1. Start the dashboard locally or with Docker.
2. Add `@automate/reporter` to an existing Playwright project.
3. Run tests locally or in CI.
4. Watch the run stream live.
5. Open failed tests with screenshots, videos, traces, and timing context.
6. Review pass-rate/duration trends and enforce a pass-rate quality gate.

### MVP In Scope

- Automate live run monitoring.
- Playwright reporter ingestion over WebSocket.
- Run list and run detail failure triage.
- Artifact access for screenshots, videos, traces, and step timing.
- Test explorer with search/filter basics.
- Analytics essentials: pass rate, duration, and recent run health.
- Quality gate threshold for CI decisions.
- API-key login and signed `httpOnly` session cookies.
- Single-container/SQLite deployment with documented persistence.
- English/Hebrew UI and RTL support.

### Post-MVP / Opt-In

The following repository capabilities are **not part of the MVP promise** and should stay feature-flagged off by default until validated with design partners: Automate conversational QA, Unified Platform migration, AI Explain, Auto-Quarantine, NL Query, Codegen Launcher, Terminal Runner, Scheduled Runs, Baseline Management, Error Clustering, Run/PR Comparison, Slack/Jira/GitHub integrations, MCP, RBAC/SSO, enterprise gates, ROI metrics, and AI test generation.

### MVP Readiness Gate

- A new user can complete the Playwright reporter setup from the README without asking for help.
- The first run appears live in the dashboard.
- At least one failed test can be inspected with actionable artifact context.
- The default UI does not advertise post-MVP capabilities unless their feature flag is enabled.
- Docs and feature defaults describe the same product surface.

---

## How to Read This Document

- **Status** — `✅ Exists` = fully implemented and tested · `🟡 Partial` = core scaffolding exists, gaps noted · `❌ Missing` = not implemented
- **Owner Repo** — `Automate` or `Dashboard` (or both)
- **Current Path** — file path(s) of existing code, or `—` if none
- **Proposed Path** — where implementation should live (for Missing/Partial)
- **Acceptance Criteria** — testable conditions for "done"
- **Effort** — `S` (< 1 day) · `M` (1–3 days) · `L` (1–2 weeks)

---

## 1. PRD P0 Capabilities

*From PRD §11 MVP Scope — must ship in v1.0.*

### 1.1 Browser Agent — AI Playwright test generation

| Field | Value |
|---|---|
| **PRD Ref** | FR-BA-001, FR-BA-002, FR-BA-003, FR-BA-008 |
| **Status** | 🟡 Partial |
| **Owner Repo** | Automate |
| **Current Path** | `apps/server/src/services/ai-test-gen.ts` · `apps/server/src/routes/ai-test-gen.ts` |
| **Proposed Path** | `apps/server/src/services/browser-agent.ts` · `apps/server/src/routes/agents.ts` |
| **Effort** | L |

**What exists:** `POST /api/ai/generate-test` — accepts a TypeScript source file and generates **Vitest unit tests** by extracting exported function signatures (no function bodies). Feature-flagged (`ai-test-gen`), disabled by default.

**What's missing:**
- Accepts **natural language prompt or spec document** as input (not TS source)
- Generates `.spec.ts` **Playwright E2E tests** with `test()` blocks, locators, and assertions
- Multi-browser target support (Chromium, Firefox, WebKit)
- Parametrized test data via JSON fixture input
- Route `POST /agents/browser/generate`

**Acceptance criteria:**
- `POST /agents/browser/generate` with `{ prompt: "test login flow", baseUrl: "http://app" }` returns `{ testCode: string, testFileName: "login.spec.ts" }` within 15 s
- Generated test is syntactically valid TypeScript (parse with `tsc --noEmit`)
- Feature flag `browser-agent` gates the endpoint; disabled by default

---

### 1.2 Browser Agent — Execute Playwright tests

| Field | Value |
|---|---|
| **PRD Ref** | FR-BA-003, FR-BA-004, FR-BA-005, FR-BA-006, FR-BA-007 |
| **Status** | ❌ Missing |
| **Owner Repo** | Automate |
| **Current Path** | — |
| **Proposed Path** | `apps/server/src/services/playwright-runner.ts` · `apps/server/src/routes/agents.ts` |
| **Effort** | L |

**What's missing:** No Playwright execution wrapper. Automate has no way to trigger `playwright test` from an API call or collect results. Automate receives Playwright results via its reporter but does not trigger runs.

**Acceptance criteria:**
- `POST /agents/browser/run` with `{ specCode: string, baseUrl: string, browser: "chromium" }` executes Playwright and returns unified result schema JSON within 30 s
- On failure: response includes `artifacts.screenshots` paths
- Results conform to Q-Ace unified result schema (§1.14 below)
- Allure-compatible JSON emitted to `./results/<run_id>/allure/`

---

### 1.3 API Agent (Bruno) — AI collection generation

| Field | Value |
|---|---|
| **PRD Ref** | FR-AA-001, FR-AA-002, FR-AA-003, FR-AA-004, FR-AA-007 |
| **Status** | 🟡 Partial |
| **Owner Repo** | Automate |
| **Current Path** | `apps/server/src/services/openapi-parser.ts` · `apps/server/src/services/contract-test-gen.ts` · `apps/server/src/routes/openapi.ts` · `apps/server/src/services/postman-parser.ts` · `apps/server/src/routes/postman.ts` |
| **Proposed Path** | `apps/server/src/services/api-agent.ts` · `apps/server/src/routes/agents.ts` |
| **Effort** | L |

**What exists:**
- `POST /api/openapi/parse` — parses OpenAPI 3.x spec (feature-flagged: `openapi-parsing`)
- `POST /api/openapi/generate-tests` — generates **Vitest/fetch API contract tests** from OpenAPI spec (feature-flagged: `contract-test-gen`)
- `POST /api/postman/import` — parses Postman collection JSON (feature-flagged: `postman-import`)

**What's missing:**
- Generates **Bruno `.bru` collection files** (not Vitest tests)
- Happy path + error cases + boundary tests per endpoint
- Environment variable support (base URL, auth tokens) in `.env` file format
- Route `POST /agents/api/generate`

**Acceptance criteria:**
- `POST /agents/api/generate` with OpenAPI spec returns valid `.bru` collection file content
- Collection includes at minimum: happy path, 4xx error case, and one boundary test per endpoint
- `POST /agents/api/generate` with free-text description also produces a valid collection

---

### 1.4 API Agent (Bruno) — Execute Bruno collection

| Field | Value |
|---|---|
| **PRD Ref** | FR-AA-005, FR-AA-006, FR-AA-008 |
| **Status** | ❌ Missing |
| **Owner Repo** | Automate |
| **Current Path** | — |
| **Proposed Path** | `apps/server/src/services/bruno-runner.ts` · `apps/server/src/routes/agents.ts` |
| **Effort** | M |

**What's missing:** No Bruno CLI wrapper. No `bru run` execution, no output parsing, no normalization to unified schema.

**Acceptance criteria:**
- `POST /agents/api/run` with `{ collection: string, environment: Record<string, string> }` executes Bruno and returns unified result schema
- Bruno output parsed: each request mapped to `{ id, name, status, duration_ms }`
- Allure-compatible JSON emitted

---

### 1.5 Test Generator Agent (Cross-Domain)

| Field | Value |
|---|---|
| **PRD Ref** | FR-TG-001 through FR-TG-005 |
| **Status** | ❌ Missing |
| **Owner Repo** | Automate |
| **Current Path** | — |
| **Proposed Path** | `apps/server/src/routes/agents.ts` · `apps/server/src/services/agent-registry.ts` · `apps/server/src/services/test-generator-agent.ts` |
| **Effort** | L |

**What's missing:** No cross-domain orchestrator. No `POST /agents/generate` endpoint. No domain detection from spec input. No fan-out to multiple agents.

**Acceptance criteria:**
- `POST /agents/generate` with a Markdown spec doc returns `{ domains: ["browser","api"], tests: { browser: GeneratedTest, api: GeneratedTest }, testPlan: string }`
- AI determines applicable domains from spec content
- User can select subset of domains via `{ enabledDomains: ["browser"] }` parameter
- Non-implemented domains return `{ status: 501, domain: "load", reason: "NOT_IMPLEMENTED" }`

---

### 1.6 Dashboard — Home Panel

| Field | Value |
|---|---|
| **PRD Ref** | PRD §8.3 |
| **Status** | 🟡 Partial |
| **Owner Repo** | Automate (web) |
| **Current Path** | `apps/web/src/routes/index.tsx` (renders `ChatShell`) |
| **Proposed Path** | `apps/web/src/routes/index.tsx` (extend or split) · `apps/web/src/components/home/` |
| **Effort** | M |

**What exists:** Automate home page is a full-screen chat interface (`ChatShell`). It shows conversation history and a chat input.

**What's missing:**
- System health widget with per-tool green/red indicators (Playwright ✅, Bruno ✅, k6 ✅, ZAP ✅)
- Last run summary: "X tests run today, Y passed, Z failed"
- Recent runs widget (last 5 test runs across all agents)
- Quick Actions panel: "Run Full Suite", "Polish a Bug", "Open Allure"
- Model/provider badge

**Acceptance criteria:**
- Home page renders tool health status from `GET /health`
- Tool health icons are green/amber/red based on actual tool availability
- Recent runs widget shows last 5 agent run results with timestamp and pass/fail
- Quick Actions link to corresponding routes

---

### 1.7 Dashboard — Agent Execution Screens

| Field | Value |
|---|---|
| **PRD Ref** | PRD §8.4, FR-UI-001 through FR-UI-006 |
| **Status** | ❌ Missing |
| **Owner Repo** | Automate (web) |
| **Current Path** | — |
| **Proposed Path** | `apps/web/src/routes/agents/browser.tsx` · `apps/web/src/routes/agents/api.tsx` · `apps/web/src/routes/agents/load.tsx` · `apps/web/src/routes/agents/security.tsx` · `apps/web/src/routes/agents/test-generator.tsx` |
| **Effort** | L |

**What's missing:** All five agent execution screens (Browser, API, Load, Security, Test Generator). Automate web has chat + settings only. No split-pane input/output layout, no per-agent history, no live execution log via WebSocket, no artifact download buttons.

**Acceptance criteria:**
- Each agent screen has: input panel (prompt/spec, target URL, config), output panel (generated code, live log, pass/fail summary, AI narrative)
- WebSocket streams execution logs from `POST /agents/:domain/run`
- Copy-to-clipboard and download buttons for generated artifacts
- Per-agent run history list (last 10 runs)
- Re-run last configuration button

---

### 1.8 Dashboard — Settings

| Field | Value |
|---|---|
| **PRD Ref** | PRD §8.7 |
| **Status** | 🟡 Partial |
| **Owner Repo** | Automate (web) |
| **Current Path** | `apps/web/src/routes/settings.model.tsx` · `apps/web/src/routes/settings.connectors.tsx` · `apps/web/src/routes/settings.vault.tsx` |
| **Proposed Path** | `apps/web/src/routes/settings.tsx` (extend) |
| **Effort** | S |

**What exists:** Model config (provider, model, endpoint, temperature, maxTokens), connector management (GitHub, Jira, Slack, SQL), encrypted vault UI.

**What's missing per PRD settings spec:**
- Gemini API Key field (currently only Ollama-based; multi-provider UI not wired)
- Default LLM dropdown: Gemini 3.0 Pro / Claude 3.5 / Ollama
- Default Base URL for all agents
- Playwright Browser selector (Chromium/Firefox/WebKit)
- ZAP Scan Profile selector (Baseline/Full/API)
- Allure Results Path field
- Theme toggle (Dark/Light)

**Acceptance criteria:**
- Settings page renders all 8 PRD settings fields
- Changing LLM provider updates the model dropdown options dynamically
- Allure results path persists to server config

---

### 1.9 Allure Integration

| Field | Value |
|---|---|
| **PRD Ref** | PRD §5.2, §8.6, FR-BA-006, FR-AA-008, FR-SA-008, FR-MA-006 |
| **Status** | ❌ Missing |
| **Owner Repo** | Automate (server + web) |
| **Current Path** | — |
| **Proposed Path** | `docker/allure/` (Docker service) · `apps/server/src/services/allure-emitter.ts` · `apps/web/src/routes/reports/allure.tsx` |
| **Effort** | M |

**What's missing:** No Allure result emission from any agent. No Allure Docker service in compose file. No embedded Allure iframe in dashboard. The Automate has its own native result viewer (not Allure-based).

**Acceptance criteria:**
- Each agent emits `allure-results` JSON to `./results/<run_id>/allure/` after a test run
- `docker compose up` starts Allure at `localhost:4040`
- Dashboard Reports section embeds Allure at `localhost:4040` in an iframe
- "Open Full Screen" button launches Allure in a new tab

---

### 1.10 Bug Polisher AI Module

| Field | Value |
|---|---|
| **PRD Ref** | PRD §8.5 Bug Polisher |
| **Status** | ❌ Missing |
| **Owner Repo** | Automate (server + web) |
| **Current Path** | — |
| **Proposed Path** | `apps/server/src/routes/ai-tools.ts` · `apps/web/src/routes/tools/bug-polisher.tsx` |
| **Effort** | S |

**What's missing:** No dedicated Bug Polisher endpoint or UI. Automate's conversational AI could be prompted to do this ad-hoc, but there is no structured `POST /api/ai/tools/bug-polish` route with defined input/output schema, and no dedicated UI module.

**Acceptance criteria:**
- `POST /api/ai/tools/bug-polish` with `{ rawNotes: string }` returns `{ title, severity, steps, expected, actual, environment }` within 10 s
- UI: textarea input, structured output with one-click copy as Markdown and JIRA format
- Output format is JIRA-compatible: Title, Severity, Reproduce Steps, Expected vs Actual, Environment

---

### 1.11 Test Summary AI Module

| Field | Value |
|---|---|
| **PRD Ref** | PRD §8.5 Test Summary |
| **Status** | ❌ Missing |
| **Owner Repo** | Automate (server + web) |
| **Current Path** | — |
| **Proposed Path** | `apps/server/src/routes/ai-tools.ts` · `apps/web/src/routes/tools/test-summary.tsx` |
| **Effort** | S |

**What's missing:** No dedicated test summary generator. No route accepting run metrics and producing an executive paragraph.

**Acceptance criteria:**
- `POST /api/ai/tools/test-summary` with `{ total, passed, failed, blockers: string[], passRate: number }` returns `{ summary: string }` — an executive-level paragraph ≤ 150 words
- Suitable for sprint review / management reporting
- UI: input form for metrics, output paragraph with copy button

---

### 1.12 Docker Compose Stack (all services)

| Field | Value |
|---|---|
| **PRD Ref** | PRD §9 Docker Compose |
| **Status** | 🟡 Partial |
| **Owner Repo** | Both (root `docker-compose.yml` + per-product) |
| **Current Path** | `Automate/docker-compose.yml` · `Automate/docker-compose.yml` · `docker-compose.yml` (root) |
| **Proposed Path** | `docker-compose.yml` (root, extend with all Q-Ace services) |
| **Effort** | M |

**What exists:**
- Automate: `server` + `ollama` sidecar
- Automate: `server` + `nginx` optional profile
- Root `docker-compose.yml` exists (Nginx config present)

**What's missing per PRD §9.1:**
- `playwright` service (`mcr.microsoft.com/playwright:v1.50.0`) with volume mounts
- `zap` service (`ghcr.io/zaproxy/zaproxy:stable`) at port 8080
- `allure` service (`frankescobar/allure-docker-service`) at port 4040
- `influxdb` service at port 8086 with init config
- `grafana` service at port 3001 with provisioning volumes
- `k6` execution container (xk6 build)
- Startup sequence: InfluxDB → ZAP → Framework → Dashboard → Allure → Grafana
- Volume mounts: `./tools/playwright/`, `./tools/bruno/`, `./tools/k6/`, `./tools/zap/`, `./tools/maestro/`

**Acceptance criteria:**
- `docker compose up` from repo root starts all 8 services without manual intervention
- Framework API health endpoint (`GET /health`) reports green for all tools
- First-run: `docker compose up --build` completes within 5 minutes on clean machine

---

## 2. PRD P1 Capabilities

*From PRD §11 — target for MVP completion.*

### 2.1 Load Agent (k6) — AI script generation

| Field | Value |
|---|---|
| **PRD Ref** | FR-LA-001, FR-LA-002 |
| **Status** | ❌ Missing |
| **Owner Repo** | Automate |
| **Current Path** | — |
| **Proposed Path** | `apps/server/src/services/load-agent.ts` · `apps/server/src/routes/agents.ts` |
| **Effort** | M |

**What's missing:** No k6 integration. No load scenario → k6 script generation.

**Acceptance criteria:**
- `POST /agents/load/generate` with `{ scenario: "500 concurrent users on /checkout for 10 min with 2-min ramp-up" }` returns valid k6 `.js` script
- Generated script includes: stages (ramp-up, steady, ramp-down), thresholds, checks
- Script is syntactically valid JavaScript (parse with `node --check`)

---

### 2.2 Load Agent (k6) — Execute + AI narrative

| Field | Value |
|---|---|
| **PRD Ref** | FR-LA-003, FR-LA-004, FR-LA-005, FR-LA-006 |
| **Status** | ❌ Missing |
| **Owner Repo** | Automate |
| **Current Path** | — |
| **Proposed Path** | `apps/server/src/services/k6-runner.ts` |
| **Effort** | L |

**What's missing:** No k6 execution wrapper, no InfluxDB push, no SLA threshold breach detection, no AI narrative generation from k6 JSON results.

**Note:** Automate has k6-related scripts mentioned in root `perf/` directory — to be audited separately.

**Acceptance criteria:**
- `POST /agents/load/run` executes k6 script, pushes metrics to InfluxDB, returns unified result schema
- AI narrative includes p95/p99 values and SLA breach explanation
- Configurable thresholds: `p95 < Xms`, `error rate < Y%`
- `status: "failed"` returned when thresholds are breached

---

### 2.3 Grafana + InfluxDB Integration

| Field | Value |
|---|---|
| **PRD Ref** | PRD §5.2, §8.6, FR-LA-003 |
| **Status** | ❌ Missing |
| **Owner Repo** | Automate (web + docker) |
| **Current Path** | — |
| **Proposed Path** | `reporting/grafana/provisioning/` · `docker-compose.yml` (services) · `apps/web/src/routes/reports/grafana.tsx` |
| **Effort** | M |

**What's missing:** No Grafana or InfluxDB configuration in any docker-compose. No pre-provisioned k6 dashboard. No embedded Grafana iframe in Dashboard UI.

**Acceptance criteria:**
- `docker compose up` starts Grafana at `localhost:3001` and InfluxDB at `localhost:8086`
- Grafana boots with pre-provisioned k6 dashboard (no manual setup required)
- k6 run pushes real-time metrics; Grafana dashboard shows live data within 5 s
- Dashboard Reports section embeds Grafana iframe

---

### 2.4 Security Agent (OWASP ZAP) — Scan + AI Triage

| Field | Value |
|---|---|
| **PRD Ref** | FR-SA-001 through FR-SA-008 |
| **Status** | ❌ Missing |
| **Owner Repo** | Automate |
| **Current Path** | — |
| **Proposed Path** | `apps/server/src/services/security-agent.ts` · `apps/server/src/routes/agents.ts` · `tools/zap/` |
| **Effort** | L |

**What's missing:** No ZAP integration. No `POST /agents/security/scan`. No ZAP Automation Framework YAML plans. No AI triage of findings.

**Acceptance criteria:**
- `POST /agents/security/scan` with `{ targetUrl: string, profile: "baseline"|"full"|"api" }` triggers ZAP scan and returns structured findings
- Each HIGH/MEDIUM finding includes: Finding Title, CWE, OWASP Category, Evidence, Remediation
- AI triage: each finding marked `likelyFalsePositive: boolean`
- Summary: "X High, Y Medium, Z Low findings. Top priority: [finding]."
- ZAP service must be running (health check enforced)

---

### 2.5 Test Analyzer AI Module

| Field | Value |
|---|---|
| **PRD Ref** | PRD §8.5 Test Analyzer |
| **Status** | 🟡 Partial |
| **Owner Repo** | Automate (server + web) / Dashboard |
| **Current Path** | `Automate/apps/client/src/routes/analytics/` · `Automate/apps/server/src/routes/analytics.ts` |
| **Proposed Path** | `Automate/apps/server/src/routes/ai-tools.ts` · `Automate/apps/web/src/routes/tools/test-analyzer.tsx` |
| **Effort** | M |

**What exists:** Automate has analytics charts (pass-rate trends, duration charts, flaky leaderboard, failure heatmap). This covers visual analytics for Playwright test runs.

**What's missing per PRD spec:**
- Input: paste Allure results JSON or upload JUnit XML (not just live WebSocket data)
- AI narrative summary on top of uploaded results
- Failure categories analysis (not just charts)
- Cross-domain result analysis (Browser + API + Load together)

**Acceptance criteria:**
- `POST /api/ai/tools/analyze-tests` accepts `{ format: "allure"|"junit", data: string }` and returns `{ summary: string, failureCategories: Array<{name, count, percentage}>, aiNarrative: string }`
- UI: file upload or paste area; output includes charts and AI paragraph

---

### 2.6 Logic Auditor AI Module

| Field | Value |
|---|---|
| **PRD Ref** | PRD §8.5 Logic Auditor |
| **Status** | ❌ Missing |
| **Owner Repo** | Automate (server + web) |
| **Current Path** | — |
| **Proposed Path** | `apps/server/src/routes/ai-tools.ts` · `apps/web/src/routes/tools/logic-auditor.tsx` |
| **Effort** | S |

**What's missing:** No PRD/BRD analyzer. No contradiction detection or edge case flagging.

**Acceptance criteria:**
- `POST /api/ai/tools/logic-audit` with `{ spec: string }` returns `{ findings: Array<{type: "contradiction"|"edge-case"|"ambiguity", excerpt: string, description: string}> }`
- UI: markdown/text input, output as annotated list of findings with excerpt highlighting

---

### 2.7 STR Master AI Module

| Field | Value |
|---|---|
| **PRD Ref** | PRD §8.5 STR Master |
| **Status** | ❌ Missing |
| **Owner Repo** | Automate (server + web) |
| **Current Path** | — |
| **Proposed Path** | `apps/server/src/routes/ai-tools.ts` · `apps/web/src/routes/tools/str-master.tsx` |
| **Effort** | M |

**What's missing:** No STR generation or delta analysis.

**Acceptance criteria:**
- `POST /api/ai/tools/str-master` with `{ runs: Array<RunExport>, previousStr?: string }` returns `{ strDocument: string, deltaAnalysis: string }`
- Delta analysis identifies regressions and improvements between runs
- Output downloadable as Markdown

---

## 3. Framework API — Route Contract

*From PRD §7.3 — all Framework API endpoints.*

| Endpoint | PRD Spec | Status | Current Path | Notes |
|---|---|---|---|---|
| `POST /agents/browser/generate` | FR-BA-001/002 | ❌ Missing | — | Browser Agent NL→spec generation |
| `POST /agents/browser/run` | FR-BA-003/004/005 | ❌ Missing | — | Browser Agent execution |
| `POST /agents/api/generate` | FR-AA-001/002/003 | 🟡 Partial | `routes/openapi.ts` (`/api/openapi/generate-tests`) | Generates Vitest, not Bruno |
| `POST /agents/api/run` | FR-AA-005/006 | ❌ Missing | — | Bruno CLI execution |
| `POST /agents/load/generate` | FR-LA-001/002 | ❌ Missing | — | k6 script generation |
| `POST /agents/load/run` | FR-LA-003/004/005 | ❌ Missing | — | k6 execution + InfluxDB |
| `POST /agents/security/scan` | FR-SA-001 through 007 | ❌ Missing | — | ZAP scan + AI triage |
| `POST /agents/mobile/generate` | FR-MA-001/002 | ❌ Missing | — | Post-MVP; 501 acceptable |
| `POST /agents/mobile/run` | FR-MA-003/004/005 | ❌ Missing | — | Post-MVP; 501 acceptable |
| `POST /agents/generate` | FR-TG-001/005 | ❌ Missing | — | Cross-domain orchestrator |
| `GET /results/:run_id` | PRD §7.3 | ❌ Missing | — | Normalized run results |
| `GET /results` | PRD §7.3 | ❌ Missing | — | List all runs (agent history) |
| `GET /health` | PRD §7.3 + §10.3 | 🟡 Partial | `apps/server/src/routes/index.ts` (`/health`) | Shows DB+Ollama; missing per-tool health |

---

## 4. Unified Result Schema

| Field | Value |
|---|---|
| **PRD Ref** | PRD §7.4 |
| **Status** | ❌ Missing |
| **Owner Repo** | Automate (shared package) |
| **Current Path** | — |
| **Proposed Path** | `packages/shared/src/qace-result-schema.ts` |
| **Effort** | S |

**What exists:** `packages/shared/src/index.ts` exports Automate-specific schemas (conversation, message, model config). No cross-domain test result schema. `ModelConfigSchema.provider` is `z.enum(['ollama'])` (shared package), diverged from runtime which supports `ollama|openai|anthropic`.

**What's missing:** Zod v4 schema for:
```typescript
{ run_id, agent, status, started_at, duration_ms, summary: { total, passed, failed, skipped }, ai_narrative, tests: [...], artifacts: { allure_results_path, screenshots, raw_output_path } }
```

**Acceptance criteria:**
- `packages/shared/src/qace-result-schema.ts` exports `QaceResultSchema` and `QaceResult` type (Zod v4)
- All five agent runners emit a `QaceResult`-conformant object
- Schema exported from `@automate/shared` index
- 100% test coverage on schema (matches existing shared package standard)

---

## 5. Multi-Provider AI Support

| Field | Value |
|---|---|
| **PRD Ref** | PRD §8.7 Settings — "Default LLM: Gemini 3.0 Pro / Claude 3.5 / Ollama" |
| **Status** | 🟡 Partial |
| **Owner Repo** | Both |
| **Current Path** | `Automate/apps/server/src/agent/providers.ts` · `Automate/apps/server/src/services/ai-explain.ts` |
| **Proposed Path** | `Automate/apps/server/src/agent/provider-registry.ts` · `Automate/packages/shared/src/index.ts` (schema) |
| **Effort** | M |

**What exists:**
- Automate: `providers.ts` supports `ollama | openai | anthropic` via direct switch-case. `SUPPORTED_PROVIDERS = ['ollama', 'openai', 'anthropic']`.
- `ModelConfigSchema.provider` in shared package is `z.enum(['ollama'])` — diverged and incomplete.
- Dashboard `ai-explain.ts`: supports `openai | ollama | anthropic` via ad-hoc conditionals.

**What's missing per roadmap Workstream 2:**
- **Tier 1** (must ship): Google Gemini, Azure OpenAI
- **Tier 2** (OpenAI-compatible): Groq, Mistral, OpenRouter, Cohere
- **Tier 3** (feature-flagged): Amazon Bedrock
- Adapter registry pattern (`{ buildModel, validate }` per provider)
- Provider capabilities flags (tools, jsonMode, vision, streaming)
- `ModelConfigSchema.provider` in shared package updated to full enum
- Dynamic settings UI per provider

**Acceptance criteria:**
- `POST /api/model-config` with `{ provider: "google", model: "gemini-2.0-flash", ... }` succeeds (no `UnsupportedProviderError`)
- `provider-capabilities.ts` returns capability flags per provider
- All 5 Tier 1 providers have conformance tests
- Dashboard `ai-explain.ts` refactored to provider registry (same pattern)

---

## 6. Supporting Capabilities — Dashboard (Automate)

*These are PRD §8 capabilities that map to Automate as the "Q-Ace AI Dashboard" product.*

| Capability | PRD Ref | Status | Current Path | Notes |
|---|---|---|---|---|
| Live run monitoring via WebSocket | §8.4 FR-UI-002 | ✅ Exists | `services/reporter-bridge.ts` · `routes/ingest.ts` | Full real-time streaming |
| Run history list | §8.4 FR-UI-005 | ✅ Exists | `routes/runs.ts` · `client/src/routes/runs/index.tsx` | Playwright runs, not multi-domain |
| Analytics (pass-rate, trends, heatmap) | §8.3 | ✅ Exists | `routes/analytics.ts` · `client/src/routes/analytics/` | Playwright-specific |
| Auto-Quarantine (flaky detection) | §8 | ✅ Exists | `services/auto-quarantine.ts` · `routes/quarantine.ts` | Post-MVP, feature-flagged off by default |
| Quality Gates (CI/CD threshold) | §8 | ✅ Exists | `routes/gate.ts` | Pass-rate, duration, flaky thresholds |
| Run Comparison (side-by-side diff) | §8 | ✅ Exists | `routes/runs.ts` · `client/src/routes/runs/compare.tsx` | Full diff view |
| Error Clustering | §8 | ✅ Exists | `services/error-clustering.ts` · `routes/error-clustering.ts` | Post-MVP, feature-flagged off by default |
| Integrations (Slack, Jira, GitHub, GitLab, Teams, email) | §8 | ✅ Exists | `services/integrations/` (8 files) | Webhook notifications |
| Scheduled Runs | §8 | ✅ Exists | `routes/schedules.ts` · `services/scheduler.ts` | Post-MVP, feature-flagged off by default |
| Codegen Launcher | §8 | ✅ Exists | `routes/codegen.ts` · `client/src/routes/tools/codegen.tsx` | Post-MVP, feature-flagged off by default |
| NL Query | §8 | ✅ Exists | `services/nl-query.ts` · `routes/nl-query.ts` | Post-MVP, feature-flagged off by default |
| AI Explain (failure explanations) | §8 | ✅ Exists | `services/ai-explain.ts` | Post-MVP, feature-flagged off by default |
| Auth (API key + sessions) | §8.7 | ✅ Exists | `plugins/auth.ts` · `services/auth.ts` | httpOnly cookies, HMAC sessions |
| i18n (EN + HE + RTL) | — | ✅ Exists | `client/src/locales/` | Not in PRD scope but shipped |
| MCP Server | — | ✅ Exists | `mcp/` (25+ files) | Post-MVP, feature-flagged off by default |
| Baseline Management | — | ✅ Exists | `routes/baselines.ts` · `services/screenshot-diff.ts` | Post-MVP, feature-flagged off by default |
| PR Integration | — | ✅ Exists | `routes/pr-integration.ts` · `services/pr-comparison.ts` | GitHub PR comments |
| Allure iframe embed | PRD §8.6 | ❌ Missing | — | PRD wants Allure at :4040 |
| Grafana iframe embed | PRD §8.6 | ❌ Missing | — | PRD wants Grafana at :3001 |

---

## 7. AI Tools Modules — Inventory

*From PRD §8.5 — AI workspace modules in the Dashboard left nav.*

| Module | Status | Owner Repo | Current Path | Proposed Path | Effort |
|---|---|---|---|---|---|
| Bug Polisher | ❌ Missing | Automate | — | `routes/ai-tools.ts` + `web/routes/tools/bug-polisher.tsx` | S |
| Test Analyzer | 🟡 Partial | Dashboard + Automate | Dashboard `routes/analytics.ts` | `Automate/routes/ai-tools.ts` (upload flow) | M |
| Test Summary | ❌ Missing | Automate | — | `routes/ai-tools.ts` + `web/routes/tools/test-summary.tsx` | S |
| API Designer (OpenAPI → Bruno/Postman) | 🟡 Partial | Automate | `routes/openapi.ts` · `routes/postman.ts` | Add Bruno output + downloadable UI | M |
| Logic Auditor | ❌ Missing | Automate | — | `routes/ai-tools.ts` + `web/routes/tools/logic-auditor.tsx` | S |
| STR Master | ❌ Missing | Automate | — | `routes/ai-tools.ts` + `web/routes/tools/str-master.tsx` | M |
| Test Data Generator | ❌ Missing | Automate | — | `routes/ai-tools.ts` + `web/routes/tools/test-data-gen.tsx` | S |
| UI Inspector | ❌ Missing | Automate | — | `routes/ai-tools.ts` + `web/routes/tools/ui-inspector.tsx` | M |

---

## 8. Infrastructure & Non-Functional Requirements

| Capability | PRD Ref | Status | Notes |
|---|---|---|---|
| `docker compose up` → full stack | §9.1 | 🟡 Partial | Automate (server + Ollama) + Dashboard (server + nginx) exist. Missing ZAP, k6, Allure, Grafana, InfluxDB, Playwright container. |
| Health endpoint: tool availability | §10.3, §7.3 | 🟡 Partial | Automate `/health` shows DB + Ollama status only. Missing per-tool health (Playwright, Bruno, k6, ZAP). |
| Framework API response < 8s p95 (Gemini) | §10.1 | ❌ Missing | No performance baseline tracking. No automated p95 measurement. |
| Dashboard initial load < 2s | §10.1 | 🟡 Partial | No automated bundle size or load-time CI gate. Dashboard ships but no SLA enforcement. |
| k6 metrics visible in Grafana < 5s | §10.1 | ❌ Missing | Neither k6 nor Grafana exists. |
| Results persisted to filesystem on completion | §10.3 | 🟡 Partial | Dashboard persists to SQLite. Automate has conversation persistence. No unified `./results/<run_id>/` volume pattern. |
| `docker compose up` < 5 minutes (first run) | §10.4 | ❌ Not verified | Full stack not defined yet; cannot verify. |
| `.env.example` with all variables documented | §10.4 | ✅ Exists | Both products have documented `.env.example` files. |
| Makefile shortcuts (`make run`, `make test`, `make reset`) | §10.4 | ❌ Missing | No Makefile at repo root. |
| Generated test code sanitized before execution | §10.2 | ❌ Missing | No code sanitization layer. Code is passed directly to execution. |
| Production startup policy (fail-fast) | §10.2 | ✅ Exists | Dashboard: `services/startup-policy.ts`. Automate: `scripts/verify-prod-hardening.ts`. |
| Rate limiting | §10.2 | ✅ Exists | Both products: `@fastify/rate-limit` per-route. |
| Security headers (CSP, HSTS) | §10.2 | 🟡 Partial | Automate README mentions CSP. Not audited against actual inline scripts per roadmap §5.5. |

---

## 9. Agent Scaffold (Roadmap Workstream 3)

*These items are from roadmap Workstream 3 — PRD alignment scaffolds.*

| Item | Status | Proposed Path | Effort |
|---|---|---|---|
| Agent route scaffold (`POST /agents/:domain/generate` + `run`) | ❌ Missing | `Automate/apps/server/src/routes/agents.ts` | S |
| Agent registry service | ❌ Missing | `Automate/apps/server/src/services/agent-registry.ts` | S |
| Non-browser domains return `501 NOT_IMPLEMENTED` | ❌ Missing | `routes/agents.ts` | S |
| Q-Ace unified result schema (Zod v4) | ❌ Missing | `Automate/packages/shared/src/qace-result-schema.ts` | S |
| AI provider support matrix document | ❌ Missing | `docs/ai-provider-support-matrix.md` | S |

---

## 10. Post-MVP (Intentionally Deferred)

*From PRD §11 — out of scope. Listed for completeness; no effort estimate needed.*

| Feature | Status | Notes |
|---|---|---|
| Mobile Agent (Maestro) | 🟡 Scaffold only | Routes return `501` when agent scaffold ships; complex device requirement |
| Multi-user / team auth | ❌ Deferred | v2 scope |
| CI/CD integration (GitHub Actions trigger) | ❌ Deferred | v2 scope; Dashboard has webhook receivers but not trigger-from-CI |
| Playwright self-healing selectors | ❌ Deferred | `playwright-self-healing` npm package integration |
| Custom plugin system | ❌ Deferred | v2 scope |
| Cloud/SaaS tier | ❌ Deferred | After local MVP validated |
| Cross-product integration (Automate → Dashboard trigger) | ❌ Deferred | Roadmap §4.7; requires Dashboard connector in Automate |

---

## 11. Gap Summary by Domain

*PRD defines 5 QA domains. Current coverage:*

| Domain | Generate | Execute | AI Narrative | Result Schema | Status |
|---|---|---|---|---|---|
| **Browser (Playwright)** | 🟡 Vitest only (not E2E) | ❌ | ❌ | ❌ | 🟡 Partial |
| **API (Bruno)** | 🟡 Vitest/fetch (not Bruno) | ❌ | ❌ | ❌ | 🟡 Partial |
| **Load (k6)** | ❌ | ❌ | ❌ | ❌ | ❌ Missing |
| **Security (ZAP)** | ❌ | ❌ | ❌ | ❌ | ❌ Missing |
| **Mobile (Maestro)** | ❌ | ❌ | ❌ | ❌ | ❌ Post-MVP |

---

## 12. Priority Implementation Order

*Based on PRD P0 > P1 ordering and cross-item dependencies.*

| Phase | Item | Blocked By | Effort |
|---|---|---|---|
| **1 — Foundation** | Unified result schema | Nothing | S |
| **1 — Foundation** | Agent route scaffold (501s) | Nothing | S |
| **1 — Foundation** | Health endpoint per-tool | Nothing | S |
| **2 — Browser Domain** | Browser Agent: AI generation | Agent scaffold | L |
| **2 — Browser Domain** | Browser Agent: Playwright execution | Agent scaffold + result schema | L |
| **2 — Browser Domain** | Allure emitter service | Agent scaffold | M |
| **3 — API Domain** | API Agent: Bruno generation (from OpenAPI) | Agent scaffold | L |
| **3 — API Domain** | API Agent: Bruno execution | Agent scaffold + result schema | M |
| **4 — AI Tools** | Bug Polisher UI/route | Nothing | S |
| **4 — AI Tools** | Test Summary UI/route | Nothing | S |
| **4 — AI Tools** | Logic Auditor UI/route | Nothing | S |
| **5 — Dashboard UI** | Home panel (system health, run summary) | Health endpoint | M |
| **5 — Dashboard UI** | Agent execution screens | Browser + API agent routes | L |
| **5 — Dashboard UI** | Settings extension (Playwright, ZAP, Allure fields) | Agent routes | S |
| **6 — Docker** | Add ZAP + Allure + InfluxDB + Grafana to compose | All above | M |
| **7 — P1 Domains** | Load Agent (k6) generate + execute | Docker (InfluxDB) | L |
| **7 — P1 Domains** | Security Agent (ZAP) scan + triage | Docker (ZAP) | L |
| **7 — P1 Domains** | Grafana iframe embed | Load Agent | M |
| **8 — P1 AI Tools** | Test Analyzer (upload flow + AI) | Result schema | M |
| **8 — P1 AI Tools** | STR Master | Nothing | M |
| **9 — Multi-Provider** | Google Gemini + Azure adapter | Adapter registry | M |

---

*Last updated: 2026-04-16 · Next review: when Workstream 3 (PRD Alignment) is scheduled*
