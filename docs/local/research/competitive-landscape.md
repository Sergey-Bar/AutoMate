# AUTOMATE (local) — competitive landscape

**Status:** Draft
**Owner:** maintainers
**Last reviewed:** 2026-10-19

What exists today for the problems AUTOMATE (local) is meant to address, what is verifiably
true of each, what is only the vendor's claim, and where this product could be different
rather than merely similar.

## How to read this

- **Facts** are things read from an official page or file on the date in the
  [source register](./sources.md): where a product runs, its licence, its published price.
  They are as old as the access date.
- **Claims** are what a vendor says its product does or achieves. None was tested. Every
  table cell that rests on a claim says `claimed`, and a gate fails the document otherwise.
- **Gaps in the research.** Pages were fetched by a tool that could not read some sites. A
  product that is thin below is thin because its pages could not be read or because only
  one page was read, not because it is thin. See the end of the source register.
- **Absence is not evidence.** "Not documented in the pages read" means exactly that. It
  does not mean the product lacks the feature.
- Nothing here is an opinion about quality. Nobody was asked, and nothing was run.

## Products and how much was read

| Product                   | Category                                 | Read                                   |
| ------------------------- | ---------------------------------------- | -------------------------------------- |
| Allure Report 3           | Local report generation                  | Repository readme, docs index, licence |
| ReportPortal              | Self-hosted test results platform        | Repository readme and licence only     |
| Playwright reports        | Framework-native reporters and merging   | Reporter and sharding pages, licence   |
| Datadog Test Optimization | Hosted test observability                | Documentation overview only            |
| BuildPulse                | Hosted flaky-test detection              | Home page only                         |
| Trunk Flaky Tests         | Hosted flaky-test detection              | Overview and pricing                   |
| Currents                  | Hosted Playwright dashboard              | Overview and pricing                   |
| Codecov                   | Hosted coverage                          | Setup guide and pricing                |
| SonarQube Community Build | Static analysis and coverage on new code | Repository readme                      |
| VS Code Test Explorer     | Editor test integration                  | Testing documentation                  |
| JetBrains IDE test runner | Editor test integration                  | Page returned no content: unverified   |
| Develocity                | Build and test analytics                 | Page returned no content: unverified   |

## Facts

| Product                   | Where it runs                                                                                                                                  | Licence and price, as published                                                                                              | Sources          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Allure Report 3           | On the user's machine through a package-manager command that wraps the test command; reads a results directory                                 | Apache-2.0 as reported by GitHub; no price                                                                                   | S-05, S-07       |
| ReportPortal              | Self-hosted server made of several services (API, UI, authorization, analyzer, gateway, message broker, object storage), installed with Docker | Apache License 2.0 in the repository; price not read (site refused the request)                                              | S-08, S-09       |
| Playwright reporters      | In the test runner; the HTML report is a self-contained folder; blob reports from shards are merged into one report                            | Apache-2.0 as reported by GitHub; no price                                                                                   | S-10, S-11, S-12 |
| Datadog Test Optimization | Hosted service, reporting through an agent or directly                                                                                         | Not read: price and licence unverified; features are claimed                                                                 | S-13             |
| BuildPulse                | Hosted service with a CI step; also sells hosted CI runners                                                                                    | Published plan price on a page whose other figures are claimed: analytics from $99 a month billed yearly; licence unverified | S-16             |
| Trunk Flaky Tests         | Hosted service; on-premise described as a private preview                                                                                      | Free for teams of up to five committers; paid tiers above; licence unverified                                                | S-14, S-15       |
| Currents                  | Hosted service and dashboard for Playwright and CI                                                                                             | Usage-based: a base tier then a per-thousand-results price on each paid tier; licence unverified                             | S-17, S-18       |
| Codecov                   | Hosted service; needs an account, a code-host app, a repository token and an uploader step in CI                                               | Free tier for a single user with 250 private uploads a month; paid tier $12 per user per month; server licence unverified    | S-19, S-20       |
| SonarQube Community Build | Self-managed server                                                                                                                            | Free and open source; LGPL v3 stated by a repository badge, not a licence file; commercial editions add features             | S-21             |
| VS Code Test Explorer     | In the editor; discovery, run, debug and coverage depend on language or test extensions                                                        | Not read                                                                                                                     | S-22             |

