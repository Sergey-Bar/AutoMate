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
