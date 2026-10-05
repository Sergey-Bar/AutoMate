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
| `fixed`          | 145  |
| `open`           | 13   |

## Open (13)

| Band  | Open |
| ----- | ---- |
| Major | 8    |
| Minor | 5    |

| ID          | Band  | Finding                                                                                                                   |
| ----------- | ----- | ------------------------------------------------------------------------------------------------------------------------- |
| `C-4`       | Major | The execution store is 2 166 lines and holds two of the top complexity offenders                                          |
| `RF-9`      | Major | The performance gate compares real traffic to thresholds nobody ever measured                                             |
| `RF-11`     | Major | No OpenAPI document exists, and a deferred back-item's entry criterion is that it does                                    |
| `PERF-1`    | Major | The rendering budget exists and has never been measured, so the gate is red by design                                     |
| `RF-6e`     | Major | No case proves a job runs worker → runner → API on PostgreSQL, end to end                                                 |
| `REG-1`     | Major | A register row's status was asserted against a tree that had since moved, and the whole gate chain read green             |
| `GLASS-1`   | Major | Glass ships against a measured rule instead of a total ban, with the timing half of the rendering budget still unmeasured |
| `DEP-1`     | Major | apps/api declares `effect` and imports it nowhere, while five documents describe a service layer built from it            |
| `DEP-2`     | Minor | The root declares `@axe-core/playwright` and no committed file references it                                              |
| `RUNTIME-1` | Minor | Node 26 is available and deliberately gated on an LTS date that has not arrived                                           |
| `DEP-3`     | Minor | Effect 4.0.0 is unblocked at the bootstrap boundary, and its own test helper is the one part not available here           |
| `DEP-4`     | Minor | TypeScript 7.0.2 is stable and has no Compiler API, so the checker and the linter cannot share a version                  |
| `DEP-5`     | Minor | PostgreSQL 18 is the correct target and 19 is not available, and 16 is not an exposure while it waits                     |

<!-- /generated -->
