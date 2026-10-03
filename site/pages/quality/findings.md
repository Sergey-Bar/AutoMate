# Findings

<!-- generated: do not edit this block by hand -->

Generated from `docs/quality/findings-ledger.json`. The ledger is a record of
what is _known_ to be wrong, and `pnpm findings:check` fails when a `fixed` row
loses its evidence — so a row here is a claim with a path behind it.

| Status           | Rows |
| ---------------- | ---- |
| `debt`           | 6    |
| `false-positive` | 5    |
| `fixed`          | 134  |
| `open`           | 6    |

## Open (6)

| Band    | Open |
| ------- | ---- |
| Blocker | 1    |
| Major   | 5    |

| ID       | Band    | Finding                                                                                       |
| -------- | ------- | --------------------------------------------------------------------------------------------- |
| `RF-5`   | Blocker | The migration rehearsal never ran, and the tenancy wave landed anyway                         |
| `C-4`    | Major   | The execution store is 2 166 lines and holds two of the top complexity offenders              |
| `RF-9`   | Major   | The performance gate compares real traffic to thresholds nobody ever measured                 |
| `RF-11`  | Major   | No OpenAPI document exists, and a deferred back-item's entry criterion is that it does        |
| `PERF-1` | Major   | The rendering budget exists and has never been measured, so the gate is red by design         |
| `RF-6d`  | Major   | W2's worker-to-runner execution gate is recorded as a decision rather than as the wave's gate |

<!-- /generated -->
