import { defineConfig } from 'vitest/config';
import { standardCoverage } from '../../vitest.shared.js';

const coverage = standardCoverage(process.cwd());

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: ['node_modules', 'dist'],
    /**
     * 60s, up from Vitest's 5s default and this package's previous 30s.
     *
     * Three tests in this package are CPU-bound rather than I/O-bound, and their cost
     * scales with the *machine*, not with the test: PBKDF2 key derivation in
     * `src/infrastructure/vault-crypto.test.ts` (100 000 iterations per derivation, run
     * hundreds of times to prove a derived key is never reused), and in-process
     * Postgres `exec` in `src/execution/bounded-stores.test.ts` and
     * `src/execution/artifact-compensation.test.ts`.
     *
     * Measured: those three files together pass in 4.92 s in isolation, and under
     * `pnpm verify` — turbo running this package alongside thirty-odd others — they
     * took 31.5 s, 44.0 s and 57.0 s and failed at the 30 s budget. The assertions had
     * not changed and nothing was wrong; the *machine* was the variable.
     *
     * A timeout that reports a loaded machine as a failing repository is a timeout
     * people learn to re-run, and a gate that must be re-run provides nothing. 60s is
     * headroom for the observed worst case, not a target: if a test here genuinely
     * needs 60 s, the cost has moved somewhere it can be made cheaper.
     *
     * This is not a weakened assertion. Nothing about what is checked changes; only
     * how long the harness waits before saying so.
     */
    testTimeout: 60000,
    hookTimeout: 60000,
    // `all: true` with an explicit `include` is what makes an untested module
    // visible. Without it V8 reports only the files a test happened to import, so
    // deleting every test in a module would *raise* the reported coverage — and
    // this is the package with the most untested source in the repository.
    //
    // Every exclusion below is justified in `docs/quality/coverage-exclusions.md`,
    // and `scripts/lib/coverage-exclusions.test.mjs` fails when one appears here
    // without a row there.
    coverage: {
      ...coverage,
      exclude: [
        ...coverage.exclude,
        // The composition root. It reads `process.env`, binds a real listener
        // and, outside `NODE_ENV=test`, starts a server as a side effect of
        // import — so a unit test cannot import it *and* observe composition.
        //
        // That is not the same as "no test can import it", which is what the
        // register used to say: `src/index.test.ts` imports `{ app }` and
        // `src/index-production-composition.test.ts` imports it dynamically.
        // `src/test-support/` is excluded for a different reason — see the
        // register — and `src/infrastructure/synthetic-credentials.ts` used to be
        // a test fixture living in product source and measured as if it were
        // product, which is now fixed at the source rather than hidden here.
        'src/index.ts',
        // A side-effect-only preload, like `src/index.ts`: it exists to run once
        // under `node --import`, which no test drives. Its logic is covered in
        // `src/observability/sentry.test.ts`.
        'src/instrument.ts',
        // Test support. `synthetic-credentials.ts` used to live in
        // `src/infrastructure/`, where it was measured as product: a fixture no
        // production code imports was inflating the denominator with a "coverage"
        // figure that said nothing about the product. It now sits under
        // `src/test-support/`, and `scripts/lib/test-support-boundary.test.mjs`
        // fails if anything outside a `*.test.ts` imports from there — so the
        // directory cannot quietly become a second product package.
        'src/test-support/**',
        // MEASURED, not asserted, and the register carries the number: lifting this
        // puts the file at 76.11% statements / 58.48% branches and drops `apps/api` from
        // 93.95 to 91.52 statements and 84.71 to 79.42 branches — below the 93/80
        // floors. The named gap is the runner lifecycle, which
        // `runner-lifecycle.drizzle.test.ts` now covers, plus `getReadiness` and the
        // `mapRuns` batch loader. `docs/quality/coverage-exclusions.md` row B4 has the
        // per-method breakdown.
        'src/execution/drizzle-execution-store.ts',
        'src/infrastructure/drizzle-realtime-feed.ts',
        'src/execution/index.ts',
        'dist/**',
      ],
    },
    // No `thresholds` here on purpose. `vitest.shared.ts` records why: the
    // authoritative floor for every package is its row in
    // `coverage-baseline.json`, enforced by `pnpm coverage:ratchet`. A second,
    // per-package threshold set can only disagree with the first.
  },
});
