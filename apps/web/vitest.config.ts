import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { standardCoverage } from '../../vitest.shared.js';

const coverage = standardCoverage(process.cwd());

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['node_modules', 'dist'],
    // One jest-dom registration for every file, rather than 14 files each
    // importing one of two different entry points.
    setupFiles: ['./src/test-setup.ts'],
    /**
     * 60s, up from Vitest's 5s default. This package has none.
     *
     * The cost that scales with the machine rather than with the test is
     * **module import**: `transform 12.01s` and `import 40.69s` across 27 files in a
     * run that takes 7.45s of actual test time. A router test — which imports the
     * generated route tree and every route module behind it — is therefore the most
     * load-sensitive test in the repository, and observed at 15 018 ms under
     * `pnpm test` where turbo runs this package alongside thirty-odd others. It passes
     * in 7.45 s in isolation.
     *
     * The same reasoning as `apps/api/vitest.config.ts`, and for the same reason: a
     * timeout that reports a loaded machine as a failing repository is a timeout
     * people learn to re-run. This is not a weakened assertion — nothing about what is
     * checked changes, only how long the harness waits before saying so.
     */
    testTimeout: 60000,
    hookTimeout: 60000,
    // `all: true` with an explicit `include` is what makes an untested module
    // visible. Without it V8 reports only the files a test happened to import, so
    // deleting every test in a module would *raise* the reported coverage.
    //
    // Every exclusion below is justified in `docs/quality/coverage-exclusions.md`,
    // and `scripts/coverage-exclusions.test.mjs` fails when one appears here
    // without a row there. The previous `src/routeTree.gen.ts` entry is gone
    // because the file does not exist.
    coverage: {
      ...coverage,
      exclude: [
        ...coverage.exclude,
        // The Vite entry point: it mounts React and nothing else, so there is no
        // behaviour in it for a test to assert.
        'src/main.tsx',
        // Test helpers. They are exercised by the tests that call them.
        'src/test-utils.ts',
      ],
    },
    // No `thresholds` here on purpose. `vitest.shared.ts` records why: the
    // authoritative floor for every package is its row in
    // `coverage-baseline.json`, enforced by `pnpm coverage:ratchet`. A second,
    // per-package threshold set can only disagree with the first.
  },
});
