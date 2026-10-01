import { URL } from 'node:url';

/**
 * Whether a `DATABASE_URL` is safe to truncate.
 *
 * Extracted from `e2e/support/reset-queue.ts` rather than living inside it, for one
 * reason: **the guard could never be exercised where it runs.** Playwright starts
 * `webServer` before `globalSetup`, so pointing the suite at an unreachable host fails in
 * the migration step and `globalSetup` never executes — which means a test written the
 * obvious way ("point it at a production-looking URL and assert it refuses") would pass
 * for the wrong reason. It fails earlier, in a different file, having never called this.
 *
 * So the decision is a pure function, here, with the tests beside it. The E2E suite's
 * reset is destructive; the only thing between it and an installation's `runs` table is
 * this predicate, and a predicate nobody can test is a predicate nobody has checked.
 *
 * The check is deliberately **narrow rather than clever** — a loopback host, or a
 * database whose name contains test, e2e, or ci. Anything cleverer is a rule that will
 * eventually be clever in the wrong direction, and the cost of guessing wrong here is an
 * emptied table rather than a red test.
 */

/** Case-insensitive substrings that mark a database as disposable. */
const TEST_MARKERS = ['test', 'e2e', 'ci'];

/** Hosts where "local" is unambiguous. */
const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '0.0.0.0'];

/**
 * @param {string} url a `DATABASE_URL`
 * @returns {{ ok: true, database: string }
 *   | { ok: false, database: string, host: string, reason: string }}
 */
export function classifyDatabaseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      database: '(unparseable)',
      host: '(unparseable)',
      reason: 'DATABASE_URL is not a URL.',
    };
  }

  const database = parsed.pathname.replace(/^\//, '');
  // `URL.hostname` keeps the brackets on an IPv6 literal — `new URL('postgresql://u@[::1]/x')`
  // gives `[::1]`, not `::1` — so they are stripped before the comparison. Without this,
  // `::1` is the one loopback address the guard would refuse, which is the sort of thing
  // that only shows up on the machine where it matters.
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const loopback = LOOPBACK.includes(host);
  const named = TEST_MARKERS.some((marker) => database.toLowerCase().includes(marker));

  if (loopback) return { ok: true, database };
  if (named) return { ok: true, database };

  return {
    ok: false,
    database,
    host,
    reason:
      `it is neither a loopback host (${LOOPBACK.join(', ')}) nor a database whose name ` +
      `contains one of ${TEST_MARKERS.join(', ')}.`,
  };
}

/**
 * @param {string} url
 * @returns {string} the database name, for the log line
 * @throws when the URL is not safe to truncate
 */
export function assertTruncatable(url) {
  const verdict = classifyDatabaseUrl(url);
  if (verdict.ok) return verdict.database;
  throw new Error(
    `Refusing to reset "${verdict.database}" on ${verdict.host}: ${verdict.reason} The E2E ` +
      'suite empties the durable tables, so it will not do that to an installation. Point ' +
      'DATABASE_URL at a disposable database, or name it so this check passes.',
  );
}
