# Legacy Parity Matrix & Decommission Gates

## Purpose
This document provides a comprehensive mapping of features from the legacy standalone products (Automate and Automate) to the Unified platform. It serves as the authoritative record for migration completeness and governs the decommission process.

## How to Read This Matrix
- **Feature**: The functional component or capability.
- **Legacy Location**: The primary source directory or package in the legacy repositories.
- **Unified Location**: The destination in the unified monorepo.
- **Status**: The current migration state.
- **Evidence**: Reference to validation evidence in `.sisyphus/evidence/`.

## Status Definitions
- `migrated`: Feature is fully functional in the unified platform with verified evidence.
- `preserved`: Original package or component is kept as-is for backwards compatibility.
- `deprecated`: Feature was intentionally removed or replaced by a superior unified alternative.
- `deferred`: Feature is planned for future work (501 NOT_IMPLEMENTED).

## Automate Legacy Features
| Feature | Legacy Location | Unified Location | Status | Evidence |
| :--- | :--- | :--- | :--- | :--- |
| Conversations/Chat | `Automate/apps/server/` | `apps/api/src/modules/orchestrator/` | migrated | `task-23-chat-contract.txt`, `task-30-ai-chat.png` |
| Model Config | `Automate/apps/server/` | `apps/api/src/modules/orchestrator/` | migrated | `task-21-model-config-persistence.txt`, `task-25-client-validation.txt` |
| AI Test Generation | `Automate/apps/server/` | `apps/api/src/modules/orchestrator/` | deferred | `deferred` — no current E2E evidence; API endpoint exists as stub |
| Connectors (GitHub, Jira, Slack, SQL) | `Automate/packages/connectors/` | `apps/api/src/modules/connectors/` | migrated | `task-12-vault-auth-redaction.txt` |
| Vault | `Automate/apps/server/` | `apps/api/src/modules/connectors/vault` | migrated | `task-32-vault-security.txt`, `task-32-vault-negative.txt` |
| OpenAPI/Postman parsing | `Automate/apps/server/` | `apps/api/src/modules/orchestrator/` | deferred | `deferred` — endpoint is a stub returning 501 |
| Web UI (Chat, Settings) | `Automate/apps/web/` | `apps/web/src/routes/ai.tsx`, `settings.tsx` | migrated | `task-30-ai-chat.png`, `task-33-settings-e2e.png` |

## Dashboard Legacy Features
| Feature | Legacy Location | Unified Location | Status | Evidence |
| :--- | :--- | :--- | :--- | :--- |
| Runs API | `Automate/apps/server/` | `apps/api/src/modules/dashboard/` | migrated | `task-18-idempotency.txt`, `task-19-no-prod-inmemory.txt` |
| Tests API | `Automate/apps/server/` | `apps/api/src/modules/dashboard/` | migrated | `task-18-idempotency.txt` |
| Analytics | `Automate/apps/server/` | `apps/api/src/modules/dashboard/` | migrated | `task-18-idempotency.txt` |
| Quarantine | `Automate/apps/server/` | `apps/api/src/modules/dashboard/` | migrated | `task-21-quarantine-persistence.txt` |
| Quality Gates | `Automate/apps/server/` | `apps/api/src/modules/dashboard/` | migrated | `task-18-idempotency.txt` |
| Reporter Ingestion | `Automate/apps/server/` | `apps/api/src/routes/reporter.ts` | migrated | `task-13-reporter-auth.txt`, `task-27-reporter-contract.txt`, `task-29-reporter-dashboard.png` |
| Realtime Events | `Automate/apps/server/` | `apps/api/src/routes/events.ts` | migrated | `task-29-sse-live-update.txt`, `task-29-reporter-dashboard.png` |
| Web UI (Dashboard, Analytics, Quarantine) | `Automate/apps/client/` | `apps/web/src/routes/dashboard/` | migrated | `task-26-run-navigation.txt`, `task-33-dashboard-detail-e2e.png` |
| Reporter npm package | `Automate/packages/reporter/` | `Automate/packages/reporter/` | preserved | `task-13-reporter-auth.txt` |
| CLI | `Automate/packages/cli/` | `Automate/packages/cli/` | preserved | `task-1-root-gates.txt` |

