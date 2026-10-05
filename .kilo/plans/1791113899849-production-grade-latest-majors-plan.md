# AI Specialist — Programme A: production-grade on latest stable majors

**Target:** a single-node production install (ADR-006 kept), on the newest **stable** major of
every runtime, package manager, compiler, linter, bundler, ORM-adjacent driver and database the
tree depends on — with the capability register, the findings ledger and the gate chain agreeing
with the result at every step.

**Releases:** lands **after** `v3.0.0`. Ships as **`v4.0.0`**. Phase 1 (Phase 0 below) is
non-breaking groundwork and may ship as `3.1.0`.

---

## Decisions

| # | Decision | Why |
|---|---|---|
| **D1** | Scope is **latest stable majors + production hardening** — not versions alone, not hardening alone. | The register's 26 non-`real` rows are code and measurement; the version gaps are supply chain. Neither alone is "top tier". |
| **D2** | Target posture is a **production-grade single-node install**. ADR-006 stays. | Superseding it (multi-instance) invalidates the self-hosted constraint that seven documents assert, and is a different programme. |
| **D3** | **Stable releases only.** Pre-releases become named follow-ons with a written graduation condition. | drizzle-orm `1.0.0-rc.5` and pnpm 12 (`next-12`) have no stable tag; PostgreSQL 19 is Beta 4. Shipping an RC into a gate chain that already distrusts unmeasured claims inverts the repository's thesis. |
| **D4** | **Effect 4 at the bootstrap boundary**, not across services, not deleted. | `docs/migration/unified-repository-migration.md:517` already states this policy. The dependency is declared at `apps/api/package.json:27` and **imported nowhere** — verified by grep — while `AGENTS.md:390` and four agent personas mandate "Effect services". Adopting it at the boundary makes both true. |
| **D5** | **The whole workspace moves**, including `apps/web` and `site`. | Vite 6.4.3 → 8.3.x is two majors behind and Vite 8 replaces esbuild+Rollup with Rolldown. Deferring it leaves the workspace split across two bundler generations. |
| **D6** | **PostgreSQL 18 lands in its own phase, after RF-5 clears.** | It is a data migration on a live installation. `pnpm migrate:rehearse` is the harness that proves exactly that, and RF-5 is an open Blocker that has never run. Doing both at once makes a failure ambiguous. |
| **D7** | Every phase is **one commit, green before and after**, and every recorded floor moves **up** only. | `AGENTS.md` coverage ratchet; the plan of record's standing rules 1–5. |

---

## Context — the census (read this before the task list)

### Recorded state at 2026-10-04

| Measure | Value | Source |
|---|---|---|
| Version | `2.2.0`, `## Unreleased — v3.0 groundwork` open | `package.json:3`, `CHANGELOG.md:5` |
| In-flight tree | **72 files, +4385 / −577**, uncommitted, 4 plan files staged | `git diff --stat HEAD` |
| Node | `24.21.0`; `engines.node` `>=24 <25`; 6 Dockerfiles; `NODE_VERSION: 24.x` in 4 workflows | `infra/docker/*.Dockerfile`, `.github/workflows/*.yml:23` |
| pnpm | `10.30.2`, `packageManagerStrictVersion: true`, `onlyBuiltDependencies`, 5 dated `overrides` | `package.json:7`, `pnpm-workspace.yaml:35-90` |
| TypeScript | `5.9.3`; `@types/node` is **22** under Node 24 | `pnpm-workspace.yaml:102,116` |
| ESLint | `^9.21.0` — **v9 reached EOL 2026-08-06** | `pnpm-workspace.yaml:93-94` |
| Vite | `^6.4.3`, with `overrides: 'vitepress>vite': ^6.4.3` forcing an unsupported combination | `pnpm-workspace.yaml:90,118` |
| Effect | `^3.21.2` declared, **zero imports**; 4.0.0 stable shipped **2026-09-30** | `apps/api/package.json:27` |
| PostgreSQL | `postgres:16-alpine` in **8 places** (2 compose, 4 `unified-ci`, 2 `nightly`) | `docker-compose.unified.yml:3` et al. |
| PGlite | `^0.5.8` in `apps/api`, `packages/db`, `tests/integration` | 3 `package.json` |
| `verify` | **15 steps against a budget of 20** | `package.json:53`, `gate-tooling.json:30` |
| Open ledger rows | 6 `open` (C-4, RF-5, RF-9, RF-11, PERF-1, RF-6d), 7 `debt` (X-3, D-4, C-6, UI-1, Q-1, CAP-1, SITE-1) | re-derive at execution time |

