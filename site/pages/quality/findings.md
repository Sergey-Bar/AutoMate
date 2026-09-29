# Findings

<!-- generated: do not edit this block by hand -->

Generated from `docs/quality/findings-ledger.json`. The ledger is a record of
what is _known_ to be wrong, and `pnpm findings:check` fails when a `fixed` row
loses its evidence — so a row here is a claim with a path behind it.

| Status           | Rows |
| ---------------- | ---- |
| `debt`           | 1    |
| `false-positive` | 4    |
| `fixed`          | 99   |
| `open`           | 17   |

## Open (17)

| Band    | Open |
| ------- | ---- |
| Blocker | 1    |
| Major   | 12   |
| Minor   | 4    |

| ID       | Band    | Finding                                                                                                               |
| -------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `RF-5`   | Blocker | The rehearsal harness that blocks the tenancy wave does not exist, and nothing tracked it                             |
| `Q-53`   | Major   | PBKDF2 is synchronous on the request path and sealing always misses the cache                                         |
| `W-6`    | Major   | A missing run renders null and a 404 is detected by string-matching an error message                                  |
| `O-4b`   | Major   | No /metrics endpoint and no metrics library                                                                           |
| `O-5b`   | Major   | Readiness cannot report a failed store                                                                                |
| `C-2`    | Major   | The capability register contradicts itself and two of its real rows cite dead evidence                                |
| `C-4`    | Major   | The execution store is 2 166 lines and holds two of the top complexity offenders                                      |
| `C-6`    | Major   | A third of the dashboard schema is dormant                                                                            |
| `RF-6`   | Major   | Five waves carry a gate obligation that no ledger row tracks                                                          |
| `RF-9`   | Major   | The performance gate compares real traffic to thresholds nobody ever measured                                         |
| `RF-10`  | Major   | The E2E suite runs on one engine, so a rendering defect in another is invisible                                       |
| `RF-11`  | Major   | No OpenAPI document exists, and a deferred back-item's entry criterion is that it does                                |
| `PERF-1` | Major   | The rendering budget exists and has never been measured, so the gate is red by design                                 |
| `S-5`    | Minor   | lastUsedAt is a dead column                                                                                           |
| `D-4`    | Minor   | node --test interference between the scripts/lib suites                                                               |
| `C-1`    | Minor   | The plan's verified-fixed list carries no evidence for thirteen of its seventeen rows                                 |
| `RF-12`  | Minor   | A plan claim that `vitest-axe` is unused is false, and acting on it would delete working accessibility infrastructure |

<!-- /generated -->
