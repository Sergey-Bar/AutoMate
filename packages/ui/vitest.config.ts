import { defineConfig } from 'vitest/config';
import { standardCoverage, STANDARD_TEST_TIMEOUT_MS } from '../../.config/vitest.shared.js';

const coverage = standardCoverage(process.cwd());

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // See STANDARD_TEST_TIMEOUT_MS in the shared config for why this is not
    // Vitest's 5s default.
    testTimeout: STANDARD_TEST_TIMEOUT_MS,
    hookTimeout: STANDARD_TEST_TIMEOUT_MS,
    // Standard floors plus an explicit `include`: without it, an untested
    // module is invisible to the coverage report.
    coverage: {
      ...coverage,
      // Storybook stories render a component for a human to look at; they ship nothing and
      // assert nothing. See the exclusions register.
      exclude: [...coverage.exclude, 'src/**/*.stories.tsx'],
    },
    setupFiles: ['./src/test/setup.ts'],
  },
});
