import { defineConfig, devices } from '@playwright/test';

/**
 * The browser half of R-020 for AUTOMATE (local): an automated accessibility check and
 * keyboard reach on the MVP-0 screens, in a real Chromium, in both colour schemes.
 *
 * Separate from the root `playwright.config.ts`, which boots the server platform against
 * PostgreSQL; this product needs neither. Each spec starts the real launcher itself.
 */
export default defineConfig({
  testDir: './test/browser',
  testMatch: '*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], trace: 'off' },
});
