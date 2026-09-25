<p align="center">
  <img src="https://img.shields.io/badge/Automate-blueviolet?style=for-the-badge&logo=testcafe&logoColor=white" alt="Automate" />
</p>

<h1 align="center">Automate — AI-Orchestrated QA Platform</h1>

<p align="center">
  A unified platform for AI-native QA orchestration, live Playwright monitoring, and quality engineering.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue?style=flat-square" alt="Version 1.0.0" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5.9" />
  <img src="https://img.shields.io/badge/Node.js-22+-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 22+" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/Hono-4-E36002?style=flat-square&logo=hono&logoColor=white" alt="Hono 4" />
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Playwright-E2E-2EAD33?style=flat-square&logo=playwright&logoColor=white" alt="Playwright" />
  <img src="https://img.shields.io/badge/Vitest-4-6E9F18?style=flat-square&logo=vitest&logoColor=white" alt="Vitest 4" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/pnpm-10-F69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm" />
</p>

---

## Product Surface

Automate is an AI-native QA platform designed for scale, type-safety, and developer velocity. It provides a unified experience for live test monitoring, failure triage, AI-assisted analysis, and quality gates.

### Core Capabilities
- **Live Monitoring** — Watch Playwright tests execute in real-time via WebSocket.
- **AI Explain** — Plain-English failure explanations and root cause analysis.
- **Conversational QA** — Chat with an AI that understands your codebase and test infrastructure.
- **Quality Gates** — Pass-rate thresholds and duration trends for CI/CD decisions.
- **Failure Analysis** — Inspect screenshots, videos, traces, stack traces, and step timing.
- **Connectors** — Deep integrations with GitHub, Jira, and Slack.

---

## ⚡ Project Structure

The platform is built as a modular monolith with a clear package boundary:

| Directory | Package | Description |
|---|---|---|
| `apps/api` | `@automate/api` | Unified Hono API with Effect-based services |
| `apps/web` | `@automate/unified-web` | Unified React frontend with TanStack Router |
| `packages/auth` | `@automate/auth` | Unified session and API key management |
| `packages/db` | `@automate/db` | Drizzle schema and migrations (PostgreSQL) |
| `packages/realtime` | `@automate/realtime` | SSE event bus |
| `packages/shared-contracts` | `@automate/shared-contracts` | Type-safe API contracts and Zod schemas |
| `packages/ui` | `@automate/ui` | Shared Tailwind 4 component library |
| `services/webwright` | — | Python sidecar for browser automation |
| `tools/migrate-cli` | — | CLI tools for platform migration |

---

## Quick Start

### Prerequisites

- [Node.js 22+](https://nodejs.org)
- [pnpm 10+](https://pnpm.io)
- [PostgreSQL 16](https://www.postgresql.org/)
- [Ollama](https://ollama.com/) (for AI features)

### Setup & Development

```bash
pnpm install
pnpm dev          # Start API + Web concurrently (via Turbo)
pnpm build        # Build all packages
pnpm verify       # Full gate: build + test + typecheck + lint
```

Optional (local first boot): disable web login guard

```bash
VITE_AUTH_REQUIRED=false pnpm dev
```

By default, `VITE_AUTH_REQUIRED` is `true`.

### Connect Playwright Tests

```bash
npm install -D @automate/reporter
```

Add to your `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    ['@automate/reporter'],
  ],
});
```

Run tests:

```bash
AUTOMATE_API_URL=http://localhost:3000 \
AUTOMATE_API_KEY=your-key \
npx playwright test
```

---

## Docker Usage

```bash
# Spin up the entire unified stack (Postgres + API + Web)
docker compose -f docker-compose.unified.yml up --build

# Include Ollama AI service
docker compose -f docker-compose.unified.yml --profile ai up -d
```

---

## Test Suites

Every unified package ships with Vitest unit/integration tests, and coverage
thresholds are enforced per package in each `vitest.config.ts` — the gate fails
if coverage regresses. Playwright end-to-end specs live under `e2e/`.

Run the full gate (build + test + typecheck + lint across every package):

```bash
pnpm verify
```

Run tests only, or a single package (with coverage):

```bash
pnpm test                                  # all packages via Turborepo
pnpm --filter @automate/api test
pnpm --filter @automate/unified-web test
```

Packages under test: `@automate/api`, `@automate/unified-web`, `@automate/ui`,
`@automate/db`, `@automate/auth`, `@automate/realtime`, `@automate/shared-contracts`.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `DATABASE_URL` | — | PostgreSQL connection string (REQUIRED) |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama base URL |
| `COOKIE_SECRET` | — | Session signing secret (min 32 chars) |
| `VAULT_SECRET` | — | Credential encryption secret (min 32 chars) |
| `AUTOMATE_API_KEY` | — | API key for authenticated access |

---

## License

Automate — Private, internal use.  
Reporter — [MIT](./LICENSE).
