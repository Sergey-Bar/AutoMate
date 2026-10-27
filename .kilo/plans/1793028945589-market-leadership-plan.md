# Market leadership: test intelligence that acts on CI

Decided with the repository owner on 2026-10-26: beat Trunk, BuildPulse, ReportPortal, Allure,
Currents, Testmo and Datadog Test Optimization on the test-intelligence layer, as an MIT,
self-hosted, single-install product. No compromises on evidence, no over-engineering: reuse the
engine that exists (flake cost, failure clusters, quarantine, SSE, the CLI, the GitHub connector).

## Rules

- Every claim ends as a `real` capability-register row, with tests written to fail first.
- **An automated action may never hide a deterministic failure.** Auto-quarantine acts only on
  evidence a code change cannot explain: a retry that passed inside one run, or two outcomes on one
  commit. A flip across commits is a suggestion, never an action.
- Quarantine excuses a failure at the gate; it never rewrites a result. The run stays `failed`.
- `automate test` keeps the command's own exit code whenever the server's verdict is missing,
  unparsed, or the report carries an error outside a test.

## Defects found while planning

- The test identity collapsed Playwright projects: `projectName` was read by nothing, so one test
  in chromium and webkit was one key, and a webkit-only failure scored as flaky.
- `countFlips` in `apps/api/src/execution/insights.ts` counted verdict changes across commits, so a
  test that caught a regression and then passed after the fix scored as flaky.
- Quarantine was stored and never enforced: `evaluateQualityGate` in
  `apps/api/src/execution/quality-gate.ts` did not read it.
- Every package declared `"UNLICENSED"` under an MIT root `LICENSE`.

## Tasks

0. Commit this plan.
1. Packages are MIT; the CLI is publishable from a tag-triggered workflow.
2. One test identity (file, describe path, title, project), written to `tests.stable_id`.
3. Flake evidence split into retry, same-commit and cross-commit; only the first two are
   auto-eligible.
4. Approved quarantine excuses failures in the gate.
5. `automate test -- <command>`: the wrapper that makes an excused failure leave CI green.
6. Auto-quarantine policy (`off`, `suggest`, `auto`), released after 20 clean runs.
7. Per-test history from an indexed query.
8. Triage labels on failure signatures that recur.
9. Make `reporting.advanced-analytics` honest.
10. A live Playwright reporter with failure artifacts.
11. Duration-balanced sharding.
12. An Allure-results importer.
13. An honest comparison page, including where AutoMate loses.

## Deferred on purpose

Test-case management (a separate product), test impact analysis (needs per-test coverage), early
flake detection (the next step; reuses the identity), an embedded trace viewer, GitHub check runs
(need a GitHub App), ML clustering, SSO.
