import { defineConfig } from 'vitest/config';
import { standardCoverage } from '../../vitest.shared.js';

const coverage = standardCoverage(process.cwd());

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: ['node_modules', 'dist'],
    testTimeout: 30000,
    hookTimeout: 30000,
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
