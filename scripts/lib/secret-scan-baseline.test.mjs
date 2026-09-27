import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyFor, parseBaseline, partitionByBaseline } from './secret-scan-baseline.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const known = new Map([
  [
    keyFor('old-compose.yml', 'connection string with inline password'),
    {
      file: 'old-compose.yml',
      kind: 'connection string with inline password',
      why: 'a localhost compose password, rewritten',
    },
  ],
]);

test('a known finding is not a new finding', () => {
  const { newFindings } = partitionByBaseline(
    [{ file: 'old-compose.yml', hits: ['connection string with inline password'] }],
    known,
  );
  assert.deepEqual(newFindings, []);
});

test('an unknown finding in a known file is still new', () => {
  // Keyed on the pair, not the file: a different *shape* in a file that already has
  // an exception is a different claim and has not been judged.
  const { newFindings } = partitionByBaseline(
    [{ file: 'old-compose.yml', hits: ['aws access key id'] }],
    known,
  );
  assert.deepEqual(newFindings, [{ file: 'old-compose.yml', hits: ['aws access key id'] }]);
});

test('an unknown finding in an unknown file is new', () => {
  const { newFindings } = partitionByBaseline(
    [{ file: 'src/config.ts', hits: ['stripe live key'] }],
    known,
  );
  assert.equal(newFindings.length, 1);
});

test('a file with one known and one new finding keeps only the new one', () => {
  const { newFindings } = partitionByBaseline(
    [
      {
        file: 'old-compose.yml',
        hits: ['connection string with inline password', 'private key block'],
      },
    ],
    known,
  );
  assert.deepEqual(newFindings, [{ file: 'old-compose.yml', hits: ['private key block'] }]);
});

test('a baseline entry that no longer occurs is reported as stale', () => {
  // Without this, the file can only grow — and a baseline that only grows is a
  // blanket exemption that has learned to write a reason next to itself.
  const { stale } = partitionByBaseline([], known);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].file, 'old-compose.yml');
});

test('an entry that still occurs is not stale', () => {
  const { stale } = partitionByBaseline(
    [{ file: 'old-compose.yml', hits: ['connection string with inline password'] }],
    known,
  );
  assert.deepEqual(stale, []);
});

test('a baseline row with no reason is dropped, so it fails the scan instead', () => {
  const parsed = parseBaseline({
    findings: [{ file: 'a.ts', kind: 'aws access key id', why: '   ' }],
  });
  assert.equal(parsed.size, 0);
});

test('a baseline row missing a field is dropped', () => {
  assert.equal(parseBaseline({ findings: [{ file: 'a.ts', kind: 'x' }] }).size, 0);
  assert.equal(parseBaseline({ findings: ['nonsense'] }).size, 0);
  assert.equal(parseBaseline({ findings: [null] }).size, 0);
});

test('a document with no findings array yields nothing rather than throwing', () => {
  assert.equal(parseBaseline({}).size, 0);
  assert.equal(parseBaseline(null).size, 0);
  assert.equal(parseBaseline('nonsense').size, 0);
});

test('a row with a real reason is honoured', () => {
  const parsed = parseBaseline({
    findings: [{ file: 'a.ts', kind: 'x', why: 'a fixture' }],
  });
  assert.equal(parsed.size, 1);
  assert.equal(parsed.get(keyFor('a.ts', 'x'))?.why, 'a fixture');
});

test('the committed baseline parses, and every row carries a reason', () => {
  const document = JSON.parse(
    readFileSync(path.join(root, 'scripts', 'secret-scan-baseline.json'), 'utf8'),
  );
  const rows = Array.isArray(document.findings) ? document.findings : [];
  assert.ok(
    rows.length > 0,
    'the committed baseline is empty, so the history scan blocks on history',
  );
  for (const row of rows) {
    assert.equal(
      parseBaseline({ findings: [row] }).size,
      1,
      `${row.file} / ${row.kind} is dropped by the parser, so it fails the scan instead`,
    );
  }
  // And the parsed size matches the raw size: no row is silently discarded.
  assert.equal(parseBaseline(document).size, rows.length);
});
