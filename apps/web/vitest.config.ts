import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test-utils.ts', 'src/main.tsx', 'src/routeTree.gen.ts', 'dist/**'],
      thresholds: {
        lines: 85,
        functions: 85,
        statements: 91,
        branches: 85,
      },
    },
  },
});
