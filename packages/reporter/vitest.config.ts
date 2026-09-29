import { defineConfig } from 'vitest/config';
import { STANDARD_TEST_TIMEOUT_MS, standardCoverage } from '../../vitest.shared.js';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // This package's ownership test reads every source file in the repository, and
    // took 0.3s in isolation against 25.1s under `pnpm test`. The shared constant
    // records the measurement and the reasoning.
    testTimeout: STANDARD_TEST_TIMEOUT_MS,
    hookTimeout: STANDARD_TEST_TIMEOUT_MS,
    coverage: {
      ...standardCoverage(process.cwd()),
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
