# AutoQA Testing Plan — Automate

## 1. Baseline Coverage Summary

| Package | Stmts | Branch | Funcs | Lines | Tests |
|---------|-------|--------|-------|-------|-------|
| **Server** | 69.41% | 50.60% | 77.16% | 70.22% | 290 |
| **Web** | 34.18% | 28.65% | 28.93% | 35.76% | 23 |
| **Shared** | 93.33% | 50.00% | 100% | 100% | 20 |
| **Connector SDK** | 71.42% | 50.00% | 100% | 66.66% | 8 |
| **SQL Browser** | 100% | 100% | 100% | 100% | 26 |
| **Slack** | 53.33% | 35.71% | 50% | 53.33% | 10 |
| **Jira** | 13.33% | 36.36% | 20% | 14.28% | 12 |
| **GitHub** | 82.05% | 80.00% | 75% | 82.05% | 14 |

**Overall estimated: ~55% statements** — target is **85%+**.

## 2. Constraint

**NO Visual/UI testing** — skip Playwright E2E, visual regression, a11y visual checks, screenshots. Unit tests for logic-bearing web files are IN scope (hooks, stores, utils). Component render tests via `renderToString` are also in scope for components that contain testable logic (conditional rendering, error states).

## 3. Priority Matrix

### P0 — Critical Path (must reach 90%+ coverage)

These are core business logic modules that handle user data, security, and the primary chat flow.

| Module | File | Current | Target | Gap Analysis |
|--------|------|---------|--------|-------------|
| Server | `routes/vault.ts` | 0% | 95% | **Completely untested**. 5 routes: status, unlock, lock, put credentials. Tests need: happy path for all 5, password validation, locked vault guard, malformed credentials, unlock failure. |
| Server | `routes/chat.ts` | 91.42% stmts / 59.09% branch | 95% | Good statement coverage but branch coverage is poor. Missing: error branches in streaming, missing conversationId handling, tool approval flow edge cases. |
| Server | `routes/model-config.ts` | 30.76% | 90% | Only `maskApiKey` tested. Route handlers GET (default fallback, existing row) and PUT (partial updates, all fields) completely untested. |
| Server | `agent/orchestrator-loop.ts` | 51.02% / 36.66% branch | 85% | `readFunction` has some coverage. Missing: `buildStreamParams` with various provider configs, `stream` method with/without logging callbacks, tool wrapping, error handling in tool execution. |
| Server | `agent/planner.ts` | 51.51% / 37.5% branch | 85% | `readFunction` partially covered. Missing: `createPlannerConfig` with non-ollama provider (error), `buildPlannerInput` with/without config, `plan` and `planWithMessages` functions, `withDefaultModelConfig` merge logic. |
| Server | `index.ts` | 66.15% / 41.37% branch | 85% | `buildServer` main paths tested via integration. Missing: health endpoint ollama check branches (connected/error/disconnected), vault auto-unlock, direct-run guard, `getCredentials` parsing branches. |

### P1 — High Value (must reach 85%+ coverage)

| Module | File | Current | Target | Gap Analysis |
|--------|------|---------|--------|-------------|
| Server | `routes/ws.ts` | 16.66% | 90% | Stub test only. Need: WebSocket connection, event forwarding, close/unsubscribe, readyState check. Requires mocking `@fastify/websocket`. |
| Server | `connectors/registry.ts` | 83.33% / 54.54% branch | 95% | Missing: `dispatch` with missing connector, dispatch with missing tool, dispatch fallback to single tool, `registerLocal` deprecated wrapper, `reload`, `unload`. |
| Server | `db/schema.ts` | 70% | 85% | Lines 16, 29, 59 uncovered — likely table definition edge cases. |
| Connector | `jira/index.ts` | 7.14% | 85% | Handler functions completely untested. Need to mock `fetch` and test `create_issue` and `search_issues` handlers with various inputs. |
| Connector | `slack/index.ts` | 12.5% | 85% | Handler function untested. Need to mock `fetch` and test `post_summary` with runId (structured blocks) and without (plain text). |
| Connector | `github/index.ts` | 50% | 85% | `post_pr_comment` handler untested. Need to mock Octokit and test both tool handlers. |

