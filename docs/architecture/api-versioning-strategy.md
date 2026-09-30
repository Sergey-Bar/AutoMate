# API Versioning Strategy

> **Rewritten 2026-09-30.** The previous version chose **header-based** versioning
> (`X-API-Version`) and justified it from "Fastify compatibility" and a two-server
> topology on ports 3000, 4000 and 4001. None of that is this repository. The API is
> Hono (ADR-001), there is one server on `127.0.0.1:3000`, and no code anywhere in
> the workspace read `X-API-Version`.
>
> The API that shipped versions itself **by path**, so the decision now matches the
> code. The record is [ADR-005](../adr/005-path-versioning.md). The superseded
> header-based proposal is kept below, because a decision's reasoning is worth more
> than its conclusion, and nobody should re-derive it.

## Status

Accepted. The decision is path versioning, and the API implements it.

## Context

The product has one API, three kinds of client — the web dashboard, reporter
adapters, and runners — and a public surface that a customer writes against. A
breaking change with no version boundary is a breaking change for all three at once.

Versioning has to be visible in the tree, because a version that is negotiated at
run time is a version that nothing in the repository records.

## Decision: path prefix, one version scheme

**The version is the `/v1` in the path.** One choice, not a hybrid.

```
/health                              unversioned probe
/ready                               unversioned probe
/api/v1/health                       versioned probe, body carries version: '1'
/api/v1/ready                        versioned readiness
/api/v1/features                     derived capability catalogue
/api/v1/agents/:domain/:action       501 NOT_CONFIGURED naming the domain and action
/api/v1/runs                         create, list, cancel, retry
/api/v1/runs/:runId/gate             the gate verdict
/api/v1/events                       SSE, cursor-based replay
/api/v1/reporter/*                   producer ingestion
/runner/v1/enroll, /runner/v1/*      runner control plane
```

**No `X-API-Version` header is read.** Accepting both a path version and a header
version is two sources of truth for one fact, and a request that sends both has no
defined precedence.

### What is deliberately unversioned

`/health` and `/ready` are unversioned because a load balancer, a container
orchestrator and a human with `curl` all need one address that never moves. The
versioned `/api/v1/health` exists beside it and answers `{"version":"1"}`; the
unversioned one **omits the key entirely** rather than answering `undefined`, and
that asymmetry is pinned by `apps/api/src/routes/health.ts` and its test. The comment
in that file says why: a version field that appears and disappears with a flag is a
thing a reader can be misled by, so the difference is a decision somebody makes
rather than a diff.

`/runner/v1/*` carries its own version segment because the runner control plane has
a different lifecycle from the dashboard API: it is explicitly disabled with `503` in
production until a durable control plane replaces it
(`docs/migration/capability-register.md`, row `runner.control-plane`).

## Breaking change policy

A change is breaking if it removes an endpoint, renames a required request field,
changes the type of a response field, removes a field a consumer depends on, or
changes the status code for an error a consumer handles.

Breaking changes go into a **new** prefix. `/api/v1/` and `/api/v2/` are mounted
side by side for the deprecation window; they are never aliases of each other,
because an alias makes the two versions indistinguishable at run time and the point
of a version is that it is a different thing.

An **additive** change — a new endpoint, a new optional request field, a new
response field — is not breaking and does not need a new version. The contracts are
Zod schemas in `packages/shared-contracts`, so an additive change is a schema change
and the contract suite under `tests/contract` is what proves both sides agree.

## Deprecation

- A deprecated version is announced in the release notes, with the replacement path
  written out, not with a `Warning` header nobody reads.
- A version is removed only after the contract suite has stopped exercising it and
  the capability register has been updated. The register is the authority on what the
  product can do, so a removed endpoint is a register change first.

## Enforcement

`apps/api/src/route-manifest.test.ts` enumerates every mounted route. A route added
without a version prefix is a diff in one readable file, and the test was written
after two documents each claimed a `GET /api/v1/runs` existed — one live and one
dead — with both their own tests passing.

`pnpm test:contract` asserts the web client, the reporter adapters and the runner
SDK all parse through the same shared schemas, so a response shape cannot change
under one of them alone.

---

## Superseded proposal, kept for the record

The decision this replaces, in full, because the reasoning is what a later reader
needs and the conclusion was wrong.

> ### Versioning Scheme
>
> Semantic Versioning for API versions: `1.0.0` (Major.Minor.Patch). Clients should
> generally request a major version.
>
> ### Request Header
>
> Clients SHOULD include `X-API-Version: 1.0.0`. If omitted, the server defaults to
> the latest stable version.
>
> ### Response Header
>
> The server MUST include `X-API-Version` in all responses.
>
> ### Rationale (as written)
>
> - **Zero URL disruption** — existing clients keep current endpoints.
> - **Granular control** — version specific requests without bloating the URL space.
> - **Fastify compatibility** — trivial via Fastify hooks, no route prefixing.
> - **Roadmap alignment** — matches the specified lightweight MVP mechanism.
>
> ### Future Path: URL-Prefix Versioning
>
> "When we reach a point where multiple major versions must be maintained
> simultaneously for extended periods, or when structural changes make header-based
> routing too complex, we will transition to URL-prefix versioning (`/api/v1/`)."
>
> That transition is what the API shipped with. The deprecation window it was
> deferring arrived before the header was ever read, because a client cannot
> negotiate a version it never sends and a server cannot answer one it never reads.