## Claims, not tested

| Product                   | Claimed                                                                                                         | Source |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ |
| Allure Report             | claimed: framework-agnostic with guides for a large number of frameworks and CI systems                         | S-06   |
| Datadog Test Optimization | claimed: reads JUnit XML; flaky-test detection and automatic retries as opt-in features; test impact analysis   | S-13   |
| BuildPulse                | claimed: finds and quarantines flaky tests with no SDK; hosted runners faster and cheaper by stated percentages | S-16   |
| Trunk Flaky Tests         | claimed: detects, tracks, quarantines and ticketed flaky tests in any language or framework                     | S-14   |
| Currents                  | claimed: explains a suite over time, shortens pipelines, distributes tests across CI jobs                       | S-17   |

## What people do today

Read from the pages above; where it goes beyond what a page says, it is labelled.

- **Sharded runs are merged after the fact.** Playwright's own guidance is to write a blob
  report in each shard and run a merge step in a final job (S-11). `hypothesis`: this is the
  common shape of multi-machine runs, and a reader of the final report cannot tell from it
  whether every shard arrived. Test with real CI configurations from the corpus plan.
- **A report is generated by wrapping the test command.** Allure's run command takes the
  test command as its argument and looks for a results directory (S-05). `hypothesis`: people
  accept running their tests through a reporting tool when it asks for no change to the tests.
- **Coverage and flakiness services need an account and a CI step.** Codecov requires an
  account, a code-host app and an upload step (S-19); the hosted flaky-test services are
  cloud products (S-14, S-16). `hypothesis`: some teams cannot or will not send results to a
  third party, and a local tool would be their only option. This needs asking, not assuming.
- **Editors discover tests through per-framework extensions** (S-22). `hypothesis`: a person
  who opens an unfamiliar repository does not know which framework, command or report
  location it uses, and has to find out by reading files.

## Differentiation matrix

A product's cell holds a fact with its source, a claim marked `claimed`, or "not documented
in the pages read". The AUTOMATE (local) row is a proposal, not a capability.

| Product                   | Runs with no account or server       | Reads reports other tools produced                                            | Reconciles several reports of one run             | Shows missing or partial data explicitly                | Keeps history across CI runs                   |
| ------------------------- | ------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------- |
| AUTOMATE (local)          | Proposed: yes                        | Proposed: JUnit, Playwright JSON, lcov first                                  | Proposed: group, never merge, flag contradictions | Proposed: unknown, partial and rejected are first-class | Proposed: local history of ingested runs only  |
| Allure Report 3           | Yes, a local command (S-05)          | Its own results format (S-05); other formats not documented in the pages read | Not documented in the pages read                  | Not documented in the pages read                        | Not documented in the pages read               |
| ReportPortal              | No: several services (S-08)          | Not documented in the pages read                                              | Not documented in the pages read                  | Not documented in the pages read                        | Not documented in the pages read               |
| Playwright reports        | Yes, in the runner (S-10)            | Its own results only (S-10)                                                   | Merges shards of one Playwright run (S-11)        | Not documented in the pages read                        | Not documented in the pages read               |
| Datadog Test Optimization | No: hosted                           | claimed: JUnit XML (S-13)                                                     | Not documented in the pages read                  | Not documented in the pages read                        | claimed: history and flaky detection (S-13)    |
| BuildPulse                | No: hosted                           | claimed: results from any CI (S-16)                                           | Not documented in the pages read                  | Not documented in the pages read                        | claimed: compares results across builds (S-16) |
| Trunk Flaky Tests         | No: hosted                           | claimed: framework-agnostic (S-14)                                            | Not documented in the pages read                  | Not documented in the pages read                        | claimed: execution history per test (S-14)     |
| Currents                  | No: hosted                           | claimed: Playwright (S-17)                                                    | Not documented in the pages read                  | Not documented in the pages read                        | claimed: runs across repositories (S-17)       |
| Codecov                   | No: account and code-host app (S-19) | Coverage reports (S-19)                                                       | Not documented in the pages read                  | Not documented in the pages read                        | Coverage trends over time (S-19)               |
| SonarQube Community Build | Yes, self-managed server (S-21)      | Not documented in the pages read                                              | Not documented in the pages read                  | Not documented in the pages read                        | Not documented in the pages read               |