### Target versions (verify each against the registry at execution time; this is a direction, not a lockfile)

| Package | Today | Target | Note |
|---|---|---|---|
| Node | 24.21.0 | **26.x — gated on the LTS tag** | 26.10.0 is *Current*; LTS lands Oct 2026. Do not ship a Current line. |
| `@types/node` | ^22.15.3 | ^26 | **Before** the Node bump, or new globals stay invisible. |
| pnpm | 10.30.2 | **11.x** | Requires Node 22+; removes 5 settings; `.npmrc` becomes auth-only (tree has none). |
| TypeScript | 5.9.3 | **6.0.3** then **7.0.2** | 7.0 ships no programmatic API until 7.1. |
| ESLint / `@eslint/js` | ^9.21.0 | **^10.x** | Mandatory: v9 unmaintained. |
| Vite | ^6.4.3 | **^8.3.x** | Rolldown; ships with `@vitejs/plugin-react` v6 (Oxc, no Babel). |
| React | ^19.0.0 | **^19.3.0** | There is no React 20. 19.3 shipped 2026-09-09. |
| Effect | ^3.21.2 | **^4.0.0** | One shared version across every `@effect/*`. |
| Hono | ^4.12.29 | **^4.13.13** | No v5. The `hono/*` subpaths are current, not deprecated — see 8.1. |
| Zod | ^4.4.3 | unchanged | Already the latest major. Verify `zod-to-openapi` still parses v4. |
| PostgreSQL | 16-alpine | **18-alpine** | 18.6 current. 19 is Beta 4. |
| Drizzle ORM | ^0.45.2 | unchanged, **0.45.3** | 1.0.0-rc.5 excluded by D3. |
| Turborepo | ^2.10.4 | ^2.11.x | 2.11 honours `devEngines.packageManager`. |
| Vitest | ^4.1.5 | ^4.1.10 | Same major. |
| Sentry | `@sentry/node` ^11.0.0 | verify | `11.0.0` resolves in the lockfile but npm's `latest` still reads 10.x — **verify the resolved tag is `latest`, not a stale catalog pin.** |

---

## Ordered tasks

### Phase 0 — Land the in-flight tree, then re-baseline *(no behaviour change)*

0.1 Split or land the 72-file change. It mixes at least five concerns (QA cockpit dashboard,
glass design tokens, `report-formats` contract, migration-rehearsal client, skill-scan rework,
docs-drift detectors, four plan files). Land it as separate PRs; do **not** start a dependency
programme on top of it.
0.2 Confirm `.gitignore:79-81` (`.kilo/*`, `!.kilo/plans/`, `!.kilo/plans/*.md`) is in the landed
tree — it is the fix for v3.0 task 0.1 and is currently only in the working tree.
0.3 **Renumber the plan of record.** `1790920670956-five-major-versions-ponytail.md` claims
v4.0 for "the product does its job"; this programme ships v4.0. Move its v4.0→v5.0 and onward in
the same commit that opens this programme, so no two documents claim the same version.
0.4 Re-derive every recorded number: `pnpm coverage:ratchet`, `pnpm complexity`,
`pnpm docs:check`, `pnpm findings:check`, `pnpm tenancy:check`, `pnpm docs:capability-register`.
0.5 Run `pnpm verify` and record the baseline wall-clock for `typecheck`, `test` and `build` —
Phase 4 needs it to prove TypeScript 7 actually made the gate faster.

*Stop:* clean tree, `pnpm verify` green, register and ledger counts stated in the PR body.

### Phase 1 — Make the version census a gate

