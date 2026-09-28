import assert from 'node:assert/strict';
import test from 'node:test';
import { rehearseMigration, toReport } from './rehearsal-run.mjs';

/**
 * The sequence half of RF-5, tested with no database, no key and no vault.
 *
 * The mistakes in a rehearsal live in the *sequence* — a migration applied to the
 * source instead of the copy, a restore that failed and was then reported as an empty
 * table, a report that claims a run that did not happen. None of those need a live
 * PostgreSQL to be demonstrated, and all of them are the reason this is a function with
 * injected transports rather than a shell script somebody runs once by hand.
 */

/**
 * @typedef {import('./rehearsal-run.mjs').RehearsalTransports} RehearsalTransports
 * @typedef {{ calls: string[], transports: RehearsalTransports }} Harness
 */

/**
 * Transports where every phase succeeds and every row opens.
 *
 * @param {Array<{ rowId: string }>} [rows]
 * @returns {Harness}
 */
function allGood(rows = [{ rowId: 'a' }, { rowId: 'b' }]) {
  /** @type {string[]} */
  const calls = [];
  /** @type {RehearsalTransports} */
  const transports = {
    dump: async (_to) => {
      calls.push('dump');
      return '/tmp/rehearsal.dump';
    },
    restore: async (from) => {
      calls.push(`restore:${from}`);
    },
    migrate: async (target) => {
      calls.push(`migrate:${target}`);
    },
    fetchSealedRows: async () => {
      calls.push('fetch');
      return rows.map((row) => ({ rowId: row.rowId, input: row }));
    },
    open: () => ({ ok: true, value: 'secret' }),
  };
  return { calls, transports };
}

test('a run where every phase succeeds and every row opens passes', async () => {
  const { transports } = allGood();
  const result = await rehearseMigration(transports, {
    source: 'postgresql://127.0.0.1/source',
    restore: 'postgresql://127.0.0.1/restore',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.problems, []);
  assert.equal(result.verification?.verified, 2);
  assert.deepEqual(
    result.phases.map((phase) => phase.status),
    ['ok', 'ok', 'ok', 'ok', 'ok'],
  );
});

test('the migration is applied to the restore and never to the source', async () => {
  // D1 is "rehearse before breaking". A rehearsal that migrated the source has proved
  // that a migration runs, which is the thing you already knew from CI applying it to
  // an empty schema. What is unknown is whether it runs over data.
  const { transports, calls } = allGood();
  await rehearseMigration(transports, {
    source: 'postgresql://127.0.0.1/source',
    restore: 'postgresql://127.0.0.1/restore',
  });

  assert.ok(!calls.includes('migrate:postgresql://127.0.0.1/source'));
  assert.ok(calls.includes('migrate:postgresql://127.0.0.1/restore'));
  // And the dump is taken before the migration, so the copy is of the *pre*-migration
  // database. Restoring a post-migration dump and migrating it again is a different
  // rehearsal, and it proves nothing about the data.
  assert.ok(calls.indexOf('dump') < calls.indexOf('migrate:postgresql://127.0.0.1/restore'));
});

test('a failed dump stops the run and is not reported as an empty table', async () => {
  const { transports } = allGood();
  transports.dump = async () => {
    throw new Error('pg_dump: connection refused');
  };

  const result = await rehearseMigration(transports);

  assert.equal(result.ok, false);
  // The distinction that matters: a stopped run has no verification result at all,
  // rather than a verification result of "0 rows opened", which is what a reader
  // cannot tell from a genuinely empty vault.
  assert.equal(result.verification, null);
  assert.match(result.problems.join(' '), /dump failed: pg_dump: connection refused/);
  assert.deepEqual(
    result.phases.map((phase) => phase.name),
    ['dump'],
  );
});

test('a failed restore stops the run rather than restoring from nothing', async () => {
  const { transports, calls } = allGood();
  transports.restore = async () => {
    throw new Error('pg_restore: could not connect');
  };

  const result = await rehearseMigration(transports);

  assert.equal(result.ok, false);
  assert.equal(result.verification, null);
  assert.ok(!calls.includes('fetch'));
});

test('a failed migration stops the run, because the ciphertexts are not yet at risk', async () => {
  // A migration that did not apply has not broken anything, and reporting "0 rows
  // opened" against the pre-migration shape would read as a destroyed vault.
  const { transports, calls } = allGood();
  transports.migrate = async () => {
    throw new Error('migration 0021 failed');
  };

  const result = await rehearseMigration(transports);

  assert.equal(result.ok, false);
  assert.equal(result.verification, null);
  assert.ok(!calls.includes('fetch'));
});

test('a row that will not open fails the run, and the failure is classified', async () => {
  const { transports } = allGood();
  transports.open = (row) =>
    row.rowId === 'b'
      ? { ok: false, reason: 'binding_mismatch', detail: 'workspace_id changed' }
      : { ok: true, value: 'secret' };

  const result = await rehearseMigration(transports);

  assert.equal(result.ok, false);
  assert.equal(result.verification?.verified, 1);
  assert.equal(result.verification?.failures.length, 1);
  assert.equal(result.verification?.failures[0]?.rowId, 'b');
  assert.match(String(result.verification?.failures[0]?.advice), /renamed or re-typed column/);
  assert.equal(result.phases.at(-1)?.status, 'failed');
});

test('an opener that throws is a broken harness, not a broken row', async () => {
  // The verifier catches it, and the distinction is load-bearing: an opener that throws
  // on the first row would otherwise look like one unreadable row, and an operator
  // would go and restore data that was never touched.
  const { transports } = allGood();
  transports.open = () => {
    throw new Error('the vault module failed to load');
  };

  const result = await rehearseMigration(transports);

  assert.equal(result.ok, false);
  assert.match(String(result.verification?.failures[0]?.detail), /the opener threw/);
});

test('a vault with no sealed rows fails, rather than passing vacuously', async () => {
  const { transports } = allGood([]);
  const result = await rehearseMigration(transports);

  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /no rows were verified/);
});

