import { defineConfig } from 'vitest/config';
import { standardCoverage } from '../../vitest.shared.js';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // Standard floors plus an explicit `include`: without it, an untested
    // module is invisible to the coverage report.
    coverage: standardCoverage(process.cwd()),
    setupFiles: ['./src/test/setup.ts'],
  },
});