## Where AUTOMATE (local) does not win

Said plainly, so the product is not sold against a strawman.

- **History across many CI runs.** The hosted services see every run in CI. A local product
  sees what is on the machine: reports it was pointed at and runs it executed. Flakiness
  needs many runs of one code state, and local data will often not have them.
- **Pull-request integration, merge queues, quarantine in CI.** These need a service that
  sits in the pipeline. Out of scope.
- **Mature report visualisation.** The framework reporters and Allure are polished and
  widely used for reading one run. Matching them is not the aim.
- **Orchestration and cost reduction in CI**, which some hosted products claim. Out of scope.
- **Static analysis depth** (SonarQube) and **editor integration** (VS Code, JetBrains). Out
  of scope, and complementary.
- **Team features**: shared dashboards, ownership, alerts. Deliberately later, if ever.

## Where it could be different, and what has to be true

Each is a `hypothesis` about a gap, not a finding. None of the pages read describes the
behaviour, which is weak evidence of absence and is not proof of it.

| ID  | Hypothesis                                                                                                                                          | How to test it                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| H-1 | A tool that reads existing reports from several tools into one honest model, with no account and no change to the repository, is useful on its own. | Put the first slice in front of automation engineers with repositories they already have; watch whether the first screen answers a question they had. |
| H-2 | Showing "unknown", "partial" and "contradicted" as results, not hiding them, is something users value and existing tools do not foreground.         | Ask users what they do today when a shard is missing or two reports disagree; compare with the corpus cases.                                          |
| H-3 | Discovering which test tools, commands and report locations a repository has is valuable to people arriving at a repository they did not write.     | Time a newcomer with and without the discovery view on a repository in the corpus plan.                                                               |
| H-4 | A meaningful group of teams will not send test results to a third party.                                                                            | Ask. Do not infer from the existence of self-hosted products.                                                                                         |

## Positioning statement (proposal)

For the person who has to answer "what do our tests actually tell us?" in a repository with
more than one test tool, AUTOMATE (local) is a local application that finds the tests and
reports already there, reads them into one model without inventing anything, and shows what
is known, what is missing and what disagrees, with every number traceable to the file it
came from. Unlike hosted dashboards it needs no account and sends nothing anywhere, and
unlike a single framework's report it reads more than one tool.

This is a positioning to test with H-1 to H-4. It does not claim the product is unique or
better.

## What to learn, and what to avoid

- **Learn from Playwright's blob and merge design** that per-shard artifacts with stable names
  make a merge step possible, and that a run's completeness is a property of how many
  shards were merged (S-11).
- **Learn from Allure's wrap-the-command shape** that people will run tests through a
  reporting tool if it asks for nothing else (S-05), as input to the later runner.
- **Learn from the hosted services** that quarantine and ticketing are what teams reach for
  once flakiness is known (S-14). Not an early scope item here.
- **Avoid** a server and several services as the price of entry (S-08), an account as the
  price of reading your own results (S-19), and any metric whose denominator quietly
  changes.
- **Avoid** presenting a vendor's own speed and cost figures as findings (S-16).
