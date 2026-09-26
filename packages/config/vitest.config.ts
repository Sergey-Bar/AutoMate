import { defineConfig } from 'vitest/config';
import { standardCoverage } from '../../vitest.shared.js';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      ...standardCoverage(process.cwd()),
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
