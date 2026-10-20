# AUTOMATE (local) — source register

**Status:** Draft
**Owner:** maintainers
**Last reviewed:** 2026-10-19

Every external fact in `docs/local/` is cited to a row here. A row says what the source was
read for, the date it was read, and what kind of claim it supports. A source that could not
be read is not listed as support for anything.

Claim classes are defined in the [index](../README.md). Access dates are the day the page
was fetched; a page can change after that.

| ID   | URL                                                                                                  | Supports                                                                                                                                                                              | Accessed   | Class        |
| ---- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------ |
| S-01 | https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects                               | Job objects: child processes join the job by default; closing the last handle can kill all members.                                                                                   | 2026-10-19 | verified     |
| S-02 | https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information | The kill-on-close limit flag and the breakaway limit flags.                                                                                                                           | 2026-10-19 | verified     |
| S-03 | https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill            | What the tree option of the taskkill command is documented to do.                                                                                                                     | 2026-10-19 | verified     |
| S-04 | https://raw.githubusercontent.com/libuv/libuv/v1.x/src/win/process.c                                 | Node's process library assigns children to a kill-on-close job with silent breakaway.                                                                                                 | 2026-10-19 | verified     |
| S-05 | https://raw.githubusercontent.com/allure-framework/allure3/main/README.md                            | Allure 3 is written in TypeScript with a plugin system; `run` wraps a test command; results are read from an `allure-results` directory; installed through npm.                       | 2026-10-19 | verified     |
| S-06 | https://allurereport.org/docs/                                                                       | Allure is described as framework-agnostic and open source, with integrations for CI systems and IDEs and guides for "30+" frameworks (the breadth is the vendor's own count).         | 2026-10-19 | vendor-claim |
| S-07 | https://api.github.com/repos/allure-framework/allure3                                                | The repository's licence as reported by GitHub: Apache-2.0.                                                                                                                           | 2026-10-19 | verified     |
| S-08 | https://raw.githubusercontent.com/reportportal/reportportal/master/README.md                         | ReportPortal's server side is several services (API, UI, authorization, analyzer, gateway, message broker, object storage) installed with Docker.                                     | 2026-10-19 | verified     |
| S-09 | https://raw.githubusercontent.com/reportportal/reportportal/master/LICENSE                           | The licence text in the ReportPortal repository is Apache License 2.0.                                                                                                                | 2026-10-19 | verified     |
| S-10 | https://playwright.dev/docs/test-reporters                                                           | Playwright's HTML, blob and JSON reporters and what each is for.                                                                                                                      | 2026-10-19 | verified     |
| S-11 | https://playwright.dev/docs/test-sharding                                                            | Sharding with a shard option, and merging per-shard blob reports into one report.                                                                                                     | 2026-10-19 | verified     |
| S-12 | https://api.github.com/repos/microsoft/playwright                                                    | The repository's licence as reported by GitHub: Apache-2.0.                                                                                                                           | 2026-10-19 | verified     |
| S-13 | https://docs.datadoghq.com/tests/                                                                    | Datadog Test Optimization: the features it lists, including JUnit XML as an input, agent and agentless reporting, flaky-test handling that is opt-in.                                 | 2026-10-19 | vendor-claim |
| S-14 | https://docs.trunk.io/flaky-tests                                                                    | Trunk Flaky Tests: detection, tracking, quarantine and ticketing, described as language- and framework-agnostic.                                                                      | 2026-10-19 | vendor-claim |
| S-15 | https://trunk.io/pricing                                                                             | Trunk's published plans: a free tier for up to five committers; on-premise deployment described as a private preview.                                                                 | 2026-10-19 | verified     |
| S-16 | https://buildpulse.io/                                                                               | BuildPulse: flaky-test detection and quarantine, hosted runners, AI review; published plan prices; speed and cost figures are the vendor's own.                                       | 2026-10-19 | vendor-claim |
| S-17 | https://docs.currents.dev/                                                                           | Currents: described as a cloud platform, dashboard and test orchestrator for Playwright and CI; features listed.                                                                      | 2026-10-19 | vendor-claim |
| S-18 | https://currents.dev/pricing                                                                         | Currents' published usage-based pricing.                                                                                                                                              | 2026-10-19 | verified     |
| S-19 | https://docs.codecov.com/docs                                                                        | Codecov setup needs an account, a code-host app, a repository token and an uploader step in CI.                                                                                       | 2026-10-19 | verified     |
| S-20 | https://about.codecov.io/pricing/                                                                    | Codecov's published plans, including the free tier for a single user and the per-user price of the paid tier.                                                                         | 2026-10-19 | verified     |
| S-21 | https://raw.githubusercontent.com/SonarSource/sonarqube/master/README.md                             | SonarQube Community Build is described as free and open source under LGPL v3 (a README badge, not a licence file); commercial editions add features.                                  | 2026-10-19 | verified     |
| S-22 | https://code.visualstudio.com/docs/debugtest/testing                                                 | VS Code test discovery, running, debugging and coverage depend on language or test extensions.                                                                                        | 2026-10-19 | verified     |
| S-23 | https://docs.kernel.org/userspace-api/landlock.html                                                  | Landlock lets an unprivileged Linux process restrict its own filesystem and network access, and its future children; rules are denied by default for the actions the ruleset handles. | 2026-10-19 | verified     |
| S-24 | https://raw.githubusercontent.com/containers/bubblewrap/main/README.md                               | bubblewrap builds a sandbox from kernel namespaces for unprivileged users; the protection depends entirely on the arguments it is given and it is not a ready-made policy.            | 2026-10-19 | verified     |
| S-25 | https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation                      | AppContainer isolates credentials, devices, files, network, processes and windows of an application on Windows.                                                                       | 2026-10-19 | verified     |

## Sources that could not be read

These were tried on 2026-10-19 and returned nothing usable. No claim in this directory
rests on them, and every statement about the product concerned that needed them is marked
unverified.

| Product           | What was tried                                     | Result                                            |
| ----------------- | -------------------------------------------------- | ------------------------------------------------- |
| ReportPortal      | The product site's pricing and documentation pages | Refused the request (HTTP 403).                   |
| JetBrains IDEs    | The help page on running tests                     | Returned an empty shell with no readable content. |
| Develocity        | The product page, after following its redirect     | Returned an empty shell with no readable content. |
| Datadog           | The pricing page                                   | Not fetched; price is unverified.                 |
| macOS App Sandbox | Apple's developer documentation page               | Returned an empty shell with no readable content. |
