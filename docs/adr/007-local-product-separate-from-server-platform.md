# ADR-007: AUTOMATE (local) is a separate product in this monorepo, reusing only portable parts

**Status:** proposed
**Date:** 2026-10-19
**Supersedes:** —

## Context

This repository ships a server platform: Hono, Effect, Drizzle and PostgreSQL behind a
web client, with a lease-based runner and worker ([ADR-001](./001-hono-modular-monolith.md),
[ADR-003](./003-postgres-only-durable-queue.md),
[ADR-006](./006-single-node-single-tenant-self-hosted.md)). Its install is one compose
file and a database.

The product described in `docs/local/` has a different shape. It is meant to be pointed at
a repository on the user's own machine, to work with no network after installation, to
need no database server, no container runtime and no account, and to be maintained by one
to three engineers. Those requirements cannot be met by the server platform, and
retrofitting them onto it would change the properties ADR-006 records as deliberate.

Part of the work already exists and is portable: repository detection that reads manifests
and executes nothing, report adapters that map unknown outcomes to `unknown`, and a pure
reporting policy. The rest is coupled to the server: tenancy, leases, fencing tokens and
the HTTP runner protocol.

## Decision

**AUTOMATE (local) is a separate product that lives in this monorepo.** It shares the
toolchain and may reuse a component only when all of these hold:

1. The component is pure or sits behind a narrow port (no Hono, Effect, Drizzle or
   PostgreSQL in its dependency closure).
2. It has tests that already fail when its behaviour is wrong.
3. Reuse is by import or by a one-way, tested mapping. The server platform's contracts,
   schemas and behaviour are not changed to suit the local product.

The server platform stays separate and optional. Nothing in the local product may require
it to be running, and the server platform does not depend on the local product.

Where a concept the local product needs cannot be expressed by a shared contract (for
example a run with zero tests, or an errored test as distinct from a failed one), the
local product defines its own model and maps from the shared contract in one direction. A
completeness test fails when the shared contract gains a value the mapping does not
cover. The mechanism is a later decision and is not made here.

## Consequences

- Two deployment shapes exist in one tree. Documents must say which one they describe;
  `docs/local/README.md` carries that rule.
- The local product's name is provisional. The repository already uses the name Automate
  for the server platform, so `docs/local/` calls the new product AUTOMATE (local) and
  the existing one the server platform. Final naming is an open question.
- The reuse list is a proposal until each component is extracted and its tests run in the
  new package. `docs/local/feasibility.md` records which reuse claims were exercised and
  which were not.
- This record does not authorise product code. Milestone 1 needs explicit approval.

## Evidence

- `packages/projects/src/detect/detector.ts` — detection that reads manifests only.
- `packages/reporter/src/adapters/junit-xml.ts` — a report adapter that maps a missing
  outcome to `unknown`.
- `packages/reporting/src/kpi.ts` — rates over product outcomes with `null` for an empty
  population.
- `apps/runner/src/generic-spawn.ts` — the argv, environment and working-directory
  discipline worth porting, and the termination behaviour that is not.
- [`docs/local/README.md`](../local/README.md) — the document set this record opens.
