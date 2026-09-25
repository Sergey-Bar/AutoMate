# Architecture Decisions — Automate

> Consolidated from `.planning/` phase documents. Project reached v1.2 complete (March 2026).

---

## Core Architecture

```
Browser (React 19 SPA)
    ↕ REST + WS (port 4000)
Fastify Server (apps/server)
    ├── REST Routes (18 modules)
    ├── ReporterBridge (WS hub → DB → browser broadcast)
    ├── Runner (node-pty spawns Playwright)
    ├── Scheduler (cron-based runs)
    ├── Artifact Watcher (chokidar)
    └── SQLite (WAL mode) + Drizzle ORM
    ↑ WS /reporter (port 4001)
CI / Local Playwright Process (ws-reporter.ts)
```

**Two-port WS architecture**: Reporter (4001) and browser (4000) must stay separate. Reporter port accepts unauthenticated CI connections; browser WS should be authenticated.

---

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| SQLite over PostgreSQL | Local-first for individual devs; Drizzle adapter swap documented for teams |
| Custom WS reporter over file polling | Real-time per-step granularity impossible with polling |
| Two-port WS architecture | Reporter (CI, unauthenticated) vs browser (authenticated) separation |
| TanStack Router over React Router | Type-safe route params and loaders |
| Fastify over Express | Faster, native TS, built-in schema validation, first-class WS plugin |
| trace.playwright.dev iframe | Saves 100+ hours; handles full trace viewer complexity |
| react-arborist for test tree | Keyboard nav + multi-select built in; saves 12h |
| @xterm/xterm for terminal | Powers VS Code; handles every escape sequence |
| node-pty over child_process.spawn | Correct PTY for codegen, interactive programs, ANSI codes |
| Pre-load command palette on mount | <80ms open requirement; async fetch too slow |
| No page transition animations | Latency perception + nav confusion for technical users |
| Blob ZIP via merge-reports CLI | Blob format is internal to Playwright; only merge-reports is stable |

---

## Implementation Decisions (v1.1–v1.2)

### Build & Infrastructure (Phase 11)
- Server `tsconfig.base.json` has `noEmit: true` — server `tsconfig.json` overrides with `noEmit: false` to emit JS
- `.dockerignore` must NOT exclude `**/*.d.ts` — `vite-env.d.ts` is a source file
- Docker: `node:22-alpine` confirmed working — `node-pty@1.1.0` + `better-sqlite3@9.6.0` compile from source
- Sentry enabled via `!!DSN` guard — complete no-op without env vars in local dev
- `sentryVitePlugin` spread-conditional on `SENTRY_AUTH_TOKEN` for CI-only source maps
- React 19 `reactErrorHandler()` used for both `onUncaughtError` and `onCaughtError`
- SIGTERM handler inside `bootstrap()` closure accesses `reporterServer`/`reporterWss`

### WebSocket Resilience (Phase 11)
- Pong guard moved to raw `onmessage` handler — `'pong'` not in `WsEventType` union
- `ws:reconnected` custom event bridges `wsStore` and `$runId.tsx` (queryClient access)

### Performance (Phase 13)
- `createLazyFileRoute` for analytics/runId/config routes
- Lazy CommandPalette + OnboardingWizard
- `manualChunks` with static keys only for libs actually used on initial render
- Lighthouse: 98 desktop / 89 mobile

### Features (Phases 14–20)
- **Tag filter** (14): Tags from `test.annotations` in reporter payload; FilterBar tag select; URL param `?tag=`
- **Permalinks** (14): `testId` URL param on `/runs/$runId`; copy-link buttons with toast feedback
- **Test history** (15): `stableId` = sha256(file+title, 16-char hex); `GET /api/tests/history/:stableId`
- **Fingerprinting** (15): `fingerprintError()` normalizes errors (strips paths, addresses, UUIDs, numbers)
- **Build comparison** (16): `GET /api/runs/compare?a=&b=&changedOnly=`; CompareTable with color-coded borders
- **CSV export** (17): `GET /api/runs/export.csv` + `GET /api/runs/:id/tests/export.csv`
- **Quality gate** (18): `qualityGateConfig` table; `gateStatus` column on runs; `computeGateStatus()` on run:end
- **Defect categories** (19): `defectCategories` + `fingerprintCategories` tables; full CRUD
- **Blob/sharded CI** (20): `blobShards` table + `source` column; `@fastify/multipart`; merge via `npx playwright merge-reports`

---

## Anti-Patterns to Avoid

1. **Don't re-implement blob report parsing** — use `npx playwright merge-reports --reporter=json`
2. **Don't run SQLite without WAL mode** — causes `SQLITE_BUSY` under concurrent writes
3. **Don't merge reporter/browser WS ports** — breaks CI auth separation
4. **Don't run node-pty as root in Docker** — disables Chromium seccomp sandbox

---

## Scaling Path

| Scale | Approach |
|-------|----------|
| 1–5 users | SQLite WAL + single Fastify process (current) |
| 5–20 users | Add auth + blob ingest; Docker Compose |
| 20–50 users | PostgreSQL swap (Drizzle adapter); S3 for artifacts |
| 50+ users | Split runner service; Redis pub/sub for plugin bus |

---

## Future (Unplanned)

- TestRail / Zephyr / Qase integration
- OAuth login / RBAC
- PostgreSQL migration
- "Open in VS Code" deep link

---

*Consolidated: March 2026 — from .planning/ phases 11–20 research and implementation notes*
