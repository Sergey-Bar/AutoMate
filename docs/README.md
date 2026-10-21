# Documentation index

The documentation lives in two places, and they do different jobs:

- **`site/` is the guide** — written for someone using or evaluating Automate, and
  published to <https://sergey-bar.github.io/AutoMate/>. Start with
  [Getting started](../site/guide/getting-started.md).
- **`docs/` is the record** — the engineering decisions and the machine-checked quality
  state the guide is built on. Most files here are read by a gate, so they stay accurate.

## Guide (site/)

| Page                                                                            | For                                             |
| ------------------------------------------------------------------------------- | ----------------------------------------------- |
| [Getting started](../site/guide/getting-started.md)                             | Install, run, and the gate chain                |
| [Core concepts](../site/guide/concepts.md)                                      | Runs, attempts, results and evidence            |
| [Sending results](../site/guide/sending-results.md)                             | Uploading Playwright, JUnit, k6 and ZAP reports |
| [Quality gates and quarantine](../site/guide/quality-gates.md)                  | How a run is judged; flaky-test handling        |
| [How this repository tests itself](../site/guide/testing-strategy.md)           | Test layers, ratchets, the fail-first rule      |
| [How this project is maintained](../site/guide/maintenance.md)                  | Ledger, dependency policy, cadence              |
| [Architecture](../site/architecture.md) and [Operations](../site/operations.md) | Runtime and running it                          |

## Records (docs/)

| Path                                                                                             | What it holds                                      | Checked by                      |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------- |
| [`quality/findings-ledger.json`](quality/findings-ledger.json)                                   | Every confirmed defect, with evidence              | `pnpm findings:check`           |
| [`quality/tenancy-scope.json`](quality/tenancy-scope.json)                                       | Which tables carry the workspace boundary          | `pnpm tenancy:check`            |
| [`quality/dependency-baseline.json`](quality/dependency-baseline.json)                           | Reviewed version of each direct dependency         | `pnpm deps:policy`              |
| [`quality/complexity-baseline.json`](quality/complexity-baseline.json)                           | The complexity ratchet                             | `pnpm complexity`               |
| [`quality/coverage-exclusions.md`](quality/coverage-exclusions.md)                               | Every coverage exclusion and its removal condition | `pnpm test:integration`         |
| [`migration/capability-register.md`](migration/capability-register.md)                           | What is real, partial, missing or deferred         | `pnpm docs:capability-register` |
| [`openapi.json`](openapi.json)                                                                   | The API surface, generated from the routes         | `pnpm docs:check`               |
| [`adr/`](adr/README.md)                                                                          | Architecture decision records                      | `pnpm docs:check`               |
| [`architecture/`](architecture/), [`operations/`](operations/), [`deployment.md`](deployment.md) | Design, runbooks and the deployment boundary       | `pnpm docs:check` (links)       |
| [`migration/`](migration/)                                                                       | How the unified repository was assembled           | historical                      |
