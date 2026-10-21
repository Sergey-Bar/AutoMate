# @automate/api

The control-plane API, on Hono v4 with Drizzle and PostgreSQL. It ingests reports through one canonical path, persists runs and their evidence, evaluates quality gates, serves the dashboard and the runner protocol, and streams run events over server-sent events. Services are plain TypeScript composed in `src/index.ts`; every failure is a `DomainError` rendered by the one error boundary in `src/errors/boundary.ts`. Effect is used only in `src/bootstrap`, for ordered shutdown.

```bash
pnpm --filter @automate/api dev
```

Part of the [Automate](https://github.com/Sergey-Bar/AutoMate) monorepo; see the root README for the whole picture.
