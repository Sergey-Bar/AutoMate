# Coverage exclusions register

Every path a package's Vitest coverage config removes from measurement needs a
row here. The gate that keeps this honest is
`scripts/coverage-exclusions.test.mjs`, run by `pnpm test:integration`: it reads
each `vitest.config.ts`, subtracts the shared policy in `vitest.shared.ts`, and
fails if anything is left that this file does not account for.

**An exclusion is a claim that some code does not need testing.** That claim is
usually true and occasionally an excuse. The rule this repository follows is that
the claim has to be written down here, in prose, where a reviewer can disagree
with it — rather than living as a bare string in a config where it is invisible.

## The shared policy

`vitest.shared.ts` excludes, for every package: `*.test.*`, `*.spec.*`,
`__tests__/**`, `*.test-d.ts`, `*.d.ts`, and `**/node_modules/**`. These are not
listed below because they are not per-package decisions — they are the definition
of "source under test".

`index.ts` is explicitly **not** in that shared list. Several packages keep all
of their code in `src/index.ts`, so excluding barrels reported them 0/0: a gate
measuring nothing while printing a number.

## Per-package exclusions

| Package    | Excluded glob                                 | Why it is not measurable                                                                                                                                                                             | Removal condition                                                                                                                                                                    |
| ---------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api` | `src/index.ts`                                | The composition root. Importing it reads `process.env`, binds a real listener and starts a server as a side effect. No unit test can import it without booting the process.                          | Covered when the composition root can be constructed against a supplied context instead of a module-level side effect. `src/index.test.ts` asserts the wiring against the built app. |
| `apps/api` | `src/instrument.ts`                           | A side-effect-only preload run once under `node --import`. Its logic _is_ tested, in `src/observability/sentry.test.ts`; what is untestable is the fact that importing it performs the registration. | Covered when the preload exports a callable initialiser that a test can invoke and assert.                                                                                           |
| `apps/api` | `src/execution/drizzle-execution-store.ts`    | The largest file in the repository, and the durable `ExecutionStore` implementation. Excluded rather than measured.                                                                                  | **Tracked as B4.** The shared scenario suite is to run against both the in-memory and the Drizzle store, at which point this is measured and the exclusion goes.                     |
| `apps/api` | `src/infrastructure/drizzle-realtime-feed.ts` | The Postgres-backed realtime feed, excluded for the same reason as the store above: the durable path has no unit coverage.                                                                           | **Tracked as B4 / C6.**                                                                                                                                                              |
| `apps/api` | `src/execution/index.ts`                      | A barrel re-exporting the module above.                                                                                                                                                              | Removed with `src/execution/drizzle-execution-store.ts`.                                                                                                                             |
| `apps/api` | `dist/**`                                     | Build output, not source. `standardCoverage` already excludes `**/node_modules/**`; `dist` is declared here so the intent is recorded rather than implicit.                                          | Never — build output is never measured.                                                                                                                                              |
| `apps/web` | `src/main.tsx`                                | The Vite entry point. It mounts React and nothing else; there is no branch in it to exercise.                                                                                                        | Covered when the entry point grows behaviour worth asserting.                                                                                                                        |
| `apps/web` | `src/test-utils.ts`                           | Test helpers, measured indirectly by the tests that import them. Counting a helper's own lines would report coverage of code that only exists to support the measurement.                            | Never — test support is not product code.                                                                                                                                            |

## Rejected exclusions

These were proposed and refused. Recording the refusal is the point: the next
person to have the same idea should find the reasoning rather than repeat it.

| Glob                                            | Where it was proposed                        | Why it was refused                                                                                                                                                 |
| ----------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/**/index.ts`                               | `packages/shared-contracts/vitest.config.ts` | Contradicted the stated policy in `vitest.shared.ts`, and the config is now on `standardCoverage` like every other package. `index.ts` is measured.                |
| `src/routeTree.gen.ts`                          | `apps/web/vitest.config.ts`                  | The file does not exist. Excluding a path that is not there is indistinguishable from excluding one that is, which is how a real exclusion gets lost in the noise. |
| The 19 `@automate/*#test` `outputs: []` entries | `turbo.json`                                 | These are not coverage exclusions, they are cache declarations, and they cancelled the `coverage/**` output the ratchet reads. Removed.                            |

## Adding a row

1. Add the glob to the package's `vitest.config.ts`.
2. Add a row here, with a removal condition that names a thing which could
   happen — not "in the future".
3. Run `pnpm test:integration`. The gate reads both sides and fails if they
   disagree in either direction, so a stale row for a glob that was removed fails
   just as loudly as a new exclusion with no row.
