# Coverage

<!-- generated: do not edit this block by hand -->

Generated from `docs/quality/coverage-baseline.json` — the **floors** the ratchet compares
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
| `apps/runner`                | 91.4       | 85.6     | 92.8      | 92.9  |
| `apps/tui`                   | 100        | 100      | 100       | 100   |
| `apps/web`                   | 97.6       | 91       | 97.7      | 98.6  |
| `apps/worker`                | 96.1       | 91.3     | 97.3      | 97.5  |
| `packages/auth`              | 100        | 100      | 100       | 100   |
| `packages/automation`        | 94.57      | 85.5     | 89.65     | 96.52 |
| `packages/config`            | 92         | 96.29    | 100       | 95    |
| `packages/connectors/github` | 100        | 100      | 100       | 100   |
| `packages/connectors/jira`   | 100        | 100      | 100       | 100   |
| `packages/connectors/sdk`    | 100        | 100      | 100       | 100   |
| `packages/connectors/slack`  | 100        | 100      | 100       | 100   |
| `packages/db`                | 95.9       | 91.2     | 98.5      | 96.3  |
| `packages/orchestration`     | 92.5       | 100      | 100       | 91.89 |
| `packages/projects`          | 99.55      | 95.76    | 100       | 99.78 |
| `packages/realtime`          | 94.5       | 91.07    | 100       | 95.06 |
| `packages/reporter`          | 92.4       | 86.78    | 97.5      | 94.26 |
| `packages/reporting`         | 95.34      | 98.73    | 96        | 94    |
| `packages/runner-sdk`        | 93         | 90.04    | 100       | 93.58 |
| `packages/shared-contracts`  | 99.27      | 97.72    | 97.22     | 99.25 |
| `packages/ui`                | 89.6       | 86.5     | 96.5      | 90.4  |
| `tests/integration`          | 100        | 100      | 100       | 100   |
| `tools/migrate-cli`          | 95.6       | 91.6     | 98.3      | 95.5  |

<!-- /generated -->
