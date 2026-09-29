import { defineConfig } from 'vitest/config';
import { standardCoverage, STANDARD_TEST_TIMEOUT_MS } from '../../vitest.shared.js';

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
    coverage: standardCoverage(process.cwd()),
  },
});
