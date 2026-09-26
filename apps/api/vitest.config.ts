import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: ['node_modules', 'dist'],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        // A side-effect-only preload, like `src/index.ts`: it exists to run once
        // under `node --import`, which no test drives. Its logic is covered in
        // `src/observability/sentry.test.ts`.
        'src/instrument.ts',
        'src/execution/drizzle-execution-store.ts',
        'src/infrastructure/drizzle-realtime-feed.ts',
        'src/execution/index.ts',
        'dist/**',
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        statements: 93,
        branches: 82,
      },
    },
  },
});
