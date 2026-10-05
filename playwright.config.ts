import { readdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import {
  API_BASE,
  API_PORT,
  INSTALLATION_KEY,
  RUNNER_REGISTRATION_SECRET,
  WEB_BASE,
} from './e2e/support/config.js';

/**
 * The ports and URLs the suite's servers bind.
 *
 * `WEB_BASE` is imported rather than restated for the same reason `INSTALLATION_KEY`
 * is: the web dev server and the browser flow have to agree, and two literals in two
 * files is how they stopped agreeing — silently, and only at run time.
 */
/**
 * The ports and URLs the suite binds, imported rather than restated.
 *
 * `API_BASE`, `WEB_BASE`, `API_PORT` and `WEB_PORT` all come from
 * `e2e/support/config.ts`, which reads `E2E_API_PORT` and `E2E_WEB_PORT`.
 *
 * **This file used to hold `apiPort = 3000` beside those literals,** and that is a second
 * copy of one value: the server and the client could be moved apart, and when they were,
 * the suite started its API on one port and posted every login to whatever was on the
 * other. The header in that module says why the ports are overridable; the reason they are
 * safe to override is that this file reads the same numbers.
 *
 * @see e2e/support/config.ts
 */
const apiPort = API_PORT;
const apiUrl = API_BASE;
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
const DEDICATED_SPECS = [
  'vertical-slice.spec.ts',
  RENDER_BUDGET_SPEC,
  // The durable-chain gate. It is a gate rather than a product spec in two senses: it
  // is what point 3 of `status:ten` reads, and it spends most of its time waiting out a
  // lease expiry. Folding it into `product` would add that wait to every pull request
  // to be measured by a job that reads it — which is the same reason the rendering
  // budget is named here. It gets its own project below so `pnpm test:e2e` still runs
  // it, rather than the derivation quietly dropping it.
  'durable-path.spec.ts',
  // The route-level axe gate, and the wave the glass work is sequenced behind
  // (`.kilo/plans/1791096500000-full-glassmorphism-plan.md` §3.4). It is 66 generated
  // tests — every manifest route in two themes plus four forced data states — and it is
  // a gate rather than a product spec for the same reason the rendering budget is: it
  // measures something, it is read by `pnpm status:10`, and folding it into `product`
  // would add 66 page loads to every pull request to buy a number the product suite
  // does not read. It gets its own project below so `pnpm test:e2e` still runs it.
  'accessibility/routes.spec.ts',
];

/** Normalized so the comparison is a suffix match on any platform's separator. */
const baseNameOf = (file: string): string => file.replaceAll('\\', '/');

const isDedicated = (file: string): boolean => {
  const normalized = baseNameOf(file);
  return DEDICATED_SPECS.some((name) => normalized.endsWith(name));
};

const productSpecFiles = specFiles.filter((file) => !isDedicated(file));
const durablePathSpecFiles = specFiles.filter((file) => file.endsWith('durable-path.spec.ts'));

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  // **`globalSetup` is back, for the opposite reason it was removed.**
  //
  // It used to apply the migration graph here, which is the right job in the wrong place:
  // **Playwright starts `webServer` before `globalSetup` runs**, so the API booted against
  // an unmigrated database and died with `relation "installations" does not exist` before
  // setup had a turn. The migration is part of the `webServer` command now, and this
  // file's own `DATABASE_URL` guard is the refusal `globalSetup` duplicated.
  //
  // What is left for it is the one job that *needs* a live schema and must happen before
  // any spec: emptying the durable tables. `execution_jobs` is a single queue every spec
  // draws from and `claimJob` refuses a runner already holding its slot, so a second run
  // against the same database failed while the first passed (ledger **E2E-4**). There is
  // deliberately no route that releases a lease — one that could would be the
  // command-injection primitive `P-70` removed — so a run cannot clean up after itself
  // from inside a spec.
  //
  // It refuses to run against anything that is not a loopback host or a database whose
  // name contains test/e2e/ci, because it truncates.
  globalSetup: './e2e/support/reset-queue.mjs',
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
      // Build, migrate, then serve — in that order, in one command, because
      // **Playwright starts `webServer` before `globalSetup` runs.**
      //
      // The API boots, queries `installations`, and dies with `relation "installations"
      // does not exist` before any setup of ours has had a turn, which is how the
      // `Rendering budget` job failed even with the build in place. Nothing that runs
      // *after* the server can prepare the database for it.
      //
      // So both live here. The build, because the API's `dev` script imports
      // `@automate/db` and `@automate/shared-contracts` through `node_modules` to their
      // `dist`s, which `pnpm install` does not produce; `--filter @automate/api...` is
      // pnpm's own answer on that — the package *and its dependencies*, read from the
      // graph rather than from a list to keep in step with it. The migration, because a
      // server that boots against an unmigrated database does not start at all.
      //
      // A developer running the suite locally gets the server the runner does, and the
      // migration is idempotent, so a second run applies nothing and says so.
      command: [
        'pnpm --filter @automate/api... build',
        'pnpm db:migrate',
        'pnpm --filter @automate/api run dev',
      ].join(' && '),
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
        // **A project, so the cockpit has a subject to render.** The cockpit is
        // project-scoped: `Cockpit.tsx` reads `subject.id`, loads five endpoints for it,
        // and returns the onboarding screen outright when no project is registered. The
        // specs seed *runs*, which are workspace-scoped, so without this they were signing
        // in to an install with runs and finding no dashboard — `run-item-…` and the
        // readiness card were absent because the page never reached the list, not because
        // the list was broken.
        //
        // This is the mechanism the product itself documents. The onboarding screen says
        // "Set AUTOMATE_PROJECT_ROOT to the checkout you want analysed and restart the
        // API", and `discoverProjectAtBoot` registers it at boot with no default — in
        // compose the working directory is `/app`, so a default would register the
        // container as the user's project. Setting it here is that instruction, followed,
        // rather than a test-only back door.
        //
        // `configDir` is the repository root, which has the `package.json` and the
        // workspace file the detectors read.
        AUTOMATE_PROJECT_ROOT: configDir,
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
    {
      // The durable chain, and the only project whose assertions `status:ten` point 3
      // reads. Named here so it is excluded from `product` — it waits out a lease
      // expiry, which is minutes of wall clock on every pull request — and given its own
      // project so excluding it is not the same as skipping it.
      //
      // The non-empty assertion below covers it for the same reason it covers
      // `product`: a project matching no spec is a green job that ran nothing.
      name: 'durable-path',
      testMatch: '**/product/durable-path.spec.ts',
      // Longer than the default, because the lost-lease stage polls for a lease to
      // expire and a timeout that fires first reports a product defect that is really
      // a too-short budget.
      timeout: 120_000,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // axe over every route. Its own project, for the reason the rendering budget has
      // one, and the non-empty assertion below covers it: a gate whose project matches
      // nothing is a green job that ran no accessibility check at all, which is the one
      // outcome this whole wave exists to prevent.
      name: 'accessibility',
      testMatch: '**/accessibility/routes.spec.ts',
      // Motion off at the source, because axe reads computed colour with no reference to
      // opacity: sampled mid-fade it reports a `color-contrast` violation against a
      // background nobody will ever see, which is how the first run of this spec failed
      // three tests that all passed on the retry. `motion.css` already honours the
      // preference, so this measures the state a person actually reads, and it removes
      // the race rather than papering over it.
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
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

// The same guard for the dedicated projects. `durable-path` is a gate point 3 reads, so
// a project of its own that matches nothing would turn a required claim into a green
// job that executed no test — the failure this file has already had to fix twice.
for (const [name, matched] of [
  ['durable-path', durablePathSpecFiles.length],
  ['vertical-slice', specFiles.filter((file) => file.includes('vertical-slice.spec.ts')).length],
  [
    'accessibility',
    specFiles.filter((file) => baseNameOf(file).endsWith('accessibility/routes.spec.ts')).length,
  ],
] as const) {
  if (matched === 0) {
    throw new Error(
      `The \`${name}\` Playwright project matches no spec files, so a run would report ` +
        'success without executing the gate it exists to run.',
    );
  }
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
