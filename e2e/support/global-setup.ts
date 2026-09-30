/**
 * Playwright `globalSetup` — apply the migration graph before the suite runs.
 *
 * **The required E2E job could not pass without this, for a reason nobody noticed.**
 * The `e2e` job in `.github/workflows/unified-ci.yml` starts a clean
 * `postgres:16-alpine` and runs `pnpm test:e2e`, and `playwright.config.ts` throws
 * without `DATABASE_URL` precisely so the suite cannot silently fall back to the
 * in-memory store. But nothing ever *applied the schema*: the job never ran
 * `pnpm db:migrate`, and there was no `globalSetup`. So the API started against an
 * empty database and every route that touches a table failed. It was unreported
 * because the suite was also broken one step earlier — the installation key in
 * `e2e/support/config.ts` did not match the one in `playwright.config.ts`, so every
 * authenticated call answered 401 — and a suite that cannot get past authentication
 * tells you nothing about the schema underneath it.
 *
 * Two defects, one on top of the other, and 17 of 19 tests red. The honest lesson is
 * the one the repository keeps writing down: **a gate that has never been observed
 * green is not a gate.** This file is here so the next person does not have to
 * discover that from a red job.
 *
 * **Why `globalSetup` rather than a step in the workflow.** The migration is part of
 * standing the product up, not part of asserting something about it. Putting it here
 * means a developer's `pnpm test:e2e` against an empty database works, and means the CI
 * job cannot be changed into a shape that starts a clean database and forgets to
 * prepare it — which is exactly the shape that was there.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/**
 * Run a command in the repository root, and fail loudly.
 *
 * A `globalSetup` that swallows a non-zero exit turns a migration failure into a
 * suite that fails for a different reason, ten seconds later, with a message about a
 * missing table. That is the same class of failure as a silent pass, pointed the other
 * way: the cause is separated from the symptom by more than it needs to be.
 *
 * @param {string} label what is being run, for the error message
 * @param {string[]} command
 */
function run(label: string, command: string[]): void {
  const result = spawnSync(command[0] ?? '', command.slice(1), {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(
      `E2E setup: \`${label}\` failed with exit code ${String(result.status)}. ` +
        'The suite cannot run against a database whose schema is unknown, and continuing would ' +
        'report a failure about a missing table rather than about the migration that was never ' +
        'applied.',
    );
  }
}

export default function globalSetup(): void {
  const databaseUrl = process.env['DATABASE_URL']?.trim() ?? '';
  const allowInMemory = ['1', 'true', 'yes'].includes(
    (process.env['E2E_ALLOW_IN_MEMORY'] ?? '').trim().toLowerCase(),
  );

  if (databaseUrl === '' && !allowInMemory) {
    // `playwright.config.ts` already throws for this, and it throws while the config is
    // being loaded, which is before this runs. Repeated here so the message is attached
    // to the setup step in a CI log rather than to a config-load trace.
    throw new Error(
      'E2E setup: DATABASE_URL is required to apply the migration graph. Set it, or set ' +
        'E2E_ALLOW_IN_MEMORY=1 to run deliberately against the in-memory path — which proves ' +
        'nothing about the durable product and is not a release signal.',
    );
  }

  if (databaseUrl === '') {
    // `warn`, not `log`: the lint rule allows only warn/error/info, and this is a
    // warning about what the run is worth rather than progress.
    console.warn(
      'E2E setup: E2E_ALLOW_IN_MEMORY is set, so no migration was applied. This run proves ' +
        'nothing about the durable product.',
    );
    return;
  }

  // `dist/` is not in the checkout — `pnpm install` does not build — so the runner has to
  // be built before it can be run. In CI that is the difference between the migration
  // running and the whole setup failing with a module-not-found.
  run('build @automate/db', ['pnpm', '--filter', '@automate/db', 'build']);
  run('apply the migration graph', ['pnpm', 'db:migrate']);
}
