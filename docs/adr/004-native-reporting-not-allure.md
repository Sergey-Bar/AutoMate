# ADR-004: Reporting is native evidence and KPI policy, not a reporting stack

**Status:** accepted
**Date:** 2026-09-26
**Supersedes:** —

## Context

A QA product's centre of gravity is its evidence: what ran, what failed, what the
gate decided, and why. The predecessor plan named Allure, Grafana and InfluxDB as
the reporting layer.

Those three are a reporting _stack_ — three more services, three more schemas, and
a third place for a verdict to be written down. Every one of them is also a place
where the product's central claim can be lost: a number in Grafana is a number
somebody typed into a query, and nothing in it knows whether the evidence it
summarises still exists.

## Decision

**Reporting is native.** `packages/reporter` normalises producer output,
`packages/reporting` holds the evidence, KPI and quality-gate policy, and
`apps/api` serves it from the same database the product writes.

The consequence that decides the design: **every number the product reports
traces to a row it wrote.** A KPI is a query over canonical results, not a
dashboard aggregate over a warehouse copy.

## Consequences

- **A number nobody measured is not reported as a number.** Where a budget has no
  recorded run, the state is `not_configured` with a reason — the three-outcome rule
  from the roadmap's §5.3. `performance/thresholds.json` and
  `performance/rendering-budget.json` both carry `recorded: false` for this reason,
  and their gates compare against nothing rather than against an estimate.
- **Gate verdicts are derived, not typed.** `apps/api/src/execution/quality-gate.ts`
  evaluates the policy; a run with no tests evaluates to `unknown` with
  `evidence: NO_TESTS`, never to a pass.
- **The capability table is generated** from `docs/migration/capability-register.md`,
  so a row that stops being true stops being published. A hand-written status page
  says "6 missing" because it said so in March.
- No InfluxDB, no Grafana, no Allure. Out of scope by decision, not by omission.

## Evidence

- `packages/reporting/src/kpi.ts` — KPI math, with `unknown` and
  non-product exclusions first.
- `apps/api/src/execution/quality-gate.ts` — the policy, and the `NO_TESTS` rule.
- `packages/reporter/src/adapters/junit-xml.ts` — status mapping that resolves an
  undeclared status to `unknown`.
- `scripts/build-site-pages.mjs` — the generated capability, findings and coverage
  pages, each behind a marker the generator refuses to overwrite by hand.
- `pnpm coverage:ratchet` — the recorded floors the coverage page is generated from,
  so a page cannot report a number that has not been earned.
