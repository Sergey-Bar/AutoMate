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
    // and `scripts/coverage-exclusions.test.mjs` fails when one appears here
    // without a row there.
    coverage: {
      ...coverage,
      exclude: [
        ...coverage.exclude,
        // The composition root. It reads `process.env`, binds a real listener and
        // starts a server as a side effect of import, so no test can import it.
        // Its wiring is asserted against the built app in `src/index.test.ts`.
        'src/index.ts',
        // A side-effect-only preload, like `src/index.ts`: it exists to run once
        // under `node --import`, which no test drives. Its logic is covered in
        // `src/observability/sentry.test.ts`.
        'src/instrument.ts',
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
