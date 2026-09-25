---
title: Architecture
description: Technical architecture, design decisions, and scaling path.
---

This page covers how Automate is built, why key decisions were made, and where the architecture goes as usage grows. It's aimed at contributors and operators who need to understand the internals.

## System Overview

```
                         ┌─────────────────────────────────────┐
                         │         Automate Server              │
                         │                                      │
 Browser (Dashboard) ────┤── Port 4000 ──► Fastify HTTP + WS   │
                         │                     │                │
                         │               ReporterBridge         │
                         │                     │                │
 CI / Playwright ────────┤── Port 4001 ──► Reporter WS          │
                         │                     │                │
                         │               SQLite (WAL)           │
                         │               dashboard.db           │
                         └─────────────────────────────────────┘
```

The browser connects to port `4000` for the SPA and its WebSocket feed. CI machines connect to port `4001` to stream test events. The `ReporterBridge` receives events from CI, writes them to SQLite, and broadcasts updates to any connected browsers.

## Two-Port WebSocket Architecture

Automate runs two WebSocket servers on two different ports — not two endpoints on the same port. This is a deliberate design choice.

**Port 4000** (browser-facing):
- Serves the React SPA
- Handles browser WebSocket connections
- Should eventually sit behind auth middleware
- Can be proxied by nginx, Cloudflare, or any reverse proxy

**Port 4001** (reporter-facing):
- Accepts connections from CI machines running Playwright
- No authentication by design — CI pipelines need frictionless access
- Should NOT be proxied; reporters connect directly
- Must be opened at the firewall level for remote CI

The split means you can lock down the browser-facing port (auth, rate limiting, TLS termination) without breaking CI pipelines. If both were on the same port, every security change to the dashboard would risk breaking the reporter.

## Data Flow

```
Reporter (CI)
    |
    | WebSocket event (run:start, test:begin, test:end, ...)
    v
Port 4001 WebSocket Server
    |
    v
ReporterBridge
    |-- validates and normalizes events
    |-- writes to SQLite (WAL mode, synchronous writes)
    |-- emits broadcast event
    v
Browser WebSocket Subscribers (Port 4000)
    |
    v
React UI (live update, no polling)
```

SQLite WAL mode is critical here. WAL allows concurrent reads during writes, so the browser can query run history while a new run is being written. Without WAL, a long-running write would block all dashboard queries.

## Tech Stack

| Technology | Version | Why |
|------------|---------|-----|
| Fastify | 5.x | Native TypeScript, 2x faster than Express, built-in schema validation |
| SQLite (better-sqlite3) | 9.x | Local-first, zero infrastructure, WAL mode handles concurrent access |
| Drizzle ORM | 0.38.x | Type-safe queries, lightweight, no codegen step required |
| React | 19 | Concurrent features, server components ready, latest ecosystem |
| TanStack Router | 1.x | Fully type-safe routes and params, no string-based navigation |
| Zustand | 5.x | Minimal boilerplate, works well with React 19 concurrent mode |
| Tailwind CSS | 4.x | Utility-first, zero runtime, PostCSS-based v4 engine |
| Vite | 6.x | Sub-second HMR, native ES modules, fast production builds |

## Key Decisions

| Decision | Chosen | Alternative | Reason |
|----------|--------|-------------|--------|
| Database | SQLite | PostgreSQL | Zero infrastructure. A single `dashboard.db` file deploys anywhere. Postgres adds a service, a connection pool, and ops burden that most teams don't need at this scale. |
| Test event delivery | Custom WebSocket reporter | File polling / JSONL | Sub-second latency. File polling introduces 1–5s lag and requires shared filesystem access. WebSocket gives real-time push with no shared state. |
| Two WebSocket ports | Separate ports 4000/4001 | Path-based routing on one port | Security boundary. Reporter port stays auth-free for CI; browser port can get auth without breaking CI. |
| Client routing | TanStack Router | React Router | Type safety. TanStack Router generates types from route definitions, making `navigate()` and `useParams()` fully typed with zero manual type annotations. |
| HTTP framework | Fastify | Express | Performance and types. Fastify's schema-based validation catches bad requests before they hit handlers. Express requires manual type augmentation. |
| Trace viewer | trace.playwright.dev iframe | Custom implementation | Playwright's trace viewer is best-in-class. Embedding it in an iframe gives full functionality with zero maintenance cost. |
| Test tree UI | react-arborist | Custom tree component | react-arborist handles virtualization, keyboard navigation, and drag-and-drop out of the box. A custom tree would take weeks to reach the same quality. |

## Reliability and Observability

Automate is built for production use with several observability features:

### Health Checks

The server provides structured health endpoints for container orchestrators (e.g., Kubernetes, Docker Swarm):

- `/health/live` — Liveness probe (process is running)
- `/health/ready` — Readiness probe (database connection check)
- `/health/startup` — Startup probe (completes after initialization)

### Logging

Fastify's built-in logger provides structured JSON logging. By default, it logs to `stdout` at the level specified by `LOG_LEVEL` (default: `info`). These logs are easily digestible by ELK stacks or Datadog.

### API Documentation

Automated OpenAPI (Swagger) documentation is generated from the route schemas. This serves as the source of truth for all REST endpoints and can be used to generate client SDKs.

## Monorepo Structure

```
automate/
├── apps/
│   ├── server/          # Fastify server, WebSocket handlers, SQLite
│   └── client/          # React SPA, TanStack Router, Zustand
├── packages/
│   ├── shared/          # Types and schemas shared across apps
│   ├── reporter/        # @automate/reporter npm package
│   └── cli/             # @automate/cli npm package
├── docs-site/           # This Astro Starlight documentation site
└── docker/              # Dockerfile and docker-compose.yml
```

`packages/shared` contains the TypeScript interfaces for all WebSocket events, run metadata, and test result shapes. Both `apps/server` and `packages/reporter` import from it, ensuring the types that CI sends match the types the server expects.

## Scaling Path

Automate is designed for self-hosted teams. Here's how the architecture evolves as usage grows:

| Scale | Users / Day | Current Approach | Next Step |
|-------|-------------|-----------------|-----------|
| Small | 1–5 users, 1–5 runs/day | SQLite + single process | Nothing needed. Works fine. |
| Medium | 5–20 users, 5–20 runs/day | Add authentication, move artifact ingest to background worker | Enable WAL checkpoint tuning |
| Large | 20–50 users, 50+ runs/day | Migrate to PostgreSQL (Drizzle supports it), move artifacts to S3 or compatible object storage | Add connection pooling (PgBouncer) |
| Very large | 50+ users, 100+ runs/day | Split reporter bridge into separate process, add Redis pub/sub for cross-process broadcast | Horizontal scaling behind a load balancer |

The Drizzle ORM layer means the SQLite-to-PostgreSQL migration is a config change, not a rewrite. The query interfaces are identical.
