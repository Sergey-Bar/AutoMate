import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      /**
       * Without an explicit `include`, V8 coverage only reports files that a
       * test happened to import, so a schema module nothing imports escaped the
       * threshold entirely. `all: true` plus `include` makes every source file
       * count.
       *
       * The floors are the plan's standard "clean-as-you-code" levels
       * (≥90% lines, ≥80% branches), rounded to a stable value. This package
       * previously claimed 100% and did not meet it once it was actually
       * measured.
       */
      all: true,
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test-d.ts', 'src/**/index.ts'],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
});
