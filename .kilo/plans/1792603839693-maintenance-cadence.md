# Maintenance pass — results and cadence (2026-10-21)

Closes the pass started in `1792588493736-maintenance-baseline.md`. Released as `2.3.0`.

## Before and after

| Measure                          | Baseline (`1125f1d`)             | After (2.3.0)                         |
| -------------------------------- | -------------------------------- | ------------------------------------- |
| `pnpm verify:local`              | pass                             | pass                                  |
| Ledger rows                      | 173 (155 fixed)                  | 186 (168 fixed)                       |
| New defects found and fixed      | —                                | 13 (`MNT-1`…`MNT-13`), one Critical   |
| Unconfirmed `sweep` rows         | 0                                | 0                                     |
| `pnpm audit`                     | clean                            | clean                                 |
| In-range outdated packages       | 30                               | 0                                     |
| Overrides                        | 4                                | 3 (each re-tested by removal)         |
| Cited evidence tests run by none | 1 (undetected)                   | 0, with a gate                        |
| `site:doctor` on the built site  | not run                          | 10 pass, 0 fail, 0 GAP                |
| README badges                    | stale (pnpm 10, TypeScript 5.9)  | checked by `readme-badges.test.mjs`   |

## What was deliberately not done

- **Majors held back:** Vite 8, Vitest 5, TypeScript 7 (`DEP-4`), Effect 4 (`DEP-3`),
  `@types/node` 26 (`RUNTIME-1`), Storybook 10, `@hono/node-server` 2,
  `@sentry/vite-plugin` 11, `@testing-library/jest-dom` 7. Each needs its own PR.
- **The 21 dormant tables** stay, by owner decision; `C-6` names the owner.
- **Coverage floors** for runner, worker, migrate-cli, ui and db were raised only where
  new tests landed; a focused coverage pass is the first item below.
- **`X-Forwarded-For` trust** in the login limiter needs a trusted-proxy setting
  (recorded in `MNT-7`).
- **Workspace hard boundaries** on the tables `tenancy:check` reports remain debt.
- `pnpm migrate:validate` requires `--plan` and fails as wired; it is `pr-reporting`.

## Cadence

| When      | What                                                                                       |
| --------- | ------------------------------------------------------------------------------------------ |
| Every PR  | `pnpm verify` in CI; a ledger row for any defect found or fixed.                           |
| Weekly    | `pnpm outdated -r`, `pnpm audit`, Dependabot PRs.                                          |
| Monthly   | Override review dates (next: 2026-11-21); re-read `debt` rows against removal conditions. |
| Quarterly | A package-by-package review pass; reconsider the held-back majors.                         |