test('every row is attempted, so one failure does not hide the others', async () => {
  const { transports } = allGood([{ rowId: 'a' }, { rowId: 'b' }, { rowId: 'c' }]);
  transports.open = (row) =>
    row.rowId === 'a' ? { ok: true, value: 'x' } : { ok: false, reason: 'unreadable' };

  const result = await rehearseMigration(transports);

  assert.equal(result.verification?.failures.length, 2);
  assert.deepEqual(
    (result.verification?.failures ?? []).map((failure) => failure.rowId),
    ['b', 'c'],
  );
});

test('the report derives rehearsalPerformed from the phases', async () => {
  const { transports } = allGood();
  const ok = await rehearseMigration(transports);
  const passed = toReport(ok, { rehearsalId: 'abc' });

  assert.equal(passed.rehearsalPerformed, true);
  assert.deepEqual(passed.performedPhases, ['dump', 'restore', 'migrate', 'fetch', 'verify']);
  assert.equal(passed.productionCutoverAuthorized, false);

  const { transports: broken } = allGood();
  broken.migrate = async () => {
    throw new Error('nope');
  };
  const failed = toReport(await rehearseMigration(broken));

  // The field the previous script got wrong, which read `rehearsalPerformed: false`
  // under a heading reading "rehearsal passed". It is derived, not asserted.
  assert.equal(failed.rehearsalPerformed, false);
  assert.deepEqual(failed.performedPhases, ['dump', 'restore']);
  assert.equal(failed.ok, false);
});

test('a report never authorises a cutover, whatever the caller believes', async () => {
  // A rehearsal is evidence for a human decision. A script that could authorise its own
  // cutover would make the rehearsal a formality, and D1 a rubber stamp.
  const { transports } = allGood();
  const report = toReport(await rehearseMigration(transports), {
    productionCutoverAuthorized: true,
  });

  assert.equal(report.productionCutoverAuthorized, false);
});
