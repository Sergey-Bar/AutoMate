# Findings

<!-- generated: do not edit this block by hand -->

Generated from `docs/quality/findings-ledger.json`. The ledger is a record of
what is _known_ to be wrong, and `pnpm findings:check` fails when a `fixed` row
loses its evidence — so a row here is a claim with a path behind it.

| Status           | Rows |
| ---------------- | ---- |
| `debt`           | 6    |
| `false-positive` | 4    |
| `fixed`          | 116  |
| `open`           | 9    |

## Open (9)

| Band    | Open |
| ------- | ---- |
| Blocker | 1    |
| Major   | 8    |

| ID       | Band    | Finding                                                                                                          |
| -------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `SEM-2`  | Blocker | The semgrep rule set has never run in CI, and its first execution found 1137 blocking findings                   |
| `C-4`    | Major   | The execution store is 2 166 lines and holds two of the top complexity offenders                                 |
| `C-6`    | Major   | A third of the dashboard schema is dormant                                                                       |
| `RF-6`   | Major   | Five waves carry a gate obligation that no ledger row tracks                                                     |
| `RF-9`   | Major   | The performance gate compares real traffic to thresholds nobody ever measured                                    |
| `RF-10`  | Major   | The E2E suite runs on one engine, so a rendering defect in another is invisible                                  |
| `RF-11`  | Major   | No OpenAPI document exists, and a deferred back-item's entry criterion is that it does                           |
| `PERF-1` | Major   | The rendering budget exists and has never been measured, so the gate is red by design                            |
| `E2E-3`  | Major   | Two of nineteen E2E tests still fail against a real PostgreSQL, and both are product gaps rather than test setup |

<!-- /generated -->
