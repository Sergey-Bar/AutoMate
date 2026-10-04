# Findings

<!-- generated: do not edit this block by hand -->

Generated from `docs/quality/findings-ledger.json`. The ledger is a record of
what is _known_ to be wrong, and `pnpm findings:check` fails when a `fixed` row
loses its evidence — so a row here is a claim with a path behind it.

The numbers above are derived. To change one, edit the file this page names as
its source, then run `pnpm site:generate`.

| Status           | Rows |
| ---------------- | ---- |
| `debt`           | 7    |
| `false-positive` | 6    |
| `fixed`          | 144  |
| `open`           | 7    |

## Open (7)

| Band  | Open |
| ----- | ---- |
| Major | 7    |

| ID        | Band  | Finding                                                                                                                   |
| --------- | ----- | ------------------------------------------------------------------------------------------------------------------------- |
| `C-4`     | Major | The execution store is 2 166 lines and holds two of the top complexity offenders                                          |
| `RF-9`    | Major | The performance gate compares real traffic to thresholds nobody ever measured                                             |
| `RF-11`   | Major | No OpenAPI document exists, and a deferred back-item's entry criterion is that it does                                    |
| `PERF-1`  | Major | The rendering budget exists and has never been measured, so the gate is red by design                                     |
| `RF-6e`   | Major | No case proves a job runs worker → runner → API on PostgreSQL, end to end                                                 |
| `REG-1`   | Major | A register row's status was asserted against a tree that had since moved, and the whole gate chain read green             |
| `GLASS-1` | Major | Glass ships against a measured rule instead of a total ban, with the timing half of the rendering budget still unmeasured |

<!-- /generated -->
