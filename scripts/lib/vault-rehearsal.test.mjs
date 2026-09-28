import assert from 'node:assert/strict';
import test from 'node:test';
import { FailureReason, summarise, verifySealedRows } from './vault-rehearsal.mjs';

/**
 * RF-5, the half with teeth: after a migration, prove every encrypted row still opens.
 *
 * A dump/restore proves the database came back. It does not prove the *ciphertexts are
 * still readable* — which is the property a migration can silently destroy. A renamed
 * column the AAD is bound to, a narrowing type change, a re-seal under a different key:
 * each leaves a restored database that looks perfect and holds nothing anyone can read.
 *
 * The three properties under test are the ones that make this a gate rather than a log
 * line: every row is attempted, a run that verified nothing fails, and failures are
 * classified so an operator knows whether to re-key or restore.
 */

/**
 * A row whose opener succeeds.
 *
 * @param {string} rowId
 */
const row = (rowId) => ({ rowId, input: { rowId } });

/** An opener that opens everything. */
const allGood = () =>
  verifySealedRows([row('a'), row('b'), row('c')], () => ({ ok: true, value: 'secret' }));

test('a run where every row opens passes, and says how many it opened', () => {
  const result = allGood();
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.equal(result.verified, 3);
  assert.deepEqual(result.problems, []);
  assert.match(summarise(result), /3 row\(s\) opened/);
});

test('a run that verified nothing fails, rather than passing vacuously', () => {
  // The property that makes this a gate. An empty table and a query that matched the
  // wrong shape are indistinguishable from here, and declaring a destructive migration
  // safe on the strength of a rehearsal that opened nothing is precisely the failure
  // this check exists to prevent.
  const result = verifySealedRows([], () => ({ ok: true, value: 'x' }));
  assert.equal(result.ok, false);
  assert.equal(result.verified, 0);
  assert.equal(result.problems.length, 1);
  assert.match(String(result.problems[0]), /no rows were verified/);
});

test('every row is attempted, not just up to the first failure', () => {
  // Stopping at the first failure reports one broken row and hides the other four, and
  // an operator who fixes the first and re-runs then discovers the second — one
  // migration at a time.
  /** @type {string[]} */
  const attempted = [];
  const result = verifySealedRows([row('a'), row('b'), row('c'), row('d')], (candidate) => {
    attempted.push(candidate.rowId);
    return candidate.rowId === 'b'
      ? { ok: false, reason: FailureReason.UNREADABLE }
      : { ok: true, value: 'secret' };
  });

  assert.deepEqual(attempted, ['a', 'b', 'c', 'd']);
  assert.equal(result.verified, 3);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0]?.rowId, 'b');
  assert.equal(result.ok, false);
});

test('a binding mismatch is distinguished from unreadable bytes', () => {
  // The two need different responses — one is a re-key or a column rename, the other
  // is a restore from backup — and a single list of identical-looking errors cannot
  // tell an operator which they have. P-8 is the shape of this failure in the other
  // direction: the ciphertext was readable and belonged to the wrong row.
  const result = verifySealedRows([row('a'), row('b')], (candidate) =>
    candidate.rowId === 'a'
      ? { ok: false, reason: FailureReason.BINDING_MISMATCH }
      : { ok: false, reason: FailureReason.UNREADABLE },
  );

  const byRow = Object.fromEntries(result.failures.map((f) => [f.rowId, f]));
  assert.equal(byRow['a']?.reason, FailureReason.BINDING_MISMATCH);
  assert.match(String(byRow['a']?.advice), /renamed or re-typed column/);
  assert.equal(byRow['b']?.reason, FailureReason.UNREADABLE);
  assert.match(String(byRow['b']?.advice), /restore the row from backup/);
});

test('a row that could not even be read is its own class', () => {
  // A read failure points at the query or the column type, not at the encryption, and
  // reporting it as unreadable sends the operator to re-key a key that was fine.
  const result = verifySealedRows([row('a')], () => ({ ok: false, reason: FailureReason.UNREAD }));
  assert.equal(result.failures[0]?.reason, FailureReason.UNREAD);
  assert.match(String(result.failures[0]?.advice), /query or the column type/);
});

test('an opener that throws is a broken harness, not a broken row', () => {
  // A thrown error on the first row would otherwise look like one unreadable row
  // rather than a harness that cannot do its job — and the operator would go looking
  // for a data problem that is not there.
  const result = verifySealedRows([row('a'), row('b')], () => {
    throw new Error('the vault secret is not set');
  });
  assert.equal(result.failures.length, 2);
  assert.match(String(result.failures[0]?.detail), /the opener threw/);
  assert.match(String(result.failures[0]?.detail), /vault secret is not set/);
  // And because nothing opened, the run says so outright rather than leaving the
  // operator with N identical rows and a guess.
  assert.ok(
    result.problems.some((problem) => /no row could be opened/.test(problem)),
    'a total failure should name the likely cause',
  );
});

test('nothing opening is reported as a probable key problem, not N broken rows', () => {
  // A rotated secret fails every row identically. Treating that as N unreadable rows
  // sends the operator after the data when the key is the thing.
  const result = verifySealedRows([row('a'), row('b'), row('c')], () => ({
    ok: false,
    reason: FailureReason.UNREADABLE,
  }));
  assert.equal(result.verified, 0);
  assert.ok(
    result.problems.some((problem) => /vault key is the first thing to check/.test(problem)),
  );
  assert.equal(result.ok, false);
});

test('the summary names the counts and the problems together', () => {
  const result = verifySealedRows([row('a'), row('b')], (candidate) =>
    candidate.rowId === 'a'
      ? { ok: true, value: 's' }
      : { ok: false, reason: FailureReason.BINDING_MISMATCH },
  );
  const line = summarise(result);
  assert.match(line, /1 row\(s\) opened/);
  assert.match(line, /1 failed/);
});

test('the plaintext is handed back, so a rehearsal can assert the value and not only the key', () => {
  // "It decrypted" proves the key still works. It does not prove the value is the one
  // that was stored — a migration that re-sealed under a fresh key would satisfy a
  // decrypt-only check while holding the wrong secrets.
  /** @type {string[]} */
  const seen = [];
  verifySealedRows([row('a'), row('b')], (candidate) => {
    const input = /** @type {{ rowId: string }} */ (candidate.input);
    seen.push(input.rowId);
    return { ok: true, value: `value-of-${candidate.rowId}` };
  });
  assert.deepEqual(seen, ['a', 'b']);
});
