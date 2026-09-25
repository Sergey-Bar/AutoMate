import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    clearMocks: true,
    restoreMocks: true,
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
        'src/index.ts', // entry point — mainly wiring
        'src/db/seed-demo.ts', // CLI script — not library code
        'src/db/client.ts', // bootstrap with top-level side effects
        'src/db/migrate.ts', // bootstrap — depends on fs + db connection
        'src/routes/index.ts', // barrel re-export
        'src/services/index.ts', // barrel re-export
        'src/agent/index.ts', // barrel re-export
      ],
      thresholds: {
        statements: 97.2,
        branches: 91.7,
        functions: 99.2,
        lines: 97.8,
      },
    },
  },
});
