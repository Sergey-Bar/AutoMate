import { defineConfig } from 'vitest/config';

export default defineConfig({
  poolOptions: {
    forks: {
      singleFork: true,
    },
  },
  test: {
    include: ['packages/connectors/*/src/**/*.pact.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 30000,
    passWithNoTests: true,
  },
});
