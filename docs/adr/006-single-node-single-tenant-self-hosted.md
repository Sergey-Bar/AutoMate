# ADR-006: Single node, single tenant, self-hosted, English only

**Status:** accepted
**Date:** 2026-09-26
**Supersedes:** —

## Context

The product sells an **evidence guarantee**, not a feature count: every number it
shows traces to something it measured, and anything it has not built is labelled
rather than implied. That thesis has a cost, and the cost has to be paid explicitly
or the thesis becomes a slogan.

Four things the product deliberately does not do:

- **Multi-tenant isolation.** `WORKSPACE_ID` is the only tenancy boundary in the
  system. A workspace-scoped read or write needs a cross-workspace isolation test,
  and there is no row-level security beneath it.
- **Hosted SaaS.** Installation is one compose file on one machine.
- **iOS device execution.** The five agent domains are browser, api, load, security
  and mobile; four of the five answer an explicit `501 NOT_CONFIGURED` naming the
  domain and the action rather than pretending.
- **A second language.** English only, with the extension point documented rather
  than pre-built.

## Decision

**Single node. Single tenant. Self-hosted. English only.** And the reference
hardware is a self-hosted single-node install — explicitly **not** a GitHub runner,
which is why the rendering budget's job is `pr-reporting` and not a required check
until somebody records a run on that hardware (ledger **PERF-1**).

## Consequences

- **The rendering gate cannot be `pr-blocking` yet.** A required check that can
  never pass blocks every pull request, teaches reviewers to read red as noise, and
  hides the failures that matter. `scripts/lib/render-gate-phase.mjs` derives the
  tier from whether a baseline is recorded, and a test fails if only one of the two
  halves of graduating it happened.
- **The five execution engines are BK-1, not v1.0.0.** The agent routes answer
  `501` today and say so; the features endpoint is derived from the same registry
  and reports `available: false` for every domain, which is the honest answer and is
  derived rather than typed.
- **The tenancy migrations are the largest irreversible work in the tree, and the
  rehearsal that was meant to come first never ran** (ledger **RF-5**, now an `open`
  Blocker with `docs/quality/wave-gates.json` behind it). This record's own
  single-tenant posture did not prevent them; it only made the gap unowned, which is
  why the gate now reads the wave rather than the prose.
- **Coverage floors are per-package and ratcheted, not per-package thresholds.** A
  threshold that blocks every run gets raised until it means nothing.
- Documentation is in English, and the site's only allowed aspirational claim is on
  a page that is labelled as not-built.

## Evidence

- `apps/api/src/routes/agent-registry.ts` and `apps/api/src/routes/health.ts` — the
  derived features endpoint and the per-domain availability the dispatch uses.
- `apps/api/src/routes/agents.ts` — the `501 NOT_CONFIGURED` beside the `404`, and
  `agents.test.ts` pinning the difference.
- `apps/api/src/config.ts` — `WORKSPACE_ID` as the tenancy boundary, and
  `PUBLIC_APP_URL` defaulting to the local web origin.
- `scripts/lib/render-gate-phase.mjs` and `performance/rendering-budget.json` — the
  derived tier and the unrecorded baseline behind it.
- `docs/quality/coverage-exclusions.md` and `coverage-baseline.json` — the
  per-package floors the ratchet compares against.
- `pnpm status:10` — §17's twelve points, with `not_configured` as a first-class
  outcome rather than a failure.
