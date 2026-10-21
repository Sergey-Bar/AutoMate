# Maintenance baseline — 2026-10-21

The starting point of the maintenance and public-showcase pass. Every number here was
measured on `main` at `1125f1d`, on a Windows development host (Node 24.21.0, pnpm
11.28.4) with no semgrep, gitleaks or k6 installed. The closing comparison is in the
cadence plan written at the end of the pass.

## Publication safety

| Check                                   | Result                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| `.env` ever committed (`git log --all`) | Never. It is ignored and has no history                                                |
| `pnpm security:secrets`                 | Pass (working tree)                                                                    |
| `pnpm security:secrets:history`         | Pass — 6 historical findings, all synthetic fixtures, each enumerated with a reason     |
| Machine paths and personal data         | One: `.vscode/mcp.json` named a home-directory binary path. Fixed in this pass         |

## Gates

| Gate                     | State                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `pnpm verify:local`      | Pass (semgrep and gitleaks recorded as `not_configured`, as the host-scanner policy allows) |
| `pnpm findings:check`    | Pass                                                                                        |
| `pnpm deps:policy`       | Pass — nothing to report                                                                    |
| `pnpm tenancy:check`     | Pass — 20 workspace-scoped tables without a hard boundary reported, not failed              |
| `pnpm audit`             | No known vulnerabilities                                                                    |
| `pnpm status:10`         | 0 pass · 0 fail · 12 `not_configured` (it reads committed files and runs no gate)           |

## Findings ledger

173 rows: 155 `fixed`, 6 `false-positive`, 7 `debt`, 5 `open`. **Zero unconfirmed
`sweep` rows**, so the sweep-confirmation task has nothing to do.

- `debt`: X-3, D-4, C-6, UI-1, Q-1, CAP-1, SITE-1
- `open`: REG-1 (Major), RUNTIME-1, DEP-3, DEP-4, DEP-5 (Minor — each a deliberately
  deferred upgrade with its blocker named)

## Dependencies

Within the current majors, 30 packages have a newer release — React 19.3, Playwright
1.64, Sentry 11.8, TanStack Router, Zod 4.6, ESLint 10.13, Prettier 3.9, turbo 2.11 and
the `pg` family among them.

Fifteen are a major behind. Taken in this pass: **jsdom 24 → 30** (test-only). Left,
each for a reason: Vite 8 and `@vitejs/plugin-react` 6 (the VitePress override pins the
documentation site to Vite 6), Vitest 5 and its coverage plugin (move with Vite),
TypeScript 7 (`DEP-4`), Effect 4 (`DEP-3`), `@types/node` 26 (`RUNTIME-1`), Storybook 10,
`@hono/node-server` 2, `@sentry/vite-plugin` 11, `@testing-library/jest-dom` 7 and
`@types/better-sqlite3` 9.

## Repository state

- Working tree clean; `.omo/` and `.sisyphus/` are already absent from this clone.
- All eight files in `.kilo/plans/` were already tracked.
- `.config/semgrep-probe/` is the fixture `scripts/lib/semgrep-rules.test.mjs` reads, and
  `local/` is the tracked `automate-local` tool: both stay.
- Five feature branches named in the plan (`feat/operational-product`,
  `feat/dashboard-redesign`, `fix/ui-qa-sweep`, `feat/responsive-launcher`,
  `feat/qa-insights-toolbox`) are fully merged into `main` and 0 commits ahead.
- Ten further remote branches are not merged; each is a historical snapshot behind
  `main` by 48 to 190 commits.

## Drift found while measuring

- The README badges say pnpm 10.30.2 and TypeScript 5.9; the tree is pnpm 11.28.4 and
  TypeScript 6.0.
- `AGENTS.md` says seventeen of eighteen plan files are untracked; there are eight and
  all are tracked. Its client-patterns section names `lucide-react` for icons, which its
  own design table forbids in `apps/web`.
- `SITE-1` is `debt` although the Pages workflow it asks for exists; the one clause
  still missing is the `site:doctor` run against the built output.
- `tenancy:check` names `P-20` as the open row for the unbounded tables, and `P-20` is
  `fixed` — its subject was the schedules table. The remaining tables have no open row.
