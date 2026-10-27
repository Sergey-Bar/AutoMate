# Capabilities

<!-- generated: do not edit this block by hand -->

Generated from `docs/migration/capability-register.md`, which is the source of
truth for this page. A capability is not promoted because a page says it is.

**What the statuses mean**, in the register's own words:

| Status       | Count | Meaning                                                                   |
| ------------ | ----- | ------------------------------------------------------------------------- |
| **real**     | 60    | implemented and exercised, with the stated qualification.                 |
| **mock**     | 9     | a route, response, or UI exists but does not provide the target behavior. |
| **missing**  | 1     | no usable implementation exists in the target.                            |
| **deferred** | 6     | intentionally outside the launch scope pending a separate decision.       |
| **obsolete** | 2     | retained only as historical residue and not part of the target product.   |

The numbers above are derived. To change one, edit the file this page names as
its source, then run `pnpm site:generate`.

| Capability                                                                                          | Status     |
| --------------------------------------------------------------------------------------------------- | ---------- |
| Prometheus metrics endpoint                                                                         | `real`     |
| Reporter lifecycle ingestion                                                                        | `real`     |
| Run and test persistence                                                                            | `real`     |
| Run list, detail, quarantine, and quality gates                                                     | `real`     |
| Basic dashboard analytics                                                                           | `real`     |
| Trends, leaderboards, and performance dashboards                                                    | `real`     |
| Live run updates over SSE                                                                           | `real`     |
| Binary artifact storage and retrieval                                                               | `real`     |
| Revocable installation sessions                                                                     | `real`     |
| Scoped service credentials and runner identities                                                    | `mock`     |
| One shared contract authority                                                                       | `real`     |
| PostgreSQL target schema and forward migrations                                                     | `real`     |
| Automation inventory and schedules                                                                  | `mock`     |
| Atomic job leases and fencing                                                                       | `real`     |
| Legacy runner enrollment and control route                                                          | `mock`     |
| Independently deployable OCI runner                                                                 | `mock`     |
| Encrypted durable runner event spool                                                                | `real`     |
| **Isolation** of Playwright execution (pinned image, isolated runner)                               | `mock`     |
| JUnit producer adapter                                                                              | `real`     |
| **Evidence** from Playwright (events, artifacts, gates)                                             | `real`     |
| API quality domain                                                                                  | `deferred` |
| Performance and load quality domain                                                                 | `deferred` |
| Load and performance quality domain                                                                 | `deferred` |
| Mobile quality domain                                                                               | `deferred` |
| Accessibility quality domain: **ingestion** of axe-core results                                     | `real`     |
| Security and SARIF quality domain                                                                   | `deferred` |
| Repository health grade, findings, triage and pull-request gate                                     | `real`     |
| SBOM inventory, VEX, licence policy and build provenance                                            | `real`     |
| Mutation-testing results as Test effectiveness                                                      | `real`     |
| Diff coverage of a commit, and its pull-request gate                                                | `real`     |
| Supply-chain and test-effectiveness scorecards per project                                          | `real`     |
| Portfolio heatmap of every dimension and scorecard                                                  | `real`     |
| Scheduled report: DORA, AI-code and agent-quality lines and the top three actions                   | `real`     |
| DORA delivery metrics and scorecard per project and portfolio                                       | `real`     |
| Pull-request flow scorecard and stale pull requests                                                 | `real`     |
| Scheduled and on-demand GitHub sync of pull requests, commits, deployments and deploy-workflow runs | `real`     |
| Deployments and incidents pushed from CI or a pager                                                 | `real`     |
| GitHub webhook receiver that starts a delivery sync                                                 | `real`     |
| AI attribution of pull requests from their own signals and their commits'                           | `real`     |
| Outcomes of AI-written change against human change, per project and portfolio                       | `real`     |
| Pull-request rules for agent-written change in the health gate                                      | `real`     |
| Eval runs uploaded from promptfoo, DeepEval, Inspect and Automate's own shape                       | `real`     |
| Eval regression gate on pull requests                                                               | `real`     |
| OTLP/HTTP JSON receiver for GenAI spans                                                             | `real`     |
| Agent runtime analytics and budgets                                                                 | `real`     |
| Agent instruction and MCP configuration scan, with the MCP server inventory                         | `real`     |
| Built-in eval runner over the AI gateway                                                            | `real`     |
| Failure clusters and quarantine suggestions in the insights                                         | `real`     |
| Quarantine that gates, automatic quarantine, and per-test history                                   | `real`     |
| Live Playwright reporter with failure traces                                                        | `real`     |
| Duration-balanced CI sharding                                                                       | `real`     |
| Allure results importer                                                                             | `real`     |
| k6 load execution and threshold adapter                                                             | `real`     |
| ZAP finding and SARIF adapter                                                                       | `missing`  |
| Provider-backed chat                                                                                | `mock`     |
| AI test proposals from surviving mutants and uncovered diff lines                                   | `real`     |
| Browser/API/load/security/mobile agents                                                             | `mock`     |
| `browser.run` through the execution pipeline                                                        | `real`     |
| `api.run` through the execution pipeline                                                            | `real`     |
| `load.run` through the execution pipeline                                                           | `real`     |
| Dynamic Kilo model catalog and gateway                                                              | `mock`     |
| GitHub, Jira, and Slack execution                                                                   | `real`     |
| Version-encrypted vault storage                                                                     | `real`     |
| Read-only MCP server over Streamable HTTP, and a stdio proxy for editors                            | `real`     |
| Upload CLI and the GitHub composite action                                                          | `real`     |
| Fingerprinted suppression policy                                                                    | `deferred` |
| Product dashboard and KPI cockpit                                                                   | `real`     |
| Webwright, MCP, legacy automation, and admin surfaces                                               | `obsolete` |
| Tauri desktop application                                                                           | `obsolete` |
| Resumable source migration and reconciliation                                                       | `mock`     |
| One root governance command surface                                                                 | `real`     |
| Automated repository-boundary validation                                                            | `real`     |
| Deployment profiles: solo, startup, team, enterprise (ADR-014)                                      | `real`     |
| Backup and restore of a local install                                                               | `real`     |
| Remote access through Cloudflare Tunnel and Cloudflare Access                                       | `real`     |
| People, OIDC sign-in and per-workspace roles (team profile)                                         | `real`     |
| Append-only, hash-chained audit trail with export and verification (enterprise)                     | `real`     |
| Enforced single sign-on with break-glass (enterprise)                                               | `real`     |

<!-- /generated -->
