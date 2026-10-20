# ADR-012: Node 24 engine behind a typed loopback interface

**Status:** proposed
**Date:** 2026-10-19
**Supersedes:** —

## Context

The product needs an engine that scans, parses and (later) runs commands, and a user
interface. [ADR-008](./008-staged-delivery-engine-and-loopback-ui-first.md) fixes the
staging: engine and interface first, desktop shell later. This record fixes what the engine
is written in and how the interface talks to it.

Constraints: one to three engineers, MIT licence, portable code that already exists in this
repository is TypeScript on Node, and the feasibility work ran on Node.

## Decision

Proposed:

1. **The engine is Node 24 and TypeScript**, in the existing toolchain. No Rust core unless
   a spike shows a need that Node cannot meet.
2. **The engine and the interface talk over HTTP on the loopback interface**, with
   server-sent events for live updates. Request and response shapes are Zod schemas shared
   by both sides. The port is assigned by the operating system. A per-launch bearer token is
   required, the `Host` and `Origin` headers are checked, and no cross-origin access is
   allowed. There is no WebSocket and no remote access.
3. **Errors carry a stable code**, like the server platform's single error boundary, so a
   client can act on them.
4. **Events are versioned and replayable** with a cursor, so a reconnecting client resumes
   without gaps.
5. **The engine is a library with a thin launcher.** Everything the interface does is a call
   a test can make without a browser.

## Consequences

- One language and toolchain for everything the team maintains.
- A Node runtime ships with the product. Embedding it in a desktop shell is part of the
  shell prototype.
- The loopback interface is an attack surface and has its own entries in the threat model.
- A native helper is needed on Windows for job-object termination
  ([ADR-011](./011-execution-safety-posture-no-isolation-in-the-first-release.md)); that is
  the one place Node alone is not enough.

## Evidence

- `packages/shared-contracts` — Zod contracts with versioned events and a replay cursor,
  the pattern reused.
- `apps/api/src/errors/boundary.ts` — the single error boundary with stable codes.
- [`docs/local/feasibility.md`](../local/feasibility.md) — every spike ran on Node with no
  dependencies.

## Implementation note (2026-10-19)

The engine and its loopback interface are implemented in `local/src` as plain Node with JSDoc
types. The typed contracts in `packages/shared-contracts` style (Zod schemas) are not used,
because no dependencies could be installed; request validation is written by hand and tested.
See [implementation-status.md](../local/implementation-status.md).