### P2 — Medium Value (must reach 80%+ coverage)

| Module | File | Current | Target | Gap Analysis |
|--------|------|---------|--------|-------------|
| Web | `store/themeStore.ts` | 22.22% | 90% | Need: setTheme, applyTheme with dark/light/system modes, DOM manipulation mocking. |
| Web | `hooks/use-conversations.ts` | 0% | 85% | Need: initial fetch, loading state, create conversation, error handling. Mock `fetch`. |
| Web | `stores/conversation-store.ts` | 100% | 100% | Already at 100% — maintain. |
| Web | `lib/utils.ts` | 100% | 100% | Already at 100% — maintain. |
| Web | `lib/motion.ts` | 75% | 85% | Lines 98, 114-126 uncovered — test remaining animation config paths. |
| Web | `hooks/use-automate-chat.ts` | 25% | 80% | Core chat hook. Test message sending, loading states, error handling, tool approval. |
| Connector | `connector-sdk/base-connector.ts` | 83.33% | 95% | Line 14 uncovered. |
| Shared | `index.ts` | 93.33% / 50% branch | 95% | Line 81 + branch coverage gaps. |

### P3 — Low Value / Out of Scope

These files are barrel re-exports, type definitions, or pure UI components that don't warrant unit testing under the "no visual/UI testing" constraint:

- `apps/web/src/main.tsx` — App entry point (render to DOM)
- `apps/web/src/components/ui/*` — Pure presentational UI components (Button, Input, Select, etc.)
- `apps/web/src/components/layout/*` — Layout wrappers (PageTransition, AppLayout)
- `apps/web/src/components/shared/Skeleton.tsx` — Loading skeleton UI
- `apps/web/src/routes/*.tsx` — Page-level route components (settings pages, sql page)
- `*/index.ts` barrel re-exports — 0% is expected, no logic
- `types.ts` files — Type definitions, no runtime code

## 4. Sprint Plan

### Sprint 1: Server Critical Path (P0)

**Estimated tests: ~50 new tests**

#### Task 1.1: `routes/vault.ts` — Full Test Suite
- GET `/api/vault/status` — returns unlock state
- POST `/api/vault/unlock` — success, missing password (400), service failure (500)
- POST `/api/vault/lock` — success
- PUT `/api/vault/credentials/:connector` — success, vault locked (403), missing credentials (400), invalid credentials object (400)
- Mock: `VaultRouteDeps.vaultService`

#### Task 1.2: `routes/model-config.ts` — Route Handler Tests
- GET `/api/model-config` — with existing row, without row (default fallback)
- PUT `/api/model-config` — full update, partial update (single field), empty body
- Mock: `db` module (drizzle ORM)

#### Task 1.3: `agent/planner.ts` — Unit Tests
- `readFunction` — direct value, nested default, missing key
- `withDefaultModelConfig` — with config, without config
- `createPlannerConfig` — ollama provider, non-ollama provider (error)
- `buildPlannerInput` — with config, without config (legacy)
- `plan` — calls streamText with correct params
- `planWithMessages` — formats messages correctly
- Mock: `ollama-ai-provider-v2`, `ai` module's `streamText`

#### Task 1.4: `agent/orchestrator-loop.ts` — Unit Tests
- `readFunction` — same tests as planner (DRY if shared)
- `createOrchestrator().buildStreamParams` — builds correct params with tools
- `createOrchestrator().stream` — without callbacks (passthrough), with callbacks (wraps tools), tool success logging, tool error logging
- Mock: `ollama-ai-provider-v2`, `ai`, `ConnectorRegistry`

#### Task 1.5: Deepen `routes/chat.ts` branch coverage
- Test missing branch paths identified by coverage: lines 75-82
- Error handling in streaming response
- Edge cases in tool approval flow

#### Task 1.6: Deepen `index.ts` (buildServer) branch coverage
- Health endpoint: ollama connected, ollama error response, ollama timeout
- Vault: with vaultDbPath + password (auto-unlock), with vaultDbPath only, without vault
- getCredentials: malformed JSON, non-object parsed value, string filtering

### Sprint 2: Connectors + Server P1

