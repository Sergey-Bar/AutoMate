# ADR-001: Hono on Node, as a modular monolith in one pnpm workspace

**Status:** accepted
**Date:** 2026-05-05
**Supersedes:** —

## Context

The product runs one API, one worker, one runner, and a web client, deployed
together on one machine. The API has to stream events, accept reporter payloads,
serve bounded binary artifacts, and answer probes — a mix that historically splits
a framework into "good at one of these".

The predecessor implementation was Fastify with two applications. The unification
had to choose one, and choosing wrong meant rewriting every route twice.

## Decision

**Hono on Node**, composed as a **modular monolith** in a single pnpm workspace.

`apps/api` is the composition root. Every route builder is a factory
(`createHealthRoutes`, `createExecutionRoutes`, `createReporterRoutes`, …) that the
root mounts, so the route set is assembled in one readable place and each builder
is testable without the whole app.

## Consequences

- **One route manifest, one list.** `apps/api/src/route-manifest.test.ts` enumerates
  the mounted routes. Two documents previously claimed a `GET /api/v1/runs` existed —
  one dead handler and one live — and each one's own test passed, because each built
  an app with only half the routes mounted. A single enumeration makes that
  unrepresentable.
- **One error boundary.** `apps/api/src/errors/boundary.ts` is the only one, and
  every response carries a stable `code`.
- **The framework stays out of the modules.** A domain module takes plain values,
  so it is testable without spinning up Hono.
- **Not a distributed system.** Modules talk in-process. Splitting them later is a
  real cost, paid deliberately rather than by accident.

## Evidence

- `apps/api/src/index.ts` — the composition root, and the only place routes mount.
- `apps/api/src/route-manifest.test.ts` — the enumeration that makes a duplicated
  route unrepresentable, and the two overlapping-`/api/v1/runs` defect it was
  written for.
- `apps/api/src/errors/boundary.ts` — the single boundary, with a stable `code` per
  response.
- `pnpm typecheck` and `pnpm --filter @automate/api test` — the factory signatures
  and the per-builder tests.
