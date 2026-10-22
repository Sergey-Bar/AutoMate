import { defineConfig } from 'vitest/config';
import { standardCoverage, STANDARD_TEST_TIMEOUT_MS } from '../../.config/vitest.shared.js';

const coverage = standardCoverage(process.cwd());

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // See STANDARD_TEST_TIMEOUT_MS in the shared config for why this is not
    // Vitest's 5s default.
    testTimeout: STANDARD_TEST_TIMEOUT_MS,
    hookTimeout: STANDARD_TEST_TIMEOUT_MS,
    // Standard floors plus an explicit `include`: without it, an untested
    // module is invisible to the coverage report.
    coverage: {
      ...coverage,
      // Test support (the PGlite harness), not product; see the exclusions register.
      exclude: [...coverage.exclude, 'src/test-support/**'],
    },
    include: ['src/**/*.test.ts'],
  },
});
