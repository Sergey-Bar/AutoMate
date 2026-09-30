# ADR-002: Realtime is SSE over a durable outbox, never WebSocket

**Status:** accepted
**Date:** 2026-05-05
**Supersedes:** —

## Context

Run updates have to reach a browser that did not ask for a particular run, survive
a page reload, and replay what it missed. The design that was written first specified a
WebSocket transport — a design no code in this repository ever implemented — and three
documents still described one: the security runbook
named `REPORTER_SECRET` as securing "the WebSocket connection", the platform design
record described `@automate/realtime` as "Shared WebSocket logic", and the reporter
compatibility note promised WebSocket protocol support, which no code implemented.

## Decision

**Server-Sent Events over a durable outbox feed.** `GET /api/v1/events` is the one
realtime transport.

- The outbox row is written **in the same transaction** as the state change, so an
  event cannot exist without the state that caused it, or the reverse.
- The subscriber advances its cursor **only after the listener resolves**, so a
  subscriber that fails mid-batch re-reads rather than silently losing events.
- Retention gaps are signalled explicitly instead of being papered over, so a client
  knows its replay is incomplete.

`bus.publish` is non-rejecting by contract. A transport that can throw into the
transaction that wrote the outbox row would couple event delivery to the write that
produced it.

## Consequences

- **Reporters do not use the realtime transport.** They POST results over HTTP to
  `apps/api/src/routes/reporter.ts`. One transport for the browser, one for batch
  producers, and neither is a WebSocket.
- **No WebSocket means no bidirectional push**, which nothing here needs: a client
  that wants to act sends HTTP.
- **Reconnection is the browser's**, using `Last-Event-ID`, and the cursor is the
  only state it has to carry.
- A document naming a WebSocket transport without saying the product has none is a
  defect. That is `transports` in `scripts/lib/docs-drift.mjs`, and it is a gate.

## Evidence

- `apps/api/src/routes/events.ts` — the SSE route, the cursor, and the
  retention-gap signal.
- `apps/api/src/realtime/durable-realtime-bus.ts` — the PostgreSQL-backed feed.
- `packages/db/src/repositories/outbox-repository.ts` — the outbox write, in the
  caller's transaction.
- `docs/migration/capability-register.md`, row `realtime.sse` — the register's own
  statement, `real`, with the development in-memory bus called out as explicit.
- `pnpm --filter @automate/api test src/routes/events.test.ts`
