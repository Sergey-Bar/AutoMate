import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: process.env['AUTOMATE_OUTPUT_DIR'] ?? 'test-results',
  use: {
    baseURL: process.env['AUTOMATE_BASE_URL'] ?? 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'smoke-pass',
      testMatch: 'pass.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'smoke-failure',
      testMatch: 'fail.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
