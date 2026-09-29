# Capabilities

<!-- generated: do not edit this block by hand -->

Generated from `docs/migration/capability-register.md`, which is the source of
truth for this page. A capability is not promoted because a page says it is.

- **real** — 15
- **mock** — 14
- **missing** — 2
- **deferred** — 8
- **obsolete** — 2

| Capability                                                            | Status     |
| --------------------------------------------------------------------- | ---------- |
| Reporter lifecycle ingestion                                          | `real`     |
| Run and test persistence                                              | `real`     |
| Run list, detail, quarantine, and quality gates                       | `real`     |
| Basic dashboard analytics                                             | `real`     |
| Trends, leaderboards, and performance dashboards                      | `mock`     |
| Live run updates over SSE                                             | `real`     |
| Binary artifact storage and retrieval                                 | `real`     |
| Revocable installation sessions                                       | `mock`     |
| Scoped service credentials and runner identities                      | `mock`     |
| One shared contract authority                                         | `real`     |
| PostgreSQL target schema and forward migrations                       | `real`     |
| Automation inventory and schedules                                    | `mock`     |
| Atomic job leases and fencing                                         | `real`     |
| Legacy runner enrollment and control route                            | `mock`     |
| Independently deployable OCI runner                                   | `mock`     |
| Encrypted durable runner event spool                                  | `real`     |
| **Isolation** of Playwright execution (pinned image, isolated runner) | `mock`     |
| JUnit producer adapter                                                | `real`     |
| **Evidence** from Playwright (events, artifacts, gates)               | `real`     |
| API quality domain                                                    | `deferred` |
| Performance and load quality domain                                   | `deferred` |
| Load and performance quality domain                                   | `deferred` |
| Mobile quality domain                                                 | `deferred` |
| Accessibility quality domain                                          | `deferred` |
| Security and SARIF quality domain                                     | `deferred` |
| k6 metric and threshold adapter                                       | `missing`  |
| ZAP finding and SARIF adapter                                         | `missing`  |
| Provider-backed chat                                                  | `mock`     |
| AI test generation                                                    | `mock`     |
| Browser/API/load/security/mobile agents                               | `mock`     |
| Dynamic Kilo model catalog and gateway                                | `mock`     |
| GitHub, Jira, and Slack execution                                     | `mock`     |
| Version-encrypted vault storage                                       | `mock`     |
| MCP gateway and management                                            | `deferred` |
| Fingerprinted suppression policy                                      | `deferred` |
| Product dashboard and KPI cockpit                                     | `real`     |
| Webwright, MCP, legacy automation, and admin surfaces                 | `obsolete` |
| Tauri desktop application                                             | `obsolete` |
| Resumable source migration and reconciliation                         | `mock`     |
| One root governance command surface                                   | `real`     |
| Automated repository-boundary validation                              | `real`     |

<!-- /generated -->
