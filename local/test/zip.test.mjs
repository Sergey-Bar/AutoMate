import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { listZip, readEntry } from '../src/zip.mjs';
import { buildZip } from './zip-builder.mjs';

const text = (bytes) => Buffer.from(bytes).toString('utf8');
const first = (zip, overrides) => {
  const listed = listZip(zip, overrides);
  assert.equal(listed.ok, true, JSON.stringify(listed));
  return listed.entries[0];
};

test('stored and deflated entries come back byte for byte', () => {
  const zip = buildZip([
    { name: 'a.xml', data: '<testsuite/>', method: 8 },
    { name: 'b.txt', data: 'plain', method: 0 },
    { name: 'dir/', data: '', method: 0 },
    { name: 'Ünï/ü.xml', data: 'x' },
  ]);
  const listed = listZip(zip);
  assert.equal(listed.ok, true);
  assert.deepEqual(
    listed.entries.map((e) => e.name),
    ['a.xml', 'b.txt', 'dir/', 'Ünï/ü.xml'],
  );
  assert.equal(listed.entries[2].directory, true);
  assert.equal(text(readEntry(zip, listed.entries[0]).bytes), '<testsuite/>');
  assert.equal(text(readEntry(zip, listed.entries[1]).bytes), 'plain');
  assert.equal(text(readEntry(zip, listed.entries[3]).bytes), 'x');
});

test('a trailing comment does not hide the archive', () => {
  const zip = buildZip([{ name: 'a.xml', data: 'x' }], { comment: 'PK\u0005\u0006 not really' });
  assert.equal(listZip(zip).ok, true);
});

test('things that are not archives, or not whole ones, are refused as a whole', () => {
  assert.deepEqual(listZip(Buffer.from('')), { ok: false, reason: 'not-a-zip' });
  assert.deepEqual(listZip(Buffer.from('this is plainly not a zip archive at all')), {
    ok: false,
    reason: 'not-a-zip',
  });
  const zip = buildZip([{ name: 'a.xml', data: 'x' }]);
  assert.equal(listZip(zip.subarray(0, zip.length - 10)).ok, false, 'a truncated archive');
  const lying = buildZip([{ name: 'a.xml', data: 'x' }], { count: 9 });
  assert.equal(listZip(lying).ok, false, 'a count that does not match the directory');
  assert.deepEqual(
    listZip(
      buildZip([
        { name: 'a', data: 'x' },
        { name: 'b', data: 'y' },
        { name: 'c', data: 'z' },
      ]),
      { maxEntries: 2 },
    ),
    { ok: false, reason: 'too-many-entries' },
  );
  const multi = Buffer.from(zip);
  multi.writeUInt16LE(1, multi.length - 22 + 4);
  assert.deepEqual(listZip(multi), { ok: false, reason: 'multi-disk' });
});

test('an entry that cannot be trusted is refused on its own, and the rest of the archive still reads', () => {
  const good = Buffer.from('good');
  const zip = buildZip([
    { name: 'enc.xml', data: 'x', flags: 0x801 },
    { name: 'bzip.xml', data: 'x', method: 12, raw: Buffer.from('x') },
    { name: 'crc.xml', data: 'x', crc: 12345 },
    { name: 'short.xml', data: 'xxxx', size: 10 },
    { name: 'big.xml', data: 'x', size: 999_999_999 },
    { name: 'good.xml', data: good },
  ]);
  const listed = listZip(zip, { maxEntryBytes: 1000 });
  const reasons = Object.fromEntries(
    listed.entries.map((e) => [e.name, readEntry(zip, e, { maxEntryBytes: 1000 })]),
  );
  assert.equal(reasons['enc.xml'].reason, 'encrypted');
  assert.equal(reasons['bzip.xml'].reason, 'unsupported-method');
  assert.equal(reasons['crc.xml'].reason, 'crc-mismatch');
  assert.equal(reasons['short.xml'].reason, 'size-mismatch');
  assert.equal(reasons['big.xml'].reason, 'entry-too-large');
  assert.equal(reasons['good.xml'].ok, true);
});

test('an entry that inflates past what it declared is stopped, not expanded', () => {
  const bomb = Buffer.alloc(50 * 1024 * 1024, 0x41);
  const raw = deflateRawSync(bomb);
  assert.ok(raw.length < 100_000, 'it compresses extremely well');
  const zip = buildZip([
    { name: 'bomb.xml', data: 'tiny', method: 8, raw, size: 4, compressedSize: raw.length },
  ]);
  const entry = first(zip);
  const started = Date.now();
  const result = readEntry(zip, entry);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'inflates-past-declared-size');
  assert.ok(Date.now() - started < 2000, 'and without doing the work');
});

test('an entry whose data would lie outside the archive is refused', () => {
  const zip = buildZip([{ name: 'a.xml', data: 'x', compressedSize: 5_000_000 }]);
  assert.equal(readEntry(zip, first(zip)).reason, 'data-outside-archive');
  const badOffset = buildZip([{ name: 'a.xml', data: 'x', localOffset: 100_000 }]);
  assert.equal(readEntry(badOffset, first(badOffset)).reason, 'bad-local-header');
  const corrupt = buildZip([
    {
      name: 'a.xml',
      data: 'x',
      method: 8,
      raw: Buffer.from([1, 2, 3, 4, 5]),
      compressedSize: 5,
      crc: 0,
    },
  ]);
  assert.equal(readEntry(corrupt, first(corrupt)).ok, false);
});

test('ZIP64 markers are refused rather than misread', () => {
  const zip = buildZip([{ name: 'a.xml', data: 'x', size: 0xffffffff }]);
  assert.equal(readEntry(zip, first(zip)).reason, 'zip64-not-supported');
});

test('reading an archive writes nothing to disk, whatever the entry names say', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'automate-zip-'));
  const before = process.cwd();
  try {
    process.chdir(directory);
    const zip = buildZip([
      { name: '../../escape.xml', data: 'x' },
      { name: '/abs/escape.xml', data: 'x' },
      { name: 'C:\\win\\escape.xml', data: 'x' },
      { name: 'a/../../escape.xml', data: 'x' },
    ]);
    const listed = listZip(zip);
    for (const entry of listed.entries) assert.equal(readEntry(zip, entry).ok, true);
    assert.deepEqual(readdirSync(directory), [], 'no file was created');
    assert.deepEqual(
      readdirSync(path.dirname(directory)).filter((n) => n === 'escape.xml'),
      [],
    );
    writeFileSync(path.join(directory, 'marker'), '');
  } finally {
    process.chdir(before);
    try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      // a handle can outlive the test on Windows
    }
  }
});

test('the module cannot write to the filesystem or reach the network', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    path.resolve(import.meta.dirname, '..', 'src', 'zip.mjs'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');
  const imports = [...source.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['node:zlib']);
});
