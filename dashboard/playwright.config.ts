import { defineConfig, devices } from '@playwright/test';

/**
 * playwright.config.ts — Mission Control dogfood e2e config
 *
 * Runs the dashboard's own e2e tests through the ws-reporter pipeline,
 * validating VALID-01 (event reception) and VALID-02 (artifact paths).
 *
 * Usage:
 *   1. Start the dashboard: pnpm dev
 *   2. Run tests: pnpm test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './apps/server/test-results',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : 4,

  // ── Visual regression (toHaveScreenshot) global defaults ─────────────────
  // Override per call with { maxDiffPixelRatio: N, animations: 'disabled' }.
  //
  // Baseline workflow:
  //   Generate/refresh:  npx playwright test e2e/visual-regression.spec.ts --update-snapshots
  //   Compare in CI:     npx playwright test e2e/visual-regression.spec.ts
  //   Baselines live in: e2e/visual-regression.spec.ts-snapshots/
  //   Commit baselines to git so CI can diff against them.
  expect: {
    toHaveScreenshot: {
      // Allow up to 1% of pixels to differ before failing (covers sub-pixel
      // font rendering differences between local and CI machines).
      maxDiffPixelRatio: 0.01,
      // Disable CSS animations/transitions so screenshots are deterministic.
      animations: 'disabled',
      // Wait up to 5 s for the screenshot to stabilise (useful when lazy
      // images or chart data arrive slightly after networkidle).
      timeout: 5_000,
    },
  },

  // Use ws-reporter alongside list reporter for dogfood validation
  reporter: [
    ['list'],
    [
      './apps/server/src/reporter/ws-reporter.ts',
      { port: 4001, host: 'localhost' },
    ],
  ],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    // Capture artifacts only on failure to avoid overloading the ws-reporter pipeline
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      testIgnore: '**/auth-flow.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'auth',
      testMatch: '**/auth-flow.spec.ts',
      fullyParallel: false,
      dependencies: ['chromium'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'pnpm --filter @automate/dashboard-server dev',
      url: 'http://localhost:4000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        PORT: '4000',
        REPORTER_PORT: '4001',
        AUTOMATE_DASHBOARD_API_KEY: 'test-api-key',
        RATE_LIMIT_MAX: '10000',
      },
    },
    {
      command: 'pnpm --filter @automate/dashboard-client dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