1.1 New `pnpm deps:policy` (`scripts/deps-policy.mjs`, tier `pr-blocking` in
`scripts/gate-tooling.json`, test in `scripts/lib/deps-policy.test.mjs`). It fails on:
**(a)** a declared dependency with no import anywhere in its workspace; **(b)** a catalog entry
whose resolved version is not the newest release in its declared major band; **(c)** an
`overrides` row whose review date has passed. Every `verify` step needs a tier row and a budget
slot — `verify` is at 15 of 20.
1.2 Run it against the tree and file a ledger row per finding, provenance `hand`. The known
first catch is `effect` (Phase 2). The gate's recorded catch goes in the row's `resolution` —
standing rule 1, no gate without one.
1.3 Red-first: write the three failure cases, run them against a fixture that trips each, watch
them fail for that reason, then fix.

*Stop:* `pnpm deps:policy` green (or its findings filed as rows), `pnpm verify` green.

### Phase 2 — pnpm 10 → 11 *(the install contract; blocks every later phase)*

2.1 `packageManager` → `11.x`; `pnpm-workspace.yaml` rewrite:
`onlyBuiltDependencies` → `allowBuilds: { better-sqlite3: true, esbuild: true, '@sentry/cli': true }`;
**`packageManagerStrictVersion: true` is removed** → `pmOnFail: error`.
2.2 Re-derive from the v10→v11 guide, do not assume: `engineStrict`, `autoInstallPeers`,
`strictPeerDependencies`, `resolvePeersFromWorkspaceRoot`. Any removed key is a manifest fix in
this phase, not a surprise in Phase 5.
2.3 Set `minimumReleaseAge` explicitly. It **defaults to 1440** in v11, so a version published
less than a day ago will not resolve — record the value and why.
2.4 `pnpm audit` is GHSA-based in v11. If any `auditConfig.ignoreCves` exists, migrate to
`ignoreGhsas`; `security:verify`'s `--audit-level=high` is unaffected.
2.5 Prove the native build approval survived: `pnpm --filter @automate/migrate-cli test` must
actually open a `better-sqlite3` database (`tools/migrate-cli/src/catalog.ts:1`). A silently
unbuilt native module fails at runtime, not at install.
2.6 CI keeps the SHA-pinned `pnpm/action-setup`; confirm `cache: pnpm` still keys correctly under
store v11 (SQLite index).

*Stop:* `pnpm install --frozen-lockfile` clean on a fresh store; `pnpm verify` green.

### Phase 3 — ESLint 9 → 10 *(mandatory; v9 is EOL)*

3.1 `eslint` + `@eslint/js` → `^10.x`; align `typescript-eslint`, `eslint-plugin-jsx-a11y`,
`eslint-plugin-security`, `eslint-plugin-sonarjs`, `jscpd`. `strictPeerDependencies: true` means a
mismatch fails the install, not a warning.
3.2 The `GLASS_SELECTOR` spread into every `no-restricted-syntax` block must survive
(`eslint.config.js`) — it is a named gate in `AGENTS.md`. Add the assertion to
`scripts/lib/gate-tooling.test.mjs` if ESLint 10 changed the spread semantics.
3.3 `pnpm lint --max-warnings=0` with zero new suppressions. Every rule that had to be
reconfigured gets a ledger row; a config change that silences a class of findings is a defect,
not a migration.

*Stop:* `pnpm lint` green at the same finding count, minus the ones filed in 3.3.

### Phase 4 — TypeScript 5.9 → 6.0 → 7.0 *(two commits, never one)*