## Shared Infrastructure
| Feature | Legacy Location | Unified Location | Status | Evidence |
| :--- | :--- | :--- | :--- | :--- |
| Shared Contracts | `Automate/packages/shared/` | `packages/shared-contracts/` | migrated | `task-5-root-verify.txt` |
| Shared UI | `Automate/packages/ui/` | `packages/ui/` | migrated | `task-5-root-verify.txt` |
| Database Schema | `Automate/apps/server/` | `packages/db/` | migrated | `task-19-no-prod-inmemory.txt` |
| Auth | `Automate/apps/server/` | `packages/auth/` | migrated | `task-31-auth-matrix.txt` |
| Realtime | `Automate/apps/server/` | `packages/realtime/` | migrated | `task-29-sse-live-update.txt` |

## apps/web
| Feature | Legacy Location | Unified Location | Status | Evidence |
| :--- | :--- | :--- | :--- | :--- |
| Iframe Shell | `apps/web/` | N/A | deprecated | `task-12-vault-auth-redaction.txt` |

## MCP/Agents
| Feature | Legacy Location | Unified Location | Status | Evidence |
| :--- | :--- | :--- | :--- | :--- |
| Browser agent | N/A (New in Unified) | `apps/api/src/modules/agents/` | deferred | `deferred` — agents module has stub routes returning 501 |
| API agent | N/A | `apps/api/src/modules/agents/` | deferred | deferred — stub route returning 501; no evidence required |
| Load agent | N/A | `apps/api/src/modules/agents/` | deferred | deferred — stub route returning 501; no evidence required |
| Security agent | N/A | `apps/api/src/modules/agents/` | deferred | deferred — stub route returning 501; no evidence required |
| Mobile agent | N/A | `apps/api/src/modules/agents/` | deferred | deferred — stub route returning 501; no evidence required |

## Decommission Gates
- **Gate 1**: All unified API tests pass (208+ tests).
- **Gate 2**: All unified web tests pass (37+ tests).
- **Gate 3**: Vertical slice E2E evidence exists (task-29, task-30, task-33).
- **Gate 4**: Docker stack boots with healthchecks (task-35).
- **Gate 5**: No legacy route is referenced by unified app.
- **Gate 6**: Reporter backwards compatibility proven (task-13, task-27).

## Production-Readiness Remediation Wave 5 Summary

The following additional coverage was established during the `production-readiness-remediation` plan:

| Area | Tests | Evidence |
|---|---|---|
| Exhaustive Auth Matrix (all routes, all token states) | 29 API tests | `task-31-auth-matrix.txt` |
| Vault AES-256-GCM + wrong-key rejection | 19 security tests | `task-32-vault-security.txt`, `task-32-vault-negative.txt` |
| AI Chat E2E (happy path, persistence, isolation, failure) | 4 Playwright tests | `task-30-ai-chat.png`, `task-30-conversation-switching.png` |
| Settings E2E (invalid blocked, valid persists) | 2 Playwright tests | `task-33-settings-e2e.png` |
| Dashboard E2E (run detail exact values) | 1 Playwright test | `task-33-dashboard-detail-e2e.png` |
| Docker Stack Smoke (CI enabled) | Script + CI | `task-35-docker-smoke.txt`, `task-35-docker-reporter-auth.txt` |
| P0 Coverage Matrix | 20 flows documented | `task-40-p0-coverage.md` |

### Decommission Gate Status
Legacy products (Automate, Automate) must remain runnable until:
1. All production-readiness gates pass in CI
2. Final Verification Wave (F1-F5) completes with ALL APPROVE verdicts
3. User explicitly approves decommission

Current gate status: IMPLEMENTATION COMPLETE, FINAL REVIEW PENDING
