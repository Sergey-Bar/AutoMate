# Coverage

<!-- generated: do not edit this block by hand -->

Generated from `coverage-baseline.json` — the **floors** the ratchet compares
against, not a measured run. A floor only moves up, so this page cannot report
a number that has not been earned.

The numbers above are derived. To change one, edit the file this page names as
its source, then run `pnpm site:generate`.

There is no per-package Vitest threshold, and that is deliberate: a threshold that
blocks every run gets raised until it means nothing. `pnpm coverage:ratchet` fails
on a regression instead.

| Package                      | Statements | Branches | Functions | Lines |
| ---------------------------- | ---------- | -------- | --------- | ----- |
| `apps/api`                   | 95.26      | 86.16    | 94.6      | 97.27 |
| `apps/runner`                | 70.14      | 57.88    | 66.43     | 72.01 |
| `apps/tui`                   | 70.4       | 64.51    | 89.47     | 73.25 |
| `apps/web`                   | 96.18      | 88.47    | 96.34     | 98.23 |
| `apps/worker`                | 63.21      | 56.74    | 69.02     | 64.88 |
| `packages/auth`              | 100        | 100      | 100       | 100   |
| `packages/automation`        | 94.57      | 85.5     | 89.65     | 96.52 |
| `packages/config`            | 92         | 96.29    | 100       | 95    |
| `packages/connectors/github` | 100        | 100      | 100       | 100   |
| `packages/connectors/jira`   | 100        | 100      | 100       | 100   |
| `packages/connectors/sdk`    | 100        | 100      | 100       | 100   |
| `packages/connectors/slack`  | 100        | 100      | 100       | 100   |
| `packages/db`                | 71.62      | 67.07    | 55.46     | 73.09 |
| `packages/orchestration`     | 92.5       | 100      | 100       | 91.89 |
| `packages/projects`          | 91.75      | 72.29    | 91.54     | 95    |
| `packages/realtime`          | 94.5       | 91.07    | 100       | 95.06 |
| `packages/reporter`          | 92.4       | 86.78    | 97.5      | 94.26 |
| `packages/reporting`         | 95.34      | 98.73    | 96        | 94    |
| `packages/runner-sdk`        | 93         | 90.04    | 100       | 93.58 |
| `packages/shared-contracts`  | 99.27      | 97.72    | 97.22     | 99.25 |
| `packages/ui`                | 67.13      | 84.27    | 67.85     | 66.46 |
| `tests/integration`          | 88         | 68       | 96        | 87    |
| `tools/migrate-cli`          | 59.12      | 41.89    | 85.48     | 59.83 |

<!-- /generated -->