**Estimated tests: ~35 new tests**

#### Task 2.1: `jira/index.ts` — Handler Tests
- `create_issue` handler: success, API error
- `search_issues` handler: results found, no results, empty response
- `jiraFetch` helper: auth header construction, abort signal pass-through
- Mock: global `fetch`

#### Task 2.2: `slack/index.ts` — Handler Tests
- `post_summary` with runId (structured blocks via `buildSlackBlocks`)
- `post_summary` without runId (plain text block)
- Webhook failure (non-ok response)
- Mock: global `fetch`

#### Task 2.3: `github/index.ts` — Handler Tests
- `create_issue` handler: success with labels, without labels
- `post_pr_comment` handler: success
- Mock: `@octokit/rest` Octokit class

#### Task 2.4: `routes/ws.ts` — WebSocket Route Tests
- Event forwarding when socket is open (readyState === 1)
- No send when socket is not open
- Unsubscribe on close
- Mock: Fastify websocket plugin, EventHub

#### Task 2.5: `connectors/registry.ts` — Gap Coverage
- `dispatch` with unknown connector (throws)
- `dispatch` with unknown tool (throws)
- `dispatch` fallback to single tool
- `registerLocal` deprecated wrapper
- `unload` + `reload`

### Sprint 3: Web Logic + Packages P2

**Estimated tests: ~25 new tests**

#### Task 3.1: `store/themeStore.ts`
- `setTheme('dark')`, `setTheme('light')`, `setTheme('system')`
- `applyTheme` — DOM classList manipulation for each mode
- System preference media query matching
- Mock: `document.documentElement`, `window.matchMedia`

#### Task 3.2: `hooks/use-conversations.ts`
- Initial fetch populates conversations
- Loading state transitions (true → false)
- `create` — POST, updates state, returns conv
- Fetch error handling
- Mock: global `fetch`, React test utilities (may need lightweight render helper)

#### Task 3.3: `hooks/use-automate-chat.ts`
- Message sending flow
- Loading state management
- Error state handling
- Tool approval response
- Mock: `@ai-sdk/react` useChat hook

#### Task 3.4: `lib/motion.ts` — Gap Coverage
- Test uncovered animation config paths (lines 98, 114-126)

#### Task 3.5: Package Gap Coverage
- `shared/index.ts` — branch at line 81
- `connector-sdk/base-connector.ts` — line 14

## 5. Testing Patterns to Follow

### Server Route Tests (existing pattern)
```typescript
import { describe, expect, it, vi } from 'vitest';
// Use app.inject() for route testing (Fastify standard)
// Mock dependencies via DI (deps parameter)
```

### Web Logic Tests (existing pattern)
```typescript
import { describe, expect, it, vi } from 'vitest';
// Pure logic: test directly (stores, utils)
// Hooks: use lightweight test harness or test the underlying logic
// Components with logic: renderToString + vi.mock for deps
```

### Connector Tests (existing pattern)
```typescript
import { describe, expect, it, vi } from 'vitest';
// Mock fetch/Octokit at module level
// Test handler functions directly via manifest.tools[n].handler()
```

### Assertion Quality Rules
- **NO** `toBeTruthy()` where `toEqual()` is possible
- **NO** mocking the thing being tested — mock boundaries only
- **NO** testing implementation details — test behavior
- Every assertion must verify a specific expected value
- Error paths must verify error message content, not just that an error occurred

## 6. Execution Strategy

1. Work through sprints sequentially (Sprint 1 → 2 → 3)
2. Within each sprint, tasks can be parallelized across subagents
3. After each sprint, run full coverage to measure progress
4. If coverage < 85% after Sprint 3, add targeted tests for remaining gaps
5. Maximum 3 coverage loops

## 7. Success Criteria

- **Overall statement coverage ≥ 85%** across all packages
- **Critical path coverage ≥ 90%** (P0 modules)
- **All tests pass** — zero test failures
- **Zero regressions** — baseline 403 tests still pass
- **Build succeeds** — `pnpm build` exits 0
- **No weak assertions** — every test verifies specific expected values
- **Mutation testing score ≥ 70%** (Phase 8 validation)
