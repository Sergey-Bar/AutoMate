# Product Requirements Document (PRD)
## Q-Ace Ecosystem — AI-Orchestrated QA Platform

**Version:** 2.0
**Status:** Draft
**Date:** March 2026
**Owner:** Q-Ace Product Team
**Scope:** Q-Ace Framework + Q-Ace AI Dashboard (MVP)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Vision & Strategic Bet](#2-vision--strategic-bet)
3. [Problem Statement](#3-problem-statement)
4. [Target Audience & Personas](#4-target-audience--personas)
5. [Open-Source Integration Strategy](#5-open-source-integration-strategy)
6. [Product Architecture — Monorepo Overview](#6-product-architecture--monorepo-overview)
7. [Product 1 — Q-Ace Framework](#7-product-1--q-ace-framework)
8. [Product 2 — Q-Ace AI Dashboard](#8-product-2--q-ace-ai-dashboard)
9. [Docker Compose — Local Deployment Spec](#9-docker-compose--local-deployment-spec)
10. [Non-Functional Requirements](#10-non-functional-requirements)
11. [MVP Scope vs. Post-MVP](#11-mvp-scope-vs-post-mvp)
12. [Milestones & Roadmap](#12-milestones--roadmap)
13. [Success Metrics (KPIs)](#13-success-metrics-kpis)
14. [Risks & Mitigations](#14-risks--mitigations)
15. [Open Questions](#15-open-questions)

---

## 1. Executive Summary

**Q-Ace** is an AI-native, locally-deployable QA platform that combines the best open-source testing tools into a single monorepo, orchestrated by AI agents and surfaced through a polished dashboard.

Rather than building yet another test runner from scratch, Q-Ace takes a **"glue + intelligence"** approach: embed proven open-source engines (Playwright, k6, OWASP ZAP, Appium, Bruno) into a unified platform, then wrap them with Gemini-powered AI agents that can generate tests, analyze results, and produce reports — all from natural language.

The result: a single `docker compose up` command spins up a complete, production-grade QA platform covering **all five testing domains** — Web/E2E, API, Performance/Load, Security, and Mobile.

**The core thesis:** No single open-source tool covers all QA domains. No AI tool is grounded in real, local execution. Q-Ace is both.

---

## 2. Vision & Strategic Bet

**Vision:**
The definitive open-source QA platform — where AI orchestrates every testing domain from a single local environment.

**Strategic Bet:**
The QA tool market is fragmented. Teams run 5–7 separate tools with no unified intelligence layer. The winner won't be the team that builds the best test runner — it'll be the team that builds the best **AI orchestration layer** on top of the tools that already won their domains.

**Positioning:**

| Dimension | Q-Ace | KaneAI | Playwright standalone | Postman |
|---|---|---|---|---|
| All QA domains | ✅ | Partial | ❌ (browser only) | ❌ (API only) |
| AI-generated tests | ✅ | ✅ | ❌ | ❌ |
| Local / self-hosted | ✅ | ❌ (cloud) | ✅ | Partial |
| Open source | ✅ | ❌ | ✅ | ❌ |
| Unified dashboard | ✅ | ✅ | ❌ | Partial |
| No vendor lock-in | ✅ | ❌ | ✅ | ❌ |

---

## 3. Problem Statement

### 3.1 Tool Fragmentation

A typical QA engineer's daily stack in 2026:
- **Playwright/Cypress** → E2E browser tests
- **Postman/Bruno** → API testing
- **k6/JMeter** → Load testing
- **OWASP ZAP/Burp** → Security scanning
- **Appium/Maestro** → Mobile testing
- **Excel/Confluence** → Test reporting
- **JIRA** → Bug tracking
- **ChatGPT** → Ad-hoc test generation

Each tool has its own config format, result schema, reporting UI, and learning curve. There is no single pane of glass. There is no AI layer that understands the results across all these tools together.

### 3.2 AI Tools Are Disconnected from Execution

Current AI QA tools (KaneAI, Copilot for tests) generate code but don't run it locally. They're cloud-only, expensive, and can't access internal environments. QA engineers end up copy-pasting AI suggestions into their local setup manually.

### 3.3 The Gap Q-Ace Fills

> "A QA engineer should be able to describe what they want to test in plain English, get working tests across every domain, execute them locally, and receive an intelligent report — without touching 7 different tools."

---

## 4. Target Audience & Personas

### Persona 1 — Maya, QA Automation Engineer
- 4 years experience, works at a fintech startup
- Runs Playwright + Postman today; k6 when asked by management
- Pain: Each sprint she manually writes the same types of tests for new features
- Goal: Generate a full test suite (E2E + API + load) from a spec doc in minutes
- **Primary surface:** Q-Ace Framework CLI + AI Dashboard

### Persona 2 — David, QA Tech Lead
- 8 years experience, manages a team of 6
- Owns CI/CD pipeline; reports to CTO on test health
- Pain: Gets inconsistent reports from team; no way to see cross-domain test health in one view
- Goal: Executive dashboard, one-click STR generation, team-wide test result aggregation
- **Primary surface:** Q-Ace AI Dashboard

### Persona 3 — Ran, DevOps / Platform Engineer
- Manages Docker-based infrastructure; QA is a consumer of his platform
- Pain: Every QA tool needs its own setup, credentials, and maintenance
- Goal: One `docker compose up` that gives the whole QA team a working environment
- **Primary surface:** Docker Compose deployment, config files

---

## 5. Open-Source Integration Strategy

### 5.1 Philosophy: Embed, Don't Wrap

Q-Ace embeds open-source tools **directly into the monorepo** as first-class citizens, not as external dependencies called over a network. Each tool runs as its own Docker service, exposes a local API/CLI interface, and Q-Ace agents interact with it programmatically.

This means:
- No internet required after initial setup
- Results stay local (privacy-first)
- Full control over tool versions
- AI agents can read raw output files directly

### 5.2 Tool Selection Matrix

| Domain | Chosen Tool | Why This Tool | License | Alternative Considered |
|---|---|---|---|---|
| **Web / E2E** | [Playwright](https://playwright.dev) | Industry standard, multi-browser, headless, MCP support | Apache 2.0 | Cypress (slower, browser-only) |
| **API Testing** | [Bruno](https://www.usebruno.com) | Git-native, no cloud, Postman-compatible import, fast | MIT | Hoppscotch (requires backend) |
| **Performance / Load** | [k6](https://k6.io) | Modern JS syntax, Grafana integration, CI-friendly | AGPL 3.0 | Locust (Python, less CI-native) |
| **Security** | [OWASP ZAP](https://www.zaproxy.org) | Gold standard DAST scanner, automation API | Apache 2.0 | Nuclei (faster but less deep) |
| **Mobile** | [Maestro](https://maestro.mobile.dev) | Simplest YAML-based mobile automation, no Appium complexity | Apache 2.0 | Appium (too complex for MVP) |
| **Reporting** | [Allure Report](https://allurereport.org) | Beautiful, multi-framework, widely adopted | Apache 2.0 | Playwright HTML reporter (too basic) |
| **Metrics / Viz** | [Grafana + InfluxDB](https://grafana.com) | k6 native integration, real-time dashboards | AGPL 3.0 | Prometheus (less k6-native) |

### 5.3 How Q-Ace Adds Value on Top

```
Open-Source Tool     →    What Q-Ace Adds
─────────────────────────────────────────────────────────
Playwright           →    AI generates .spec.ts from natural language / spec doc
Bruno                →    AI generates .bru collections from OpenAPI or description
k6                   →    AI writes k6 scripts; interprets p95/p99 results in plain English
OWASP ZAP            →    AI triage: filters false positives; prioritizes real CVEs
Maestro              →    AI generates .yaml flows from screen description
Allure               →    AI generates executive narrative summary on top of Allure data
Grafana              →    Pre-configured k6 dashboard; auto-provisioned on startup
```

---

## 6. Product Architecture — Monorepo Overview

### 6.1 Monorepo Structure

```
q-ace/
├── apps/
│   ├── framework/          # Q-Ace Framework — agent orchestrator (FastAPI)
│   └── dashboard/          # Q-Ace AI Dashboard — React frontend
├── agents/
│   ├── browser-agent/      # Playwright wrapper + AI test generator
│   ├── api-agent/          # Bruno wrapper + AI collection generator
│   ├── load-agent/         # k6 wrapper + AI script generator
│   ├── security-agent/     # OWASP ZAP wrapper + AI triage
│   └── mobile-agent/       # Maestro wrapper + AI flow generator
├── tools/
│   ├── playwright/         # Playwright config + base fixtures
│   ├── bruno/              # Bruno collections root
│   ├── k6/                 # k6 scripts root
│   ├── zap/                # ZAP config + scan profiles
│   └── maestro/            # Maestro flow definitions
├── reporting/
│   ├── allure/             # Allure results aggregation
│   └── grafana/            # Pre-provisioned Grafana dashboards + InfluxDB config
├── shared/
│   ├── llm/                # LLM client (Gemini / Ollama adapter)
│   ├── schemas/            # Shared result schemas (JSON)
│   └── config/             # Global config (env vars, tool paths)
├── docker/
│   ├── docker-compose.yml  # Full local stack
│   └── Dockerfile.*        # Per-service Dockerfiles
└── docs/                   # Documentation site (Docusaurus)
```

### 6.2 System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Q-ACE ECOSYSTEM (Docker Compose)             │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │                  Q-Ace AI Dashboard (React)                │     │
│  │         Port 3000 — Gemini-powered QA workspace            │     │
│  └──────────────────────────┬─────────────────────────────────┘     │
│                             │ REST API                              │
│  ┌──────────────────────────▼─────────────────────────────────┐     │
│  │              Q-Ace Framework (FastAPI)  :8000               │     │
│  │           Agent Orchestrator + Result Aggregator            │     │
│  └──┬──────────┬──────────┬──────────┬──────────┬─────────────┘     │
│     │          │          │          │          │                    │
│  ┌──▼──┐  ┌───▼──┐  ┌────▼──┐  ┌───▼──┐  ┌───▼──┐                 │
│  │     │  │      │  │       │  │      │  │      │                  │
│  │  🎭  │  │  📦  │  │  ⚡   │  │  🛡️  │  │  📱  │                  │
│  │Play- │  │Bruno │  │  k6   │  │ ZAP  │  │Maest-│                  │
│  │wright│  │      │  │       │  │      │  │  ro  │                  │
│  │:9323 │  │:CLI  │  │:6565  │  │:8080 │  │:CLI  │                  │
│  └──────┘  └──────┘  └───────┘  └──────┘  └──────┘                 │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │         Reporting Layer                                  │       │
│  │   Allure :4040  │  Grafana :3001  │  InfluxDB :8086      │       │
│  └──────────────────────────────────────────────────────────┘       │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │         LLM Backend (configurable)                       │       │
│  │   Gemini API (default)  │  Ollama :11434 (local option)  │       │
│  └──────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. Product 1 — Q-Ace Framework

### 7.1 Overview

Q-Ace Framework is the **AI orchestration backend** — a FastAPI service that receives natural-language or structured requests, delegates to the appropriate agent, triggers the underlying open-source tool, collects results, and normalizes them into a unified schema.

It is also the **CLI entrypoint** for power users who don't need the dashboard.

### 7.2 Agent Specifications

---

#### 7.2.1 Browser Agent (Playwright)

**Purpose:** Generate and execute browser-based E2E tests using natural language or spec input.

**AI Capability:**
- Accept a feature description or spec URL → generate `.spec.ts` Playwright test file
- Accept a user story → generate step-by-step browser interactions with assertions
- Self-healing selector hints: if a test fails due to selector mismatch, suggest alternative selectors

**Underlying Tool:** Playwright v1.x
**Execution:** `playwright test` inside Docker
**Results:** JUnit XML + Playwright HTML report + Allure-compatible JSON

**Functional Requirements:**
- FR-BA-001: Accept natural language prompt OR spec document (Markdown/URL)
- FR-BA-002: Generate `.spec.ts` file with `test()` blocks, locators, and assertions
- FR-BA-003: Execute against configurable base URL
- FR-BA-004: Support Chromium, Firefox, WebKit targets
- FR-BA-005: On failure — capture screenshot + page DOM snapshot
- FR-BA-006: Emit Allure-compatible result JSON
- FR-BA-007: Return structured pass/fail/error report to Framework API
- FR-BA-008: Support parametrized test data via JSON fixture input

---

#### 7.2.2 API Agent (Bruno)

**Purpose:** Generate and execute REST/GraphQL API test collections.

**AI Capability:**
- Accept OpenAPI spec (JSON/YAML) → generate Bruno `.bru` collection
- Accept plain description (e.g., "test login endpoint with valid and invalid credentials") → generate test cases
- Interpret response bodies and suggest assertions automatically

**Underlying Tool:** Bruno CLI (`bru run`)
**Results:** Bruno JSON output → normalized to unified schema

**Functional Requirements:**
- FR-AA-001: Accept OpenAPI 3.x spec file or URL
- FR-AA-002: Accept free-text API description
- FR-AA-003: Generate Bruno collection with: happy path, error cases, boundary tests
- FR-AA-004: Support environment variables (base URL, auth tokens) via `.env` file
- FR-AA-005: Execute `bru run` against target environment
- FR-AA-006: Parse Bruno output and normalize to Q-Ace result schema
- FR-AA-007: Support Postman collection import (convert to Bruno format)
- FR-AA-008: Emit Allure-compatible result JSON

---

#### 7.2.3 Load Agent (k6)

**Purpose:** Generate and execute performance/load test scripts, visualize results in Grafana.

**AI Capability:**
- Accept test scenario description (e.g., "simulate 500 concurrent users on `/checkout` for 10 minutes with a 2-minute ramp-up") → generate k6 `.js` script
- After test run: interpret p95/p99 latency, error rates, and throughput in plain English narrative
- Flag SLA violations automatically

**Underlying Tool:** k6 v0.5x
**Results:** k6 JSON output + InfluxDB time-series + Grafana dashboard

**Functional Requirements:**
- FR-LA-001: Accept load scenario in natural language
- FR-LA-002: Generate k6 script with: stages (ramp-up, steady, ramp-down), thresholds, checks
- FR-LA-003: Push results to InfluxDB during run (real-time Grafana visibility)
- FR-LA-004: Detect SLA threshold breaches (configurable: p95 < Xms, error rate < Y%)
- FR-LA-005: Generate AI narrative: "Peak load reached 520 VU. p95 latency was 1.2s — 20% above the 1s threshold. Errors spiked at minute 7, correlating with DB connection pool exhaustion."
- FR-LA-006: Export summary PDF (Grafana snapshot)
- FR-LA-007: Support custom k6 extensions via xk6 build in Docker

---

#### 7.2.4 Security Agent (OWASP ZAP)

**Purpose:** Run DAST security scans against a target URL, triage results with AI.

**AI Capability:**
- Given a target URL → configure and execute ZAP baseline or full scan
- Post-scan: AI triage of findings — filter noise, classify real vs. false positive, prioritize by exploitability
- Generate developer-friendly remediation notes per finding

**Underlying Tool:** OWASP ZAP 2.x (Docker image: `ghcr.io/zaproxy/zaproxy:stable`)
**Results:** ZAP JSON/HTML report → AI-triaged finding list

**Functional Requirements:**
- FR-SA-001: Accept target URL + scan profile (Baseline / Full / API)
- FR-SA-002: Execute ZAP scan via ZAP Automation Framework (YAML plan)
- FR-SA-003: Parse ZAP JSON results (alerts, risk levels, CWE IDs)
- FR-SA-004: AI triage: for each HIGH/MEDIUM finding, assess likelihood of false positive
- FR-SA-005: Generate structured security report: Finding Title, CWE, OWASP Category, Evidence, Remediation
- FR-SA-006: Output summary: "X High, Y Medium, Z Low findings. Z findings likely false positives. Top priority: SQL Injection at /api/users (CWE-89)."
- FR-SA-007: Support authenticated scans via session config (cookie / Bearer token)
- FR-SA-008: Emit Allure-compatible result JSON

---

#### 7.2.5 Mobile Agent (Maestro)

**Purpose:** Generate and execute mobile UI automation flows for iOS and Android.

**AI Capability:**
- Accept screen description or user story → generate Maestro YAML flow
- Accept screenshot of app screen → identify interactive elements and generate tap/input steps

**Underlying Tool:** Maestro CLI
**Target:** Android emulator (local) / iOS simulator (macOS host only)

**Functional Requirements:**
- FR-MA-001: Accept natural language user flow description
- FR-MA-002: Generate Maestro YAML flow with: launchApp, tapOn, inputText, assertVisible, scrollUntilVisible
- FR-MA-003: Execute `maestro test` against connected device/emulator
- FR-MA-004: Capture screenshots at each step
- FR-MA-005: Return pass/fail per step with screenshots
- FR-MA-006: Emit Allure-compatible result JSON
- FR-MA-007: Support app bundle ID configuration per project

---

#### 7.2.6 Test Generator Agent (Cross-Domain)

**Purpose:** The meta-agent — accepts a spec document and orchestrates multiple agents to produce a comprehensive test suite across all relevant domains.

**Functional Requirements:**
- FR-TG-001: Accept spec input (Markdown file, URL, or alm-spec format)
- FR-TG-002: AI analyzes spec → determines which domains apply (E2E? API? Load? Security?)
- FR-TG-003: Fan-out to relevant agents and collect generated test artifacts
- FR-TG-004: Present unified test plan with: test count per domain, coverage estimate, suggested execution order
- FR-TG-005: Allow user to select subset of domains before execution

---

### 7.3 Framework API Specification

Base URL: `http://localhost:8000`

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/agents/browser/generate` | Generate Playwright tests from prompt |
| `POST` | `/agents/browser/run` | Execute existing Playwright spec |
| `POST` | `/agents/api/generate` | Generate Bruno collection |
| `POST` | `/agents/api/run` | Execute Bruno collection |
| `POST` | `/agents/load/generate` | Generate k6 script |
| `POST` | `/agents/load/run` | Execute k6 script |
| `POST` | `/agents/security/scan` | Run ZAP scan + AI triage |
| `POST` | `/agents/mobile/generate` | Generate Maestro flow |
| `POST` | `/agents/mobile/run` | Execute Maestro flow |
| `POST` | `/agents/generate` | Test Generator (cross-domain) |
| `GET`  | `/results/{run_id}` | Get normalized results for a run |
| `GET`  | `/results` | List all past runs |
| `GET`  | `/health` | Health check + tool availability |

### 7.4 Unified Result Schema

Every agent emits results in a normalized JSON schema:

```json
{
  "run_id": "uuid",
  "agent": "browser | api | load | security | mobile",
  "status": "passed | failed | error",
  "started_at": "ISO8601",
  "duration_ms": 4200,
  "summary": {
    "total": 24,
    "passed": 22,
    "failed": 2,
    "skipped": 0
  },
  "ai_narrative": "22 of 24 tests passed...",
  "tests": [ { "id": "...", "name": "...", "status": "...", "duration_ms": 120 } ],
  "artifacts": {
    "allure_results_path": "/results/uuid/allure",
    "screenshots": ["/results/uuid/screenshots/fail_01.png"],
    "raw_output_path": "/results/uuid/raw.json"
  }
}
```

---

## 8. Product 2 — Q-Ace AI Dashboard

### 8.1 Overview

Q-Ace AI Dashboard is a **React web application** (served at `localhost:3000`) that provides a GUI for the Framework API and adds a layer of AI-powered QA workflow tools — powered by Gemini 3.0 Pro.

It serves two roles:
1. **Execution UI** — trigger agents, view live results, browse Allure reports and Grafana dashboards
2. **AI Workspace** — standalone AI tools for bug polishing, test analysis, STR generation, etc.

### 8.2 Navigation Structure

```
Left Sidebar
├── 🏠 Home
├── ── TESTING ──
├── 🎭 Browser Agent
├── 📦 API Agent
├── ⚡ Load Agent
├── 🛡️ Security Agent
├── 📱 Mobile Agent
├── 🧪 Test Generator (cross-domain)
├── ── AI TOOLS ──
├── 🐛 Bug Polisher
├── 📊 Test Analyzer
├── 📄 Test Summary
├── 🔌 API Designer
├── 🧠 Logic Auditor
├── 🏆 STR Master
├── 🎲 Test Data Gen
├── 👁️ UI Inspector
├── ── REPORTS ──
├── 📋 Allure Report (embedded iframe)
├── 📈 Grafana (embedded iframe)
└── ── CONFIG ──
    ├── ⚙️ Settings
    └── 🕑 History
```

### 8.3 Home Dashboard

**Hero Panel:**
- "Welcome to Q-Ace" banner with active model badge (Gemini 3.0 Pro)
- System health: green/red indicators per tool (Playwright ✅, Bruno ✅, k6 ✅, ZAP ✅, Maestro ✅)
- Last run summary: X tests run today, Y passed, Z failed

**Recent Runs Widget:**
- Last 5 test runs across all agents with status, timestamp, and link to Allure

**Quick Actions:**
- "Run Full Suite" — triggers Test Generator with last config
- "Polish a Bug" — opens Bug Polisher with empty input
- "Open Allure" — opens embedded Allure iframe

### 8.4 Agent Execution Screens (per agent)

Each agent screen follows a consistent layout:

```
┌──────────────────────────────┬─────────────────────────────────────┐
│  INPUT PANEL                 │  OUTPUT PANEL                       │
│                              │                                     │
│  • Prompt / spec input       │  • AI-generated artifact preview    │
│  • Target URL                │    (test code, script, YAML)        │
│  • Configuration options     │                                     │
│  • [Generate] button         │  • [Run] button                     │
│                              │                                     │
│                              │  • Live execution log               │
│                              │  • Pass/Fail summary                │
│                              │  • AI narrative                     │
│                              │  • Link to full Allure report       │
└──────────────────────────────┴─────────────────────────────────────┘
```

**Functional Requirements (shared across all agent screens):**
- FR-UI-001: Split-pane layout — input left, output right
- FR-UI-002: Real-time execution log via WebSocket streaming
- FR-UI-003: Copy generated code/config to clipboard
- FR-UI-004: Download generated artifact (`.spec.ts`, `.bru`, `.js`, `.yaml`)
- FR-UI-005: Run history per agent — list of past runs with status
- FR-UI-006: Ability to re-run last configuration

### 8.5 AI Tools Modules

#### Bug Polisher
- Input: raw bug notes (free text)
- Output: JIRA-ready bug report (Title, Severity, Reproduce Steps, Expected vs Actual, Environment)
- One-click copy as Markdown or JIRA format

#### Test Analyzer
- Input: paste Allure results JSON or upload JUnit XML
- Output: visual charts (pass/fail distribution, failure categories, trend), AI narrative summary

#### Test Summary
- Input: test run metrics (totals, pass rate, blockers)
- Output: executive-level paragraph summary suitable for sprint review / management report

#### API Designer
- Input: OpenAPI spec (JSON/YAML)
- Output: Bruno collection file (downloadable) + Postman collection (downloadable)

#### Logic Auditor
- Input: PRD / BRD / user story (text or .md file)
- Output: flagged list of contradictions, missing edge cases, ambiguous requirements

#### STR Master
- Input: multiple test run exports or STR documents
- Output: consolidated Software Test Report with delta analysis between runs

#### Test Data Generator
- Input: schema description (e.g., "user profile: name, email, age, phone — include edge cases")
- Output: JSON/CSV dataset with boundary values, nulls, special characters, unicode

#### UI Inspector
- Input: screenshot (upload) or URL (live capture)
- Output: list of detected issues (accessibility violations, contrast problems, alignment issues, missing alt text)

### 8.6 Reports Section

**Allure Report (embedded):**
- Allure server runs at `localhost:4040`
- Dashboard embeds it in an iframe panel
- "Open Full Screen" button

**Grafana (embedded):**
- Grafana runs at `localhost:3001`
- Pre-provisioned k6 dashboard auto-loaded
- Dashboard embeds in iframe panel

### 8.7 Settings

| Setting | Type | Description |
|---|---|---|
| Gemini API Key | Password input | Stored in `.env`, never sent to frontend |
| Default LLM | Dropdown | Gemini 3.0 Pro / Claude 3.5 / Ollama (local) |
| Ollama Model | Text | e.g., `qwen2.5-coder:14b` |
| Default Base URL | Text | Target app URL for all agents |
| Playwright Browser | Dropdown | Chromium / Firefox / WebKit |
| ZAP Scan Profile | Dropdown | Baseline / Full / API |
| Allure Results Path | Text | `/results/allure` (default) |
| Theme | Toggle | Dark / Light |

---

## 9. Docker Compose — Local Deployment Spec

### 9.1 Services

```yaml
# docker-compose.yml (abbreviated)
services:

  # ─── Core ───────────────────────────────────────────────
  framework:
    build: ./apps/framework
    ports: ["8000:8000"]
    volumes:
      - ./results:/results
      - ./tools:/tools
      - ./.env:/app/.env
    depends_on: [zap, influxdb]

  dashboard:
    build: ./apps/dashboard
    ports: ["3000:3000"]
    depends_on: [framework]

  # ─── Test Tools ─────────────────────────────────────────
  playwright:
    image: mcr.microsoft.com/playwright:v1.50.0
    volumes: ["./tools/playwright:/tests", "./results:/results"]
    network_mode: host

  zap:
    image: ghcr.io/zaproxy/zaproxy:stable
    ports: ["8080:8080"]
    command: zap.sh -daemon -host 0.0.0.0 -port 8080

  # ─── Reporting ──────────────────────────────────────────
  allure:
    image: frankescobar/allure-docker-service:latest
    ports: ["4040:5050"]
    volumes: ["./results/allure:/app/allure-results"]

  influxdb:
    image: influxdb:2.7
    ports: ["8086:8086"]
    environment:
      DOCKER_INFLUXDB_INIT_MODE: setup
      DOCKER_INFLUXDB_INIT_ORG: q-ace
      DOCKER_INFLUXDB_INIT_BUCKET: k6

  grafana:
    image: grafana/grafana:latest
    ports: ["3001:3000"]
    volumes: ["./reporting/grafana/provisioning:/etc/grafana/provisioning"]
    depends_on: [influxdb]
```

### 9.2 Startup Sequence

```
docker compose up
  └─► InfluxDB (data layer)
  └─► ZAP (security scanner daemon)
  └─► Framework API :8000  ← depends on ZAP + InfluxDB
  └─► Dashboard :3000      ← depends on Framework
  └─► Allure :4040
  └─► Grafana :3001        ← depends on InfluxDB
```

**First-run setup:**
```bash
cp .env.example .env
# Set GEMINI_API_KEY in .env
docker compose up --build
# Open http://localhost:3000
```

### 9.3 Volume Strategy

| Volume | Purpose |
|---|---|
| `./results/` | All test run outputs (Allure JSON, screenshots, raw logs) |
| `./tools/playwright/` | Playwright spec files (generated + custom) |
| `./tools/bruno/` | Bruno collections (generated + custom) |
| `./tools/k6/` | k6 scripts (generated + custom) |
| `./tools/zap/` | ZAP automation plans and scan configs |
| `./tools/maestro/` | Maestro YAML flows (generated + custom) |

All volumes are bind-mounted to the host, so results and generated tests persist between runs and are editable with any local editor.

---

## 10. Non-Functional Requirements

### 10.1 Performance

| Metric | Target |
|---|---|
| Framework API response (generate request) | < 8s p95 (Gemini) / < 15s (Ollama 14B) |
| Dashboard initial load | < 2s |
| Playwright test execution start | < 5s from request |
| k6 metrics visible in Grafana | < 5s latency |
| Allure report generation | < 10s for 100 tests |

### 10.2 Security

- All services bound to `localhost` only — no external exposure by default
- Gemini API key stored in `.env` (never in frontend bundle or Git)
- ZAP accessible only to Framework service (not exposed to public port in production mode)
- Generated test files sanitized before execution (no code injection via AI output)

### 10.3 Reliability

- Framework API: health endpoint polls all tool services; dashboard shows degraded state if any tool is down
- Each agent has independent failure scope — ZAP being down does not affect Playwright tests
- Results are persisted to filesystem on run completion — not lost if service restarts

### 10.4 Developer Experience

- `docker compose up` → fully working stack in < 5 minutes
- All generated artifacts editable in local IDE (no lock-in to Q-Ace UI)
- `.env.example` with every variable documented
- Makefile shortcuts: `make run`, `make test`, `make reset`

---

## 11. MVP Scope vs. Post-MVP

### MVP (v1.0) — In Scope

| Feature | Priority |
|---|---|
| Browser Agent (Playwright) — generate + run | P0 |
| API Agent (Bruno) — generate + run | P0 |
| Test Generator Agent (cross-domain) | P0 |
| Dashboard: Home, Agent screens, Settings | P0 |
| Allure integration | P0 |
| Bug Polisher AI module | P0 |
| Test Summary AI module | P0 |
| Docker Compose stack (all services) | P0 |
| Load Agent (k6) — generate + run | P1 |
| Grafana + InfluxDB integration | P1 |
| Security Agent (ZAP) — baseline scan + triage | P1 |
| Test Analyzer AI module | P1 |
| Logic Auditor AI module | P1 |
| STR Master AI module | P1 |

### Post-MVP (v2.0+) — Out of Scope

| Feature | Notes |
|---|---|
| Mobile Agent (Maestro) | Requires device/emulator — deferred |
| Multi-user / team auth | v2: user accounts, shared history |
| CI/CD integration (GitHub Actions, GitLab) | v2: auto-trigger on PR |
| Playwright self-healing selectors | Integrate `playwright-self-healing` npm package |
| Custom plugin system | Allow community agents |
| Cloud/SaaS tier | After local MVP validated |
| Ollama local LLM support | v1.5: config option |

---

## 12. Milestones & Roadmap

### Phase 0 — Foundation (Week 1–2)
- [ ] Monorepo scaffold (nx / turborepo)
- [ ] Docker Compose with all services (no AI yet)
- [ ] Framework API skeleton (FastAPI)
- [ ] Dashboard skeleton (React + routing)
- [ ] Playwright + Bruno executing manually (no AI generation yet)

### Phase 1 — MVP Core (Week 3–6)
- [ ] Browser Agent: AI generation (Gemini → .spec.ts) + execution
- [ ] API Agent: AI generation (Gemini → Bruno collection) + execution
- [ ] Test Generator Agent (cross-domain orchestrator)
- [ ] Allure integration + embedded in Dashboard
- [ ] Bug Polisher + Test Summary AI modules live

### Phase 2 — Full Coverage (Week 7–10)
- [ ] Load Agent: k6 generation + execution + Grafana dashboard
- [ ] Security Agent: ZAP scan + AI triage
- [ ] Test Analyzer + Logic Auditor + STR Master modules
- [ ] Unified result schema across all agents
- [ ] History screen + result persistence

### Phase 3 — Polish & Ship (Week 11–12)
- [ ] Documentation site (Docusaurus)
- [ ] `make run` one-liner setup
- [ ] README + demo GIF
- [ ] GitHub release + Product Hunt launch prep
- [ ] Community: Discord server + GitHub Discussions

---

## 13. Success Metrics (KPIs)

| Metric | Target (3 months post-launch) |
|---|---|
| GitHub Stars | 1,500+ |
| Docker Hub pulls | 3,000+ |
| Discord community members | 300+ |
| Weekly active installations | 200+ |
| Test cases generated / month (telemetry opt-in) | 20,000+ |
| Bug reports polished / month | 5,000+ |
| Media mentions / blog posts | 5+ |
| Time to first test run (new user) | < 10 minutes |

---

## 14. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Docker Compose resource usage too heavy (RAM) | Medium | High | Profile each service; make tools opt-in (profiles flag) |
| ZAP scan false positives overwhelm users | High | Medium | AI triage layer is core; default to Baseline scan in MVP |
| Gemini API key required = friction for new users | High | Medium | Ship with Ollama fallback; offer free-tier key instructions in README |
| Generated Playwright code quality is inconsistent | Medium | High | Add validation step: generated code must parse TS before being offered to user |
| Open-source tool license conflicts (AGPL) | Low | High | Legal review: k6 is AGPL — distribution packaging strategy needed |
| Mobile Agent (Maestro) on Docker is complex | High | Low | Deferred to post-MVP; clearly marked as "coming soon" in Dashboard |
| Competing project copies the concept | Medium | Medium | Move fast; build community moat; open-source core keeps trust |

---

## 15. Open Questions

1. **LLM default:** Gemini API key required at setup, or ship with a free Ollama model as default?
2. **k6 AGPL license:** Does embedding k6 in a Docker Compose distributed as a product create distribution obligations?
3. **Telemetry:** Opt-in anonymous usage stats for KPI tracking — what data, how stored?
4. **Bruno vs. Hoppscotch:** Bruno is CLI-native and Git-friendly, but has less API coverage than Hoppscotch. Final call?
5. **Maestro on Linux Docker:** Maestro requires a connected device — how do we handle CI/Docker execution for mobile?
6. **Allure vs. custom reporting:** Is Allure enough for v1, or should Dashboard have its own native result viewer?
7. **Self-healing Playwright:** Integrate `playwright-self-healing` npm package (already built) as default Playwright layer?
8. **KAIROS branding:** Is Q-Ace the final name, or does the KAIROS rebrand apply to this full ecosystem?

---

*Document last updated: March 2026*
*Next review: April 2026*
