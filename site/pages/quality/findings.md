# Findings

<!-- generated: do not edit this block by hand -->

Generated from `docs/quality/findings-ledger.json`. The ledger is a record of
what is _known_ to be wrong, and `pnpm findings:check` fails when a `fixed` row
loses its evidence — so a row here is a claim with a path behind it.

The numbers above are derived. To change one, edit the file this page names as
its source, then run `pnpm site:generate`.

| Status           | Rows |
| ---------------- | ---- |
| `debt`           | 11   |
| `false-positive` | 6    |
| `fixed`          | 257  |
| `open`           | 5    |

## Open (5)

| Band  | Open |
| ----- | ---- |
| Minor | 5    |

| ID          | Band  | Finding                                                                                                         |
| ----------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| `RUNTIME-1` | Minor | Node 26 is available and deliberately gated on an LTS date that has not arrived                                 |
| `DEP-3`     | Minor | Effect 4.0.0 is unblocked at the bootstrap boundary, and its own test helper is the one part not available here |
| `DEP-4`     | Minor | TypeScript 7.0.2 is stable and has no Compiler API, so the checker and the linter cannot share a version        |
| `DEP-5`     | Minor | PostgreSQL 18 is the correct target and 19 is not available, and 16 is not an exposure while it waits           |
| `PRO-19`    | Minor | Minor edges of several workspaces, enforced SSO and restore that the review found and this wave left open       |

<!-- /generated -->
