import pg from 'pg';
import { assertTruncatable } from '../../scripts/lib/e2e-database-guard.mjs';

/**
 * Put the durable tables back to empty before an E2E run.
 *
 * **The defect this fixes (ledger E2E-4).** `execution_jobs` is one queue every spec draws
 * from, and `claimJob` refuses a runner that already holds its slot count — which is one.
 * The original `claimJobFor` drained the queue until it found its own run, discarding every
 * other claim, and was permanently at capacity after the first one. So the suite passed on
 * a fresh database and failed on the second run against the same one, reporting "the queue
 * drained without reaching it" for a recovery that works: the database showed two jobs
 * correctly requeued with `RUNNER_LOST` at the time.
 *
 * There is deliberately **no route that releases a lease** — one that could would be the
 * command-injection primitive `P-70` removed — so the fix cannot live in a spec's claim
 * loop. A run has to start from a known state, and that is here.
 *
 * **Why `globalSetup` is the right place, having been removed from this config once.** It
 * used to apply the migration graph, which cannot happen after `webServer` has started the
 * API against an unmigrated database. This is the opposite requirement: the schema must
 * already exist, and nothing must have run yet.
 *
 * **Why this is `.mjs`.** It shares the guard in `scripts/lib`, which is a plain `.mjs`
 * with its own node:test suite. Importing that from a `.ts` would need a declaration file
 * or a suppression, and AGENTS.md forbids `@ts-expect-error`; Playwright transpiles this
 * hook itself, so there is nothing to gain from typing it.
 *
 * The decision about *which* database is safe to empty is not made here — it is
 * `scripts/lib/e2e-database-guard.mjs`, tested. It cannot be tested where it runs, because
 * Playwright starts `webServer` first and a production-looking URL fails in the migration
 * step before this executes.
 */

/** The durable tables the suite writes, emptied together. */
const TABLES = ['run_events', 'artifacts', 'execution_jobs', 'tests', 'runs', 'runners'];

export default async function globalSetup() {
  const url = process.env['DATABASE_URL']?.trim() ?? '';
  const allowInMemory = ['1', 'true', 'yes'].includes(
    (process.env['E2E_ALLOW_IN_MEMORY'] ?? '').trim().toLowerCase(),
  );
  if (url === '' && allowInMemory) {
    // Deliberately in-memory: nothing durable to empty, and `playwright.config.ts` already
    // says this path proves nothing about the product.
    return;
  }

  // Throws rather than truncating anything else.
  const database = assertTruncatable(url);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`TRUNCATE TABLE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  } finally {
    await client.end();
  }

  console.info(`E2E reset: emptied ${String(TABLES.length)} durable tables in "${database}"`);
}
