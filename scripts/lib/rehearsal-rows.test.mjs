import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SEALED_ROWS_SQL, parseSealedRows } from './rehearsal-rows.mjs';

/**
 * **Why this module exists.**
 *
 * `scripts/migration-rehearse.mjs` used to read sealed rows with
 * `psql --tuples-only --no-align --field-separator=` — an *empty* field separator — and then
 * `line.split('|')`. The separator was empty, so psql emitted every column with nothing
 * between them, and the split found no delimiter at all. Every field of every row came back
 * `undefined` except `rowId`, which was the entire line:
 *
 *     rowId: "7d995904-105a-4348-9a6f-b12fc9110b20ws-rehearsaljiraG3ey_H5zz…100000"
 *
 * The first real run of the command — 2026-10-04, RF-5 — therefore reported three rows found
 * and **zero opened**, on a vault that was entirely intact, and offered its own diagnosis:
 * *"the vault key is the first thing to check."* The guard that a run which verified nothing
 * must fail did its job; the **diagnosis** was wrong, and a healthy migration would have been
 * reported as having destroyed the vault. That is the more dangerous of the two failures: a
 * gate that cries wolf is a gate whose red nobody reads, which is the `SEM-2` shape this
 * repository already has a row about.
 *
 * **The fix is to stop inventing a delimiter.** Postgres can encode the row itself.
 * `json_build_object` escapes whatever is in the columns — a pipe, a newline, a quote — and
 * produces exactly one line per row, so there is nothing to get wrong. The parser below is a
 * pure function over `psql`'s stdout because the sequencing in `rehearsal-run.mjs` is already
 * tested this way and the part that was broken was the part nobody could test.
 */

describe('the sealed-row reader the rehearsal uses', () => {
  it('asks Postgres for JSON rather than inventing a field separator', () => {
    // The assertion is on the *absence* of a delimiter scheme, which is the whole fix.
    assert.equal(
      SEALED_ROWS_SQL.includes('|'),
      false,
      'the SQL must not rely on `|` appearing in its output: a connector name may contain one.',
    );
    assert.match(SEALED_ROWS_SQL, /json_build_object/u, 'the row must be encoded by the server');
    assert.match(SEALED_ROWS_SQL, /FROM vault_entries/u);
    assert.match(SEALED_ROWS_SQL, /ORDER BY id/u, 'the order is the reporting order too');
  });

  it('parses every field of a row', () => {
    const line = JSON.stringify({
      id: 'c7349cfb-3160-49fc-b294-8acb29fdfcdb',
      workspaceId: 'ws-rehearsal',
      name: 'github',
      ciphertext: 'G3ey_H5zz5nl-nxurHvd-p7yJdiqsYRU6IRmxWT0PrOGTJG9cP3n9OrcwaSXyyduLZh',
      iv: 'aXY',
      authTag: 'tag==',
      salt: 'c2FsdA==',
      iterations: 100000,
    });

    const [row] = parseSealedRows(`${line}\n`);

    assert.equal(row?.rowId, 'c7349cfb-3160-49fc-b294-8acb29fdfcdb');
    assert.deepEqual(row?.input, {
      envelope: {
        // Stated rather than read, for the reason `migration-rehearse.mjs` gives: there is
        // no `version` column, and everything in `vault_entries` is a bound envelope.
        version: 2,
        algorithm: 'aes-256-gcm',
        keyVersion: 1,
        ciphertext: 'G3ey_H5zz5nl-nxurHvd-p7yJdiqsYRU6IRmxWT0PrOGTJG9cP3n9OrcwaSXyyduLZh',
        iv: 'aXY',
        tag: 'tag==',
        salt: 'c2FsdA==',
      },
      binding: {
        entryId: 'c7349cfb-3160-49fc-b294-8acb29fdfcdb',
        workspaceId: 'ws-rehearsal',
        name: 'github',
      },
    });
  });

  it('reads the iterations column without smuggling it into the envelope', () => {
    // `VaultEnvelope` has no `iterations` field — `keyFor` derives at a hardcoded cost
    // rather than at whatever the row records — and the old reader attached one anyway,
    // behind a cast. The column is still selected and still checked, which is what makes a
    // migration that narrows it visible here instead of at the first production read.
    const line = JSON.stringify({
      id: 'row-0',
      workspaceId: 'ws-1',
      name: 'github',
      ciphertext: 'Y2lwaGVy',
      iv: 'aXY',
      authTag: 'dGFn',
      salt: 'c2FsdA==',
      iterations: 100000,
    });

    const [row] = parseSealedRows(`${line}\n`);

    assert.equal('iterations' in (row?.input.envelope ?? {}), false);
    // And a row whose `iterations` is not a number is refused rather than coerced to NaN.
    assert.throws(
      () => parseSealedRows(`${line.replace('100000', '"many"')}\n`),
      /iterations/u,
      'a non-numeric iterations column must be reported, not coerced',
    );
  });

  it('survives a connector name containing the delimiter the old reader split on', () => {
    // The regression, stated as a case. `|` is legal in a connector name and appears in
    // base64url-adjacent text people do put in names; the old reader would have split this
    // row into the wrong columns and reported a binding mismatch on a healthy vault.
    const line = JSON.stringify({
      id: 'row-1',
      workspaceId: 'ws-1',
      name: 'github|mirror',
      ciphertext: 'Y2lwaGVy',
      iv: 'aXY',
      authTag: 'dGFn',
      salt: 'c2FsdA==',
      iterations: 100000,
    });

    const [row] = parseSealedRows(`${line}\n`);

    assert.equal(row?.input.binding.name, 'github|mirror');
    assert.equal(row?.input.envelope.ciphertext, 'Y2lwaGVy');
  });

  it('survives a name with a newline in it, which no line-based delimiter could', () => {
    const line = JSON.stringify({
      id: 'row-2',
      workspaceId: 'ws-1',
      name: 'two\nlines',
      ciphertext: 'Y2lwaGVy',
      iv: 'aXY',
      authTag: 'dGFn',
      salt: 'c2FsdA==',
      iterations: 100000,
    });

    // JSON escapes the newline, so this stays one line — which is the property that makes
    // the line-based reader sound at all, and the reason the encoding is the server's job.
    assert.equal(line.includes('\n'), false);
    assert.equal(parseSealedRows(`${line}\n`)[0]?.input.binding.name, 'two\nlines');
  });

  it('ignores blank lines rather than reporting them as rows', () => {
    assert.deepEqual(parseSealedRows('\n\n'), []);
  });

  it('reports which line it could not read, because a silently dropped row is a rehearsal that verified nothing', () => {
    assert.throws(
      () => parseSealedRows('{"id":"row-3"}\n'),
      /row-3|missing/u,
      'a line missing required fields must throw rather than produce a row with undefined in it',
    );
  });
});
