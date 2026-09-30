import { readdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { INSTALLATION_KEY, RUNNER_REGISTRATION_SECRET, WEB_BASE } from './e2e/support/config.js';

/**
 * The ports and URLs the suite's servers bind.
 *
 * `WEB_BASE` is imported rather than restated for the same reason `INSTALLATION_KEY`
 * is: the web dev server and the browser flow have to agree, and two literals in two
 * files is how they stopped agreeing — silently, and only at run time.
 */
const apiPort = 3000;
const apiUrl = `http://127.0.0.1:${apiPort}`;
// The web port now lives in `e2e/support/config.ts` as part of `WEB_BASE`, so there is
// one place that says where the browser goes. `webPort` was left behind as an unused
// local, which is the same class of drift as the two copies of the key: a value that
// nobody reads, left in the file to look like it still does something.
const webUrl = WEB_BASE;

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
 * The root of this config file's own directory.
 *
 * The root `package.json` declares `"type": "module"`, so Playwright loads this
 * file as an ES module — confirmed by the stack frame reading
 * `file:///…/playwright.config.ts`. `__dirname` does not exist in that scope, and
 * it was used in two places, so `pnpm test:e2e` died at config load with
 * `ReferenceError: __dirname is not defined in ES module scope` before collecting
 * a single test. A committed `playwright.config.local.ts` had grown around that
 * crash; it is deleted, and this is the one spelling.
 *
 * `import.meta.dirname` rather than `fileURLToPath(import.meta.url)`: the repo
 * already requires Node 24, and `eslint.config.js` uses the same property.
 */
const configDir = import.meta.dirname;

/**
 * A Playwright project that matches no test file still appears as a passing
 * CI job. The `product` project matched every spec except the vertical slice,
 * and the vertical slice was the only spec in the tree, so it ran zero tests.
 * The project list is derived from the spec files that exist instead, and an
 * empty set is a hard error.
 */
function listSpecFiles(relativeRoot: string): string[] {
  const base = path.join(configDir, relativeRoot);
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

const RENDER_BUDGET_SPEC = 'rendering-budget.spec.ts';

/**
 * The specs that belong to a project of their own rather than to `product`.
 *
 * `product` is "every product spec", derived from the tree so it cannot become a green
 * no-op — which means a spec added for a *gate* would otherwise be swept into every
 * ordinary E2E run. The rendering budget is exactly that: it needs a settled page per
 * route, so it would add a fixed wait to every PR's product run for a measurement only
 * `pnpm test:render` reads. Naming the exceptions here keeps the derivation honest
 * rather than special-casing it at each project.
 */
const DEDICATED_SPECS = ['vertical-slice.spec.ts', RENDER_BUDGET_SPEC];

/** Normalized so the comparison is a suffix match on any platform's separator. */
const baseNameOf = (file: string): string => file.replaceAll('\\', '/');

const isDedicated = (file: string): boolean => {
  const normalized = baseNameOf(file);
  return DEDICATED_SPECS.some((name) => normalized.endsWith(name));
};

const productSpecFiles = specFiles.filter((file) => !isDedicated(file));

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  // Applies the migration graph before any test runs. See the file for why this is here
  // and not as a step in the workflow: a clean database was never prepared, and the two
  // defects that hid each other meant the required E2E job could not have passed.
  globalSetup: './e2e/support/global-setup.ts',
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
      // The `@automate/db` build is part of the command, not a step in each job.
      //
      // `pnpm install` does not build, so `packages/db/dist/` does not exist in a fresh
      // checkout, and the API's `dev` script imports `@automate/db` — which resolves
      // through `node_modules` to that `dist`. Without the build the server died with
      // `Cannot find module '…/node_modules/@automate/db/dist/index.js'` and
      // `Process from config.webServer was not able to start`, which is how the
      // `Rendering budget` job failed. It would have failed the two E2E jobs the same way.
      //
      // It belongs here rather than in three workflow steps because **Playwright starts
      // `webServer` before `globalSetup` runs** — so the `globalSetup` that applies the
      // migration graph cannot be the thing that builds the package the server imports.
      // One command, one reason, and a developer running the suite locally gets the same
      // server the runner does.
      command: 'pnpm --filter @automate/db build && pnpm --filter @automate/api run dev',
      url: `${apiUrl}/api/v1/health`,
      env: {
        PORT: String(apiPort),
        NODE_ENV: 'development',
        DATABASE_URL: databaseUrl,
        COOKIE_SECRET: 'e2e-cookie-secret-32-characters-long',
        AUTOMATE_API_KEY: INSTALLATION_KEY,
        // The lane enrols a runner, and enrolling is a separate act from reading runs.
        // Without this the register route answered `RUNNER_REGISTRATION_UNAUTHORIZED`:
        // it treats a *missing* secret as a misconfiguration outside `NODE_ENV=test`, and
        // this lane runs as `development`.
        RUNNER_REGISTRATION_SECRET,
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
      // Scoped to the specs that exist, and asserted non-empty below, so this
      // job cannot become a green no-op.
      name: 'product',
      // `path.relative` runs on the **original** path and the result is normalized
      // after it, not before. Handing it an already-forward-slashed absolute path on
      // Windows makes it return a nonsense relative path, `product` then matches no
      // spec, and the suite quietly drops from 19 tests to 6 while still reporting
      // success — which is precisely the green no-op the derivation exists to prevent.
      testMatch: productSpecFiles.map((file) =>
        path.relative(path.join(configDir, 'e2e'), file).replaceAll('\\', '/'),
      ),
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // The rendering budget is a gate with its own command (`pnpm test:render`), not
      // part of `pnpm test:e2e`. It settles four routes on a timer, so folding it into
      // the product run would slow every PR to buy a number nothing there reads. Its
      // assertions still run in CI, as their own job.
      name: 'rendering-budget',
      testMatch: '**/performance/rendering-budget.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

// Reading a spec list at config time is only useful if the list is not empty.
//
// Unconditionally, and matching the budget project's assertion below rather than
// gating on `process.env['CI']` as this used to. The failure it catches is identical
// either way: a configuration where `product` matches no spec is a green job that ran
// nothing, on a developer machine exactly as much as on a runner. Detecting it only in
// CI means a local `pnpm test:e2e` reports success having executed five vertical-slice
// tests and no product test at all, which is the more misleading of the two reports
// because the developer is the one who can fix it.
if (productSpecFiles.length === 0) {
  throw new Error(
    'The `product` Playwright project matches no spec files, so a run would report ' +
      'success without executing a product test. That is treated as a configuration ' +
      'error rather than an empty suite.',
  );
}

// The same argument for the budget project, and the more important of the two: a
// rendering gate whose project matches nothing is a green job that measured nothing,
// which is the one outcome this whole gate exists to make impossible. Checked against
// the file list rather than by running a project, because the claim is about the tree.
if (!specFiles.some((file) => baseNameOf(file).endsWith(RENDER_BUDGET_SPEC))) {
  throw new Error(
    'The `rendering-budget` Playwright project matches no spec file, so ' +
      '`pnpm test:render` would report success without measuring a single route. ' +
      'A rendering budget that measured nothing is not a budget.',
  );
}
