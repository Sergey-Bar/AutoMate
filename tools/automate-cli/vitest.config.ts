import { defineConfig } from 'vitest/config';
import { standardCoverage, STANDARD_TEST_TIMEOUT_MS } from '../../.config/vitest.shared.js';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: STANDARD_TEST_TIMEOUT_MS,
    hookTimeout: STANDARD_TEST_TIMEOUT_MS,
    coverage: standardCoverage(process.cwd()),
  },
});