4.0 Grep first, across every `tsconfig*.json` including `tsconfig.scripts.json`:
`"importsNotUsedAsValues"`, `"keyofStringsOnly"`, `"out"`, `"prepend"`, `"charset"`,
`"ignoreDeprecations"`, `"noImplicitUseStrict"`, `"moduleResolution": "node"`. TS 7 hard-errors
all of these and **`ignoreDeprecations` itself stops being accepted**.
4.1 **Step A — 6.0.3.** New defaults that will bite: `strict: true` (already set),
`module: esnext`, `target` = current-year ES (`es2025`), `noUncheckedSideEffectImports: true`,
`libReplacement: false`. `AGENTS.md` pins target ES2022 — set it **explicitly** in
`tsconfig.base.json` or move it deliberately and say so in the commit.
4.2 **Step B — 7.0.2 for the gate, 6.0.3 for tooling.** 7.0 ships **no programmatic API**, so
typescript-eslint (and `drizzle-kit`, and any Compiler-API consumer) cannot run on it:
```
"typescript":     "npm:@typescript/typescript6@^6.0.3",
"@typescript/native": "npm:typescript@^7.0.2"
```
`typecheck`, `typecheck:scripts` and `typecheck:e2e` invoke the 7 binary; ESLint keeps the 6 API.
4.3 TS 7 default changes: `rootDir` now `./` (inner source dirs must be explicit) and **`types`
now `[]`** — every package relying on ambient `@types/node` must list it, or it silently stops
seeing `process`, `Buffer` and the timers.
4.4 **The largest unknown is `tsconfig.scripts.json`** — `allowJs` + `checkJs` + `strict` over
`scripts/**/*.mjs`. If the Go compiler diverges there, keep those files on the 6 binary and
record why; do not weaken the check.
4.5 Graduate the dual install when typescript-eslint supports the TS 7 API (targeted 7.1).

*Stop:* `pnpm typecheck` green on both binaries; `typecheck` wall-clock from 0.5 improved.

### Phase 5 — Node 24 → 26 *(gated on the LTS release existing)*

5.1 **Gate:** nodejs.org lists 26.x under LTS. Today it is *Current* (26.10.0, LTS in Oct 2026).
Do not pin a Current line in a production programme; land the rest and come back.
5.2 `engines.node` → `>=26 <27`; `.node-version`, `.nvmrc`; `NODE_VERSION` in all 4 workflows
(one line each — they all read the env var); 6 Dockerfiles → `node:26.x-alpine` /
`node:26.x-bookworm-slim`.
5.3 Behaviour to check, not assume: **Undici 8**, **Temporal on by default**, and the removals
list in the v26.0.0 notes. Grep `apps/` and `scripts/` for removed `node:` APIs and for `fetch`
typing that moved.
5.4 `@types/node` 26 landed in 4.0 — if the gate in 5.1 has not opened, everything above is
still landable except the `engines`/Dockerfile/runtime change.

*Stop:* `pnpm verify`, `pnpm test:e2e` and `pnpm smoke:local` green against a real compose stack.

### Phase 6 — Vite 6 → 8 *(Rolldown)*

6.1 `vite` → `^8.3.x`; `@vitejs/plugin-react` → `^6` (Oxc transform, Babel dropped);
`apps/web` and `site` only. `@tailwindcss/vite`, `@sentry/vite-plugin` and the TanStack Router
plugin are the three that must be proven, in that order.
6.2 **Resolve the VitePress override.** `pnpm-workspace.yaml:90` forces `'vitepress>vite': ^6.4.3`
— an unsupported combination the file's own comment admits to, and Vite 8 makes it worse. Either
move VitePress to a line that accepts Vite 8, or delete the override and accept two Vite majors
with the site build pinned to its own. Record which, and why, in the row.
6.3 The canary is `apps/web/src/theme-resolution.test.ts` — it resolves every utility against a
real Tailwind compile, so a broken plugin shows up as a failing utility rather than a silent
style regression.
6.4 Report, do not gate, the rendering budget: `pnpm test:render` before and after. `PERF-1` is
still `recorded: false`; do not invent a baseline.
6.5 Take `server.forwardConsole` — it pipes client logs to the terminal, which is worth more to
this repo's agent-driven workflow than the build speed is.

*Stop:* `pnpm build`, web tests, `pnpm test:e2e` green; axe green in both themes; render report
attached.

### Phase 7 — Effect 3 → 4 at the bootstrap boundary

