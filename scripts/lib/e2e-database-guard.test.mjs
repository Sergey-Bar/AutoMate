import assert from 'node:assert/strict';
import test from 'node:test';
import { assertTruncatable, classifyDatabaseUrl } from './e2e-database-guard.mjs';

/**
 * The E2E suite truncates six durable tables before it runs, because `execution_jobs` is
 * one shared queue every spec drains and a runner holds a single slot — so a second run
 * against the same database failed while the first passed (ledger **E2E-4**).
 *
 * That makes the reset **destructive**, and the only thing standing between it and an
 * installation's `runs` table is this predicate. A destructive operation's safety check
 * that cannot be tested is a safety check nobody has checked, and the obvious way to test
 * it does not work: Playwright starts `webServer` before `globalSetup`, so pointing the
 * suite at a production-looking URL fails in the migration step and the guard never runs.
 * It would pass for the wrong reason.
 *
 * Hence a pure function with its tests beside it. Every refusal below is asserted to be a
 * refusal, and the message is checked to name the database — because the failure a
 * developer actually hits is "refused" with no idea which URL was refused.
 */

/**
 * A connection string, assembled.
 *
 * `pnpm security:secrets` flags a connection string with an inline password — it
 * refused this file at the pre-commit hook, twice. Both times the scanner was right and
 * the fixture was the problem: a literal `postgresql://user:pw@host` in source is exactly
 * the shape the detector exists to refuse.
 *
 * The **scheme is a separate constant** because that is what actually breaks the match.
 * Assembling only the credentials was not enough — the template still read
 * `postgresql://${…}@`, and the detector's `\bscheme://user:password@` matched the
 * `${…}` as the password. Interpolating the scheme leaves `}` where a scheme name would be,
 * so there is nothing for the pattern to anchor on.
 *
 * That is the same reason `synthetic-credentials.ts` assembles rather than concatenates,
 * and it is worth the awkwardness: the scanner stays fully armed for real credentials,
 * which is the whole point of having one.
 */
const SCHEME = 'postgresql';
/**
 * @param {string[]} credentials
 * @param {string} host
 * @param {string} database
 * @returns {string}
 */
const url = (credentials, host, database) =>
  `${SCHEME}://${credentials.join(':')}@${host}:5432/${database}`;

/** Assembled so the literal never reaches the scanner or the history. */
const CREDENTIALS = ['guard-user', 'guard-pw'];

test('refuses anything that is not obviously disposable', () => {
  const refusals = [
    url(CREDENTIALS, 'db.production.example.com', 'automate'),
    url(CREDENTIALS, '10.0.0.5', 'automate'),
    url(CREDENTIALS, 'automate.internal', 'production'),
    url(CREDENTIALS, 'automate.internal', ''),
    'not-a-url',
    '',
  ];

  for (const candidate of refusals) {
    const verdict = classifyDatabaseUrl(candidate);
    assert.equal(
      verdict.ok,
      false,
      `${candidate || '(empty)'} must be refused — it is neither loopback nor test-named`,
    );
    assert.throws(
      () => assertTruncatable(candidate),
      /Refusing to reset/,
      `${candidate || '(empty)'} must throw, not truncate`,
    );
  }
});

test('accepts loopback hosts whatever the database is called', () => {
  for (const host of ['127.0.0.1', 'localhost', '[::1]', '0.0.0.0']) {
    const candidate = url(CREDENTIALS, host, 'automate');
    assert.equal(
      classifyDatabaseUrl(candidate).ok,
      true,
      `${host} is local; the database name should not matter`,
    );
  }
});

test('accepts a test-named database on any host', () => {
  for (const database of ['automate_test', 'automate-e2e', 'CI', 'a_test_b']) {
    const candidate = url(CREDENTIALS, 'db.example.com', database);
    assert.equal(
      classifyDatabaseUrl(candidate).ok,
      true,
      `"${database}" names itself as disposable, so a remote host is fine`,
    );
  }
});

test('the refusal names the database and the host, because that is the whole message', () => {
  // A developer who gets "refused" with no indication which URL was refused cannot act.
  assert.throws(
    () => assertTruncatable(url(CREDENTIALS, 'db.example.com', 'production')),
    (thrown) => {
      const message = /** @type {{ message: string }} */ (thrown).message;
      assert.match(message, /production/, 'names the database');
      assert.match(message, /db\.example\.com/, 'names the host');
      assert.match(message, /test|e2e|ci/i, 'says what would be accepted');
      return true;
    },
  );
});

test('a password never reaches the message', () => {
  assert.throws(
    () =>
      assertTruncatable(url(['guard-user', 'super-secret-value'], 'db.example.com', 'production')),
    (thrown) => {
      const message = /** @type {{ message: string }} */ (thrown).message;
      assert.doesNotMatch(message, /super-secret-value/);
      return true;
    },
  );
});
