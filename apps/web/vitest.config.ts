import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    clearMocks: true,
    restoreMocks: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      reportOnFailure: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        '**/node_modules/**',
        '**/dist/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/router.tsx',
        'src/test/**',
        // Barrel files: pure re-export declarations are not instrumented by v8
        'src/components/layout/index.ts',
        'src/components/shared/index.ts',
        'src/components/ui/index.ts',
      ],
      thresholds: {
        lines: 99.1,
        functions: 98.8,
        statements: 98.4,
        branches: 94.4,
      },
    },
  },
});