7.1 Add `apps/api/src/bootstrap/`. Its whole job: validated configuration, service lifecycle,
composition — `docs/migration/unified-repository-migration.md:517`. Nothing outside that
directory imports `effect`.
7.2 Migration mechanics: `Context.Tag` → `Context.Service`; every `@effect/*` package resolves to
**one** 4.0.x version; module import paths drop the `unstable/` segment; `effect/Config` replaces
the hand-rolled validation in `packages/config/src/config.ts` +
`apps/api/src/startup-policy.ts:96-98` (`checkProductionPolicy`, `resolveAuthSecrets`).
7.3 `@effect/vitest` 4.0.0 for the bootstrap tests.
7.4 **4.0.0 shipped 2026-09-30 — three days of ecosystem feedback.** Own commit, previous commit
green, and the composition tests in `apps/api/src/index-production-composition.test.ts` as the
proof. If `@effect/vitest` misbehaves, run those tests on Vitest and record the choice.
7.5 New code must be covered on the same PR — the ratchet never lowers.
7.6 Make the docs true in the same commit: `AGENTS.md:37,324,390`, `.github/agents/backend-engineer`,
`database-engineer`, `principal-architect`, `docs/architecture/unified-platform.md:35`, and the
`.kilo/agent/` copies (the two trees are synced by hand).

*Stop:* `pnpm --filter @automate/api test` green; `pnpm verify` green; no `effect` import outside
`bootstrap/`.

### Phase 8 — Hono 4.13 and the two Hono CVEs
8.1 Bump to `^4.13.13`. **The subpath imports stay.** An earlier draft of this plan
claimed `hono/body-limit`, `hono/cookie` and `hono/streaming` were deprecated in 4.13
and removed in v5, and proposed migrating them to top-level exports. **That was wrong,
and the evidence is in the release notes and the package itself:** v4.13.0's own notes
list no deprecation, the middleware is still imported from a subpath in Hono's own
`methodNotAllowed` example, and `hono@4.13.13`'s top-level `index.d.ts` exports only
`Hono`, `Context` and types — `bodyLimit`, `cookie` and `streaming` are not there, so
"migrating" them would not compile. 4.13 is a safe minor: request-path performance
(1.15–1.25x on json and body routes), a first-class `QUERY` method, and a new
`methodNotAllowed` middleware. Nothing here is a preparation for v5.
8.2 **Two security fixes, and the tree uses the affected code:**
- CVE-2026-44456 — `bodyLimit()` bypass for chunked / unknown-length requests, fixed in
  **4.12.16**. Assert the resolved version is at or above it.
- CVE-2026-44457 — cache middleware ignores `Vary: Authorization` / `Vary: Cookie`, fixed in
  **4.12.18**.
8.3 Red-first regression test: a chunked upload over the declared limit returns 413. Run it
against the unfixed route first and watch it reach the handler and return 200.
8.4 Verify `@asteasolutions/zod-to-openapi` still parses the Zod 4 schemas behind
`packages/shared-contracts/src/openapi.ts`. If it does not, that is `RF-11`'s real blocker and it
gets a row.

*Stop:* `pnpm --filter @automate/api test` green with the 413 test; `pnpm security:verify` green.

### Phase 9 — PostgreSQL 16 → 18 *(after RF-5 clears — D6)*

9.1 **Precondition: RF-5 `fixed`.** `pnpm migrate:rehearse` has never run. If it has not, this
phase does not start — that is the row's own condition (b), already machine-checked by
`docs/quality/wave-gates.json`.
9.2 `postgres:16-alpine` → `18-alpine` in 8 places: `docker-compose.unified.yml:3`,
`infra/compose/compose.dev.yml:3`, `unified-ci.yml` ×4, `nightly.yml` ×2.
9.3 **PGlite must move with it.** `^0.5.8` in `apps/api`, `packages/db` and `tests/integration`.
PGlite tracks a PostgreSQL major; a PGlite/PG mismatch is a silent semantic gap that no gate
reports. Align them and re-run the PGlite suites.
9.4 Read all 20 migrations for PG 16-only or PG 18-deprecated syntax before touching compose.
`pnpm db:check` after.
9.5 Upgrade path on a live installation: `pg_dump` → restore onto a clean 18 instance → migrate
the restore → re-open every sealed row through the product's own `vault-crypto`. That is
`migrate:rehearse`, run against 18.
9.6 Re-check the PGlite and 19 graduation conditions at execution time — PG 19 GA was projected
for October 2026 and may land inside this programme.

*Stop:* `pnpm migrate:rehearse` green on an 18 instance; RF-5 `fixed`; `pnpm findings:check` green.

### Phase 10 — Production hardening, single node

The register axis. In order, because each unblocks the next.

