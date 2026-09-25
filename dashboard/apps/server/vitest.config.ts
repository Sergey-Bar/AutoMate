import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    clearMocks: true,
    restoreMocks: true,
    pool: 'forks',
    // Limit to a single fork so parallel workers never race to open the
    // same SQLite database file. All test files run sequentially inside
    // one worker process, eliminating SQLite disk I/O contention that
    // was observed when multiple Vitest workers initialized db/client.ts
    // concurrently (better-sqlite3 WAL initialisation on the same path).
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      reportOnFailure: true,
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        '**/node_modules/**',
        '**/dist/**',
        'src/index.ts', // entry point - mainly wiring
      ],
      thresholds: {
        lines: 97.9,
        functions: 96.5,
        statements: 97.1,
        branches: 90.3,
      },
    },
  },
});
