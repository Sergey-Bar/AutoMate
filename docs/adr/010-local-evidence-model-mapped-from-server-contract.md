# ADR-010: A separate local evidence model, mapped one way from the server contract

**Status:** proposed
**Date:** 2026-10-19
**Supersedes:** —

## Context

The server platform's canonical run contract (`automate.run@2`) is the nearest existing
model for test evidence, and its adapters read JUnit XML and Playwright JSON. It cannot
express several cases the local product must handle: a run with zero tests, a test that
errored as distinct from one that failed, a test that was never run, and a report with no
workspace. Its quality gate also expects verified proof that the adapters never produce.
The list is in `docs/local/data-contracts.md`.

Two ways to close the gap were considered.

**A. Extend the shared contract** with the missing values. Every exhaustive table keyed on
its status (several are written so that a missing row fails to compile) would need a new
row, in a package whose consumers include the server API, the database and the web client.
That changes the server platform to suit a product that must not depend on it.

**B. A separate local model** with its own vocabulary and a one-way mapping from the
contract. The local product can reuse the contract's adapters where they are portable and
define what they cannot say.

## Decision

Proposed: **option B.**

- The local model defines its own outcomes, run statuses and completeness values.
- A mapping table from every contract status to a local outcome is kept in
  `docs/local/data-contracts.md` and in code. A test derives the contract's list of
  statuses from its schema source and fails when the table, the code, or the contract
  disagree in either direction. This is the only coupling between the two models, and it
  is checked rather than trusted.
- The local product never writes to the contract and never changes it.
- Whether the adapters are reused by import, or re-implemented in the local product, is
  not decided here. The feasibility spike used a small independent reader so that the
  model could be tested without the adapters; it does not show how the adapters behave.

## Consequences

- Two vocabularies exist. The mapping test is what stops them drifting.
- A concept added to the contract later forces a decision here, by failing the test. That
  is intended.
- Reuse of the adapters is a separate, later piece of work with its own tests: run the
  fixture corpus through the real adapters and compare with the goldens.

## Evidence

- `packages/shared-contracts/src/schemas/canonical-reporting.ts` — the contract and its
  status list.
- `packages/reporting/src/policy.ts` — the exhaustive classification of those statuses.
- `scripts/lib/blueprint-consistency.test.mjs` — the documentation side of the mapping
  check.
- `local/test/corpus.test.mjs` — the code side of the mapping check and
  the fixture goldens.
- [`docs/local/feasibility.md`](../local/feasibility.md) — RISK-1: the model was exercised
  against real and handwritten reports and needed outcomes, run statuses and a zero-test
  case that the server contract cannot express. The real adapters were not run against the
  same corpus, so whether they can be reused unchanged is unverified.