10.1 **Delete the process-local surface.** `execution/in-memory-execution-store.ts` (holds
complexity **73** and **71**, the two worst functions in the repository),
`repositories/in-memory-run-repository.ts`, `realtime/realtime-bus.ts`,
`services/runner-control.ts` + `routes/runner.ts`,
`services/orchestration-service.ts` + `routes/orchestration.ts`, the production `503` branch at
`index.ts:274-299`, and `E2E_ALLOW_IN_MEMORY` + `assertInMemoryAllowed` + the fallback-logging call
sites. `index.ts:35` and `:47` already carry the "Post-MVP: remove" markers. Task 1 is the grep
of every reader, not the edit. Durable `cancel` + bounded `GET /jobs` + cross-workspace
isolation tests land with it. **This closes C-4 and is the precondition for complexity ≤ 10.**
10.2 **Real runner images.** `runners/{playwright,k6,zap}/Dockerfile` are stubs printing a version.
Runner + tool + its scenario/config, `USER 65532:65532` last, per-image network policy that names
its target (`oci-checks.mjs:132` asserts `network: "none"`, which cannot be true of a browser, a
load generator or a scanner). `pnpm oci:build` then `pnpm oci:verify` green.
10.3 **Close RF-5** — `pnpm migrate:rehearse` against the installation 10.2 made installable,
recording date, installation and sealed-row count in the row's `resolution`.
10.4 **Backup and restore.** A scripted `pg_dump` / `pg_restore` pair plus a runbook. "It
survives a restart" is not a claim a single-node install can make without one.
10.5 **Readiness that reads something.** `/api/v1/health` is liveness; `/api/v1/ready` must probe
the database and the runner pool and fail when either is unusable.
10.6 **Observability floor.** Sentry is wired in `apps/api/src/instrument.ts` but imported only by
the dev script — the production entry must load it. Confirm structured logs from the single sink
at `index.ts:133-140`, and record the SLOs the render and perf budgets already name.
10.7 **Tier raises, each with its measurement in the same commit:** `security:static` →
`pr-blocking` (the evidence exists — zero findings, semgrep 1.178.0, run `36962862652`);
`test:render` → `pr-blocking` only once `pnpm render:baseline` has run on the reference hardware;
`test:performance` only once `performance/thresholds.json` is `recorded: true`.
10.8 **Retire what nothing writes.** C-6's 21 dormant tables (`locator_suggestions` first — it
has no `updated_at`, so a row in it is permanently current by construction), and the 28
workspace-scoped tables with no hard boundary (`P-20`), which `pnpm tenancy:check` currently
reports rather than fails.
10.9 **Docs.** `docs/deployment.md` and `site/operations.md` move from "local only" to the
single-node production topology. The README maturity line changes **only** when the register rows
behind it are `real`.

*Stop:* `pnpm verify` green; no `mock` register row is process-local; `pnpm tenancy:check` clean.

### Phase 11 — Close the records, cut the release

11.1 Re-derive the capability register from the tree: 42 rows, zero `missing`, no process-local
`mock`. `pnpm docs:capability-register` + `pnpm site:generate`.
11.2 RF-9 and PERF-1 close on **measured** numbers from the reference hardware (a self-hosted
single-node install — a GitHub runner is not it, which is why both jobs are `pr-reporting`).
11.3 `package.json:3` by hand — not `pnpm version`. Release notes name what is still unmeasured.
11.4 Tag `v4.0.0`, `pnpm verify:release` green on the tagged commit, `gh release create`.
11.5 `pnpm findings:baseline` (deliberate), `pnpm status:10`, `pnpm migrate:plan` +
`pnpm migrate:validate` before deploy.

*Stop:* `v4.0.0` exists, `pnpm verify:release` green, `pnpm status:10` reports a non-zero `pass`.

---

## Validation

Per phase, red-first per `.kilo/skills/evidence-test`: write the test, run it with the defect
present, watch it fail for the expected reason, then fix.

