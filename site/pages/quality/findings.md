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
| `fixed`          | 152  |
| `open`           | 8    |

## Open (8)

| Band  | Open |
| ----- | ---- |
| Major | 4    |
| Minor | 4    |

| ID          | Band  | Finding                                                                                                                   |
| ----------- | ----- | ------------------------------------------------------------------------------------------------------------------------- |
| `RF-9`      | Major | The performance gate compares real traffic to thresholds nobody ever measured                                             |
| `PERF-1`    | Major | The rendering budget exists and has never been measured, so the gate is red by design                                     |
| `REG-1`     | Major | A register row's status was asserted against a tree that had since moved, and the whole gate chain read green             |
| `GLASS-1`   | Major | Glass ships against a measured rule instead of a total ban, with the timing half of the rendering budget still unmeasured |
| `RUNTIME-1` | Minor | Node 26 is available and deliberately gated on an LTS date that has not arrived                                           |
| `DEP-3`     | Minor | Effect 4.0.0 is unblocked at the bootstrap boundary, and its own test helper is the one part not available here           |
| `DEP-4`     | Minor | TypeScript 7.0.2 is stable and has no Compiler API, so the checker and the linter cannot share a version                  |
| `DEP-5`     | Minor | PostgreSQL 18 is the correct target and 19 is not available, and 16 is not an exposure while it waits                     |

<!-- /generated -->
