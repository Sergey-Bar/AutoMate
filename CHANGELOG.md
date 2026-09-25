# Changelog

## 1.0.0 (2026-03-19)

### Features
- AI-powered QA orchestration chat via Ollama (llama3.1)
- GitHub connector: create issues, comment on PRs (via Octokit)
- Jira connector: create issues, search with JQL (via REST API v3)
- Slack connector: post QA summaries (via Incoming Webhooks)
- SQL Browser connector with safety guards (read-only, row limits)
- Encrypted credential vault (AES-256-GCM, PBKDF2)
- Conversation persistence (SQLite WAL via Drizzle ORM)
- Execution logging for all tool calls
- Real-time WebSocket events for tool status
- Settings pages: model config, vault, connectors
- TanStack Router with lazy-loaded routes
- Dark/light theme support
- Docker + docker-compose with Ollama sidecar
- GitHub Actions CI pipeline (lint, build, test)
- Structured health endpoint with DB and Ollama connectivity status

### QA & Release Hardening (2026-03-28)
- Coverage enforcement: per-package vitest thresholds ratcheted to current highs
  - Server: 99.26% lines (threshold 98%), 356 tests
  - Web: 97.96% lines (threshold 97%), 656 tests
  - Shared: 100% lines, 11 tests
  - Connector SDK: 83%+ lines, 5 tests
  - GitHub connector: 97%+ lines, 14 tests
  - Jira connector: 100% lines, 13 tests
  - Slack connector: 100% lines, 11 tests
  - SQL Browser connector: 100% lines, 13 tests
- **1,080 total unit tests**, all passing
- Mutation testing: Stryker v9 configured with 75% break threshold (blocked on Stryker v9 + Vitest 4 Windows compatibility — exit code 3221225477)
- CI/CD pipeline: GitHub Actions with lint → typecheck → test+coverage → build gates
- Desktop app: Tauri build with MSI + NSIS installers (icons generated)
- Dependency security: pnpm overrides for picomatch, flatted, brace-expansion
- Environment variables: `.env.example` with all configuration documented
- Full pipeline verified: `pnpm verify` (build + test + typecheck + lint) exits 0