```
pnpm verify                      # every phase
pnpm deps:policy                 # Phase 1 onward
pnpm lint --max-warnings=0       # Phase 3 onward
pnpm typecheck                   # Phase 4 onward, both binaries
pnpm --filter @automate/api test # Phase 7, 8
pnpm test:e2e                    # Phases 6, 9, 10   (real PostgreSQL, no E2E_ALLOW_IN_MEMORY)
pnpm migrate:rehearse            # Phase 9, 10       (never-in-ci; on the installation)
pnpm oci:build && pnpm oci:verify# Phase 10
pnpm coverage:ratchet complexity docs:check findings:check tenancy:check
pnpm verify:release              # Phase 11 only
```

Phase 0.5's wall-clock numbers are the before-picture for Phase 4's claim that the typecheck got
faster. A speedup asserted without them is the exact failure this repository documents three times.

---

## Risks

- **pnpm 11 `verifyDepsBeforeRun: install` and `minimumReleaseAge: 1440`.** An install now runs
  before scripts and will refuse a version under a day old. Offline or network-restricted hosts
  will fail in a new place; set the value explicitly in 2.3 rather than discovering it.
- **TypeScript 7 has no programmatic API.** The dual install in 4.2 is mandatory, not optional,
  and `tsconfig.scripts.json` typechecking `.mjs` through the Go compiler is the single largest
  unknown in this programme.
- **Vite 8 + the VitePress override is an unsupported combination this programme makes worse.**
  Resolve it deliberately in 6.2; do not let `--frozen-lockfile` decide.
- **Effect 4.0.0 is three days old.** Isolated commit, previous commit green, and the boundary
  kept to `bootstrap/` so the blast radius is one directory.
- **The PostgreSQL upgrade is a data migration with no rehearsal yet.** D6 sequences it after
  RF-5 for exactly that reason.
- **72 files of in-flight work sit underneath all of it.** Phase 0 is not optional and not a
  formality.
- **`verify` has 5 spare steps of 20.** Each new `pr-blocking` gate consumes one; `deps:policy`
  is the only one this programme adds to `verify`.
- **ESLint 10 + typescript-eslint + sonarjs + jscpd peer ranges may not align**, and
  `strictPeerDependencies: true` turns a mismatch into a failed install rather than a warning.
- **`@sentry/node` is catalogued at `^11.0.0` while npm's `latest` still reads 10.x.** Verify the
  resolved dist-tag before assuming the tree is current.

---

## Follow-ons, with the condition that graduates each

| Target | Condition |
|---|---|
| drizzle-orm **1.0.0** | 1.0.0 stable ships and `drizzle-kit` supports it. Carries Relations v2 (`defineRelations`), a breaking casing API, RQB v1 removal, and a native Effect driver (`drizzle-orm/effect-postgres` + `@effect/sql-pg@4.0.0`) — evaluate that last pair against the Phase 7 boundary. |
| pnpm **12** (Rust port) | 12.x is `latest`, not the `next-12` dist-tag. |
| PostgreSQL **19** | 19 is GA. Beta 4 as of 2026-09-24 with GA projected October 2026 — re-check at execution time; it may graduate inside this programme. |
| TypeScript **7.1** | 7.1 ships the stable Compiler API; then the `typescript` / `@typescript/native` split from 4.2 collapses. |
| **Hono 5** | 5.0.0 ships. Nothing in this programme prepares for it — the subpath imports are current in 4.13 and top-level exports do not carry the middleware. |
| Node **26** | Drop the 5.1 gate once 26.x is LTS. |
| Multi-instance posture | A separate programme, and it supersedes ADR-006 first. |

---

## Open questions

1. **Is the in-flight tree one feature or five?** A diffstat cannot tell. Whoever executes Phase 0
   decides the PR split; this plan assumes it lands first either way.
2. **`verify:local` — keep or delete?** The v3.0 plan keeps it (D8); the plan of record's v6.0
   deletes it because it makes `security:static` exit 0 without scanning. Unresolved here, and it
   should be resolved on its own commit, not inside a dependency phase.
3. **Deploy the docs site or delete it?** `SITE-1` has an owner and a removal condition. Vite 8 in
   Phase 6 touches the site build either way, so the decision cannot be deferred past 6.2.
4. **Which packages does the mutation baseline cover?** `Q-1` says "five" and does not name them.
   Recommendation stands from the plan of record: `shared-contracts`, `auth`, `orchestration`,
   `runner-sdk`, and `apps/api/src/infrastructure`.
