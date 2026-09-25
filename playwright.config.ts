import { defineConfig, devices } from '@playwright/test';

const apiPort = 3000;
const webPort = 5173;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results',
  use: {
    baseURL: webUrl,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @automate/api run dev',
      url: `${apiUrl}/api/v1/health`,
      env: {
        PORT: String(apiPort),
        NODE_ENV: 'development',
        DATABASE_URL: process.env['DATABASE_URL'] ?? '',
        COOKIE_SECRET: 'e2e-cookie-secret-32-characters-long',
        AUTOMATE_API_KEY: 'e2e-installation-key',
        PUBLIC_APP_URL: webUrl,
      },
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @automate/unified-web exec vite --host 127.0.0.1',
      url: webUrl,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
  ],
  projects: [
    {
      name: 'vertical-slice',
      testMatch: '**/integration/vertical-slice.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'product',
      testMatch: '**/*.spec.ts',
      testIgnore: '**/integration/vertical-slice.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
