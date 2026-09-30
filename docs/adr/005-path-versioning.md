# ADR-005: The API is versioned by path prefix, not by header

**Status:** accepted
**Date:** 2026-09-30
**Supersedes:** the header-based proposal in
[`docs/architecture/api-versioning-strategy.md`](../architecture/api-versioning-strategy.md)

## Context

The predecessor decision document chose **header-based** versioning — an
`X-API-Version` header — for reasons that no longer hold:

- it argued from "Fastify compatibility", and the API is Hono (ADR-001);
- it was written when the product was two applications on ports 3000 and 4000 with
  a reporter on 4001, none of which is the current topology;
- it promised a webhook/MCP surface that does not exist.

Meanwhile the API that shipped versions itself **by path**: `/api/v1/runs`,
`/api/v1/events`, `/api/v1/runs/:runId/gate`, with the versioned health route
answering `{"version":"1"}` and the unversioned `/health` deliberately omitting the
key entirely.

So the code and the decision disagreed, and the code was right. Nothing read
`X-API-Version` anywhere in the workspace.

## Decision

**Path versioning.** One choice, not a hybrid.

- The version is the `/v1` in the path. A second version is a second prefix, so the
  two can be mounted, compared and retired independently.
- The unversioned paths that remain — `/health`, `/ready`, `/api/v1/features`,
  `/runner/v1/...` — are the probes and the runner control surface, and each is
  deliberate rather than an oversight.
- The versioned health body carries `version: '1'`; the unversioned one omits the
  key. `apps/api/src/routes/health.ts` states that the asymmetry is held
  deliberately, because a version field that appears and disappears with the flag is
  a thing a reader can be misled by.

## Consequences

- **No `X-API-Version` is read.** Adding header negotiation would mean two sources
  of truth for one fact, and a request that sent both.
- **A path is greppable.** "Which routes changed in this release" is a `git log` on a
  path prefix; with a header it is a runtime property nothing in the tree records.
- **`route-manifest.test.ts` is the enforcement.** A route added without a version
  prefix is a diff in one readable file.
- The header-based proposal is superseded rather than deleted: its reasoning is
  recorded here, so nobody re-derives it.

## Evidence

- `apps/api/src/routes/health.ts` — the asymmetry, and the comment stating it is
  held on purpose.
- `apps/api/src/route-manifest.test.ts` — the enumerated mounted route set.
- `apps/api/src/index.ts` — the composition root, where every prefix is mounted.
- `docs/architecture/api-versioning-strategy.md` — the superseded proposal, kept.
- `pnpm --filter @automate/api test src/route-manifest.test.ts`
