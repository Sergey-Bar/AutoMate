# Findings

<!-- generated: do not edit this block by hand -->

Generated from `docs/quality/findings-ledger.json`. The ledger is a record of
what is _known_ to be wrong, and `pnpm findings:check` fails when a `fixed` row
loses its evidence — so a row here is a claim with a path behind it.

| Status           | Rows |
| ---------------- | ---- |
| `debt`           | 7    |
| `false-positive` | 5    |
| `fixed`          | 122  |
| `open`           | 10   |

## Open (10)

| Band  | Open |
| ----- | ---- |
| Major | 10   |

| ID       | Band  | Finding                                                                                       |
| -------- | ----- | --------------------------------------------------------------------------------------------- |
| `C-4`    | Major | The execution store is 2 166 lines and holds two of the top complexity offenders              |
| `RF-6`   | Major | Five waves carry a gate obligation that no ledger row tracks                                  |
| `RF-9`   | Major | The performance gate compares real traffic to thresholds nobody ever measured                 |
| `RF-11`  | Major | No OpenAPI document exists, and a deferred back-item's entry criterion is that it does        |
| `PERF-1` | Major | The rendering budget exists and has never been measured, so the gate is red by design         |
| `RF-6a`  | Major | W14's axe-green-in-both-themes gate has no row                                                |
| `RF-6b`  | Major | W15's tiering of the eight new QA gates inside the D6 budget has no row                       |
| `RF-6c`  | Major | W17's site-doctor ten checks have no row                                                      |
| `RF-6d`  | Major | W2's worker-to-runner execution gate is recorded as a decision rather than as the wave's gate |
| `G-5b`   | Major | A pull request can merge with no CI run, and nothing detects it                               |

<!-- /generated -->
