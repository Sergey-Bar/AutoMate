import { defineConfig } from 'vitest/config';
import { STANDARD_TEST_TIMEOUT_MS, standardCoverage } from '../../vitest.shared.js';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // This package's tests do real work — PBKDF2 at the spool format's declared
    // parameters, and sealed-queue round-trips through the filesystem. The shared
    // constant records the measurements and the reasoning.
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
