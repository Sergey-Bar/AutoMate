import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost',
    extraHTTPHeaders: {
      'X-Service-Auth': `Bearer ${process.env.AUTOMATE_SERVICE_SECRET || 'test-secret'}`,
    },
  },
  projects: [
    {
      name: 'integration',
      use: { browserName: 'chromium' },
      // Existing integration tests require a live nginx + services on port 80
      testMatch: [
        'api-routing.spec.ts',
        'cross-service.spec.ts',
        'shell-navigation.spec.ts',
        'unified-auth.spec.ts',
      ],
    },
    {
      // T17: vertical slice — tests the API + browser path end-to-end.
      // Requires API on port 3456 and Vite dev server on port 5173.
      // Started by the webServer config below.
      name: 'vertical-slice',
      use: {
        browserName: 'chromium',
        baseURL: 'http://localhost:5173',
      },
      testMatch: ['vertical-slice.spec.ts', 'ai-chat.spec.ts', 'settings-dashboard.spec.ts'],
    },
  ],

  // T17: start API + Vite dev servers for the vertical-slice project.
  // reuseExistingServer: true means if the port is already bound, use it.
  webServer: [
    {
      // Start the unified API on port 3456
      command: 'pnpm --filter @automate/api run dev',
      port: 3456,
      env: {
        PORT: '3456',
        // Explicitly NOT 'test' so the API startup guard runs the server
        NODE_ENV: 'development',
        // Supply DATABASE_URL for CI Postgres; if empty the API uses InMemoryRunRepository
        DATABASE_URL: process.env['DATABASE_URL'] ?? '',
      },
      reuseExistingServer: true,
      timeout: 20000,
    },
    {
      // Start the Vite dev server (proxies /api → http://localhost:3456)
      command: 'pnpm --filter @automate/unified-web run dev',
      port: 5173,
      reuseExistingServer: true,
      timeout: 30000,
    },
  ],
})
