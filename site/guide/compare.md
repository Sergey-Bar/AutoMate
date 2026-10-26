# How AutoMate compares

This page says what AutoMate does today and where it does not. The AutoMate column is checked
against the [capability register](/pages/capabilities); each row there names the test that exercises it.

**The competitor columns are not checked.** They describe the category each product is known for,
written from general knowledge of those products. They change, and a vendor page beats this one.
Where a cell says "yes" about another product, read it as "that product is built around this"
and verify before you decide on it.

## The short version

AutoMate is MIT-licensed and runs on one machine you control. Its edge is **test intelligence you
can read and self-host**: flaky-test handling that acts on evidence, a quarantine that is
enforced in CI, per-test history, and a deliberately small number of moving parts. It is **not**
a test-case management tool, and it does not have the long tail of integrations or the
polish of products that have had a team on them for a decade.

## By category

| Need                                              | AutoMate                                                                                                                                                      | Where the others lead                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Flaky tests** (Trunk, BuildPulse, Datadog)      | Evidence-based: a retry pass or a same-commit disagreement is required before anything is automatic; a cross-commit flip only ever produces a suggestion.     | Hosted products run it across many repositories and have years of tuning on real flake patterns.       |
| **Quarantine in CI**                              | `automate test` exits 0 only when the server says every failure is an approved quarantined test. The run and test rows stay `failed`; the excuse is recorded. | Some products wrap more test runners natively. AutoMate reads JUnit and Playwright JSON.               |
| **Triage** (ReportPortal, Allure TestOps)         | Failure causes are clustered by message; you label them `product`, `test`, `environment` or `known-issue`, and the label follows every recurrence.            | ReportPortal has ML-assisted auto-analysis. AutoMate has none, on purpose: clustering is by message.   |
| **CI orchestration** (Currents)                   | `automate shard` balances files by median duration so shards finish together, and prints every file when the plan is unavailable.                             | Currents orchestrates at the worker level at run time. AutoMate plans before the run starts.           |
| **Live results**                                  | `@automate/playwright-reporter` streams a run and uploads failure traces, screenshots and videos. Needs database mode for artifacts.                          | Hosted dashboards ship an embedded trace viewer. AutoMate gives you the file to open locally.          |
| **Migrating off Allure**                          | `format=allure-results` imports Allure 2 result files. Identity follows Allure's own `historyId` inputs.                                                      | TestOps history, test cases and launches are not imported.                                             |
| **Test-case management** (Testmo, Allure TestOps) | **Not built.**                                                                                                                                                | This is the main reason to choose them. If you manage manual cases and plans, AutoMate is not for you. |
| **Test-impact analysis, early flake detection**   | **Not built.**                                                                                                                                                | Datadog and others offer both.                                                                         |
| **GitHub check runs**                             | **Not built.** The pull-request comment is posted with a token; a check run needs a GitHub App.                                                               | Hosted products install as an app.                                                                     |
| **SSO / SAML**                                    | **Not built.** Access is by token, session and an optional LAN mode.                                                                                          | Standard in the hosted products.                                                                       |
| **Licence and hosting**                           | MIT. One server, PostgreSQL, no telemetry to a vendor. You operate it.                                                                                        | Hosted products are operated for you, with support and SLAs. Some are open core.                       |

## What has and has not been verified

- **Verified by tests in this repository:** the quarantine and flake rules (property-tested), the
  shard planner (property-tested), the reporter against real Playwright 1.64, the artifact route in
  database mode on PGlite, and cross-workspace isolation for the new routes.
- **Verified end to end against a real HTTP server:** `automate test`, with exits 0, 1 and 1 as designed.
- **Not verified:** delivery to real GitHub (only mock adapters ran), publishing the packages to npm
  (it needs the owner's npm token, and whether the `@automate` scope is free was not checked), and a
  Docker plus PostgreSQL end-to-end run.
- **Not benchmarked:** there is no head-to-head performance comparison on this page, and none is claimed.

## Choosing

Pick AutoMate if you want to own your test data, read the code that decides what is flaky, and
enforce quarantine in CI without a vendor. Pick a hosted product if you need case management,
SSO, an embedded trace viewer, or a vendor to call.
