# ADR 003: Universal QA Vertical Slice Architecture

## Status

Accepted for the reference vertical slice.

## Context

The root workspace contains the authoritative platform, while the ignored nested `AutoMate` checkout is a separate repository with independent history. The existing runtime has a working reporter ingestion path, but execution, queueing, evidence, and release decisions are split across legacy route-local contracts and process-local stores.

## Decision

- Treat the root pnpm/Turborepo workspace as the only buildable source. The nested `AutoMate` checkout is excluded from workspace discovery, dependency analysis, and deployment images.
- Keep the Hono API as a modular monolith and place execution in separately startable `apps/worker` and `apps/runner` processes.
- Use PostgreSQL as the durable queue and source of truth for runs, jobs, leases, events, and artifact metadata. Use a local filesystem adapter for artifact bytes in this slice.
- Use `@automate/shared-contracts` as the versioned wire-contract authority. Legacy reporter event names are decoded only at the compatibility adapter boundary.
- Represent execution phase separately from quality outcome. Infrastructure, configuration, cancellation, and timeout states must not be counted as product test failures.
- Register Playwright as the reference execution integration only after its live event and evidence path is verified. JUnit and Playwright JSON imports are ingestion integrations. Other domains remain catalogued and not configured.
- Keep the existing single-admin installation API-key model for this slice. Runner registration and short-lived runner credentials use a separate registration secret; reporter credentials remain separate.
- Require authenticated, path-safe artifact retrieval with checksum and size metadata. PostgreSQL stores metadata, never artifact bytes.
- Treat a quality gate as deterministic policy evaluation over explicit evidence. Missing evidence is unknown, not passed.

## Consequences

- API and web clients can share one contract vocabulary while legacy reporters continue to work through a compatibility seam.
- The slice is single-instance for realtime delivery. Durable events and reconnect/refetch semantics are required before any horizontal-scaling claim.
- A clean deployment must run migrations before API and worker readiness, persist raw evidence before normalization, and keep the runner image separate from the API image.
- Multi-tenant RBAC, SSO, object storage, broker-backed SSE, and additional execution adapters remain out of scope.

## Rollout and rollback

Apply additive schema changes, deploy the compatibility adapter, start one isolated worker and runner, and switch the web command center only after API, browser, migration, and E2E gates pass. Roll back by stopping the worker and runner and routing the web app to the prior dashboard; do not delete evidence or drop columns.
