import { readdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const apiPort = 3000;
const webPort = 5173;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;

/**
 * The E2E suite exists to prove the product works against a real database.
 * `process.env['DATABASE_URL'] ?? ''` used to mean an absent URL silently
 * selected the in-memory store, so the whole suite passed without PostgreSQL
 * ever being involved — while reporting success.
 *
 * An absent URL is now a configuration error. Set `DATABASE_URL`, or set
 * `E2E_ALLOW_IN_MEMORY=1` to deliberately run the in-memory path (which proves
 * nothing about the durable product and is not a release signal).
 */
const databaseUrl = process.env['DATABASE_URL']?.trim() ?? '';
const allowInMemory = ['1', 'true', 'yes'].includes(
  (process.env['E2E_ALLOW_IN_MEMORY'] ?? '').trim().toLowerCase(),
);
if (databaseUrl === '' && !allowInMemory) {
  throw new Error(
    'DATABASE_URL is required for the E2E suite. Without it the API falls back ' +
      'to the in-memory store and the suite passes without ever touching ' +
      'PostgreSQL. Set DATABASE_URL, or set E2E_ALLOW_IN_MEMORY=1 to run ' +
      'deliberately against the in-memory path.',
  );
}

/**
 * A Playwright project that matches no test file still appears as a passing
 * CI job. The `product` project matched every spec except the vertical slice,
 * and the vertical slice was the only spec in the tree, so it ran zero tests.
 * The project list is derived from the spec files that exist instead, and an
 * empty set is a hard error.
 */
function listSpecFiles(relativeRoot: string): string[] {
  const base = path.join(__dirname, relativeRoot);
  const found: string[] = [];
  const stack = [base];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.spec.ts')) found.push(full);
    }
  }
  return found;
}

const specFiles = listSpecFiles('e2e');
if (specFiles.length === 0) {
  throw new Error(
    'No *.spec.ts files were found under e2e/. A Playwright run with no ' +
      'specs reports success without executing anything.',
  );
}

/**
 * The product specs: everything except the vertical slice, which has its own project.
 */
const productSpecs = specFiles.filter(
  (file) => !file.replaceAll('\\', '/').endsWith('vertical-slice.spec.ts'),
);

/**
 * A project that matches no spec is reported, not thrown.
 *
 * The previous version threw when `product` was empty, which was defensible in
 * isolation and wrong in practice: a throw at config load aborts the *whole* run,
 * so an empty `product` project destroyed the `vertical-slice` project that had
 * real specs and would otherwise have run. Losing the tests that exist to protect
 * a concern about tests that do not exist is the wrong trade.
 *
 * The `e2e/` directory holds exactly one spec today — the vertical slice — so this
 * path is the normal one, not an edge case. Omitting the project and saying so
 * means the run executes what is there and the output names what is missing, which
 * is the three-outcome rule: ran, found a problem, or did not run with a stated
 * reason. It is not the same as passing silently, because the reason is printed
 * every time rather than inferred from a missing row.
 */
if (productSpecs.length === 0) {
  console.warn(
    '[playwright] not_configured: the `product` project has no specs, so it is omitted. ' +
      `Found ${specFiles.length} spec file(s) under e2e/, all belonging to ` +
      '`vertical-slice`. The product surface has no end-to-end coverage yet — that is ' +
      'a real gap, and this line is the only thing in the CI output that says so.',
  );
}

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
        DATABASE_URL: databaseUrl,
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
    ...(productSpecs.length === 0
      ? []
      : [
          {
            // Scoped to the specs that exist, and omitted entirely when there are
            // none, so this job cannot become a green no-op.
            name: 'product',
            testMatch: productSpecs.map((file) =>
              path.relative(path.join(__dirname, 'e2e'), file).replaceAll('\\', '/'),
            ),
            use: { ...devices['Desktop Chrome'] },
          },
        ]),
  ],
});
