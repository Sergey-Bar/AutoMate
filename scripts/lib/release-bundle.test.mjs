import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BUNDLE_FILES, buildBundle, readZip, sha256sums, writeZip } from './release-bundle.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

test('a zip round-trips names, bytes and unix modes', () => {
  const zip = writeZip([
    { name: 'a/run.sh', data: Buffer.from('#!/bin/sh\necho hi\n'), mode: 0o755 },
    { name: 'a/notes.md', data: Buffer.from('x'.repeat(5000)), mode: 0o644 },
  ]);
  const entries = readZip(zip);
  assert.deepEqual(
    entries.map((entry) => [entry.name, entry.mode, entry.data.toString()]),
    [
      ['a/run.sh', 0o755, '#!/bin/sh\necho hi\n'],
      ['a/notes.md', 0o644, 'x'.repeat(5000)],
    ],
  );
});

test('SHA256SUMS is the sha256sum format', () => {
  const data = Buffer.from('abc');
  const digest = createHash('sha256').update(data).digest('hex');
  assert.equal(sha256sums([{ name: 'f.zip', data }]), `${digest}  f.zip\n`);
});

test('the bundle holds exactly the release files, start.sh executable, version stamped', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'automate-bundle-'));
  try {
    const { zipPath, sumsPath, folder } = buildBundle({ root: REPO_ROOT, version: '2.5.0', out });
    assert.equal(path.basename(zipPath), 'automate-2.5.0.zip');
    assert.equal(folder, 'automate-2.5.0');
    const zip = readFileSync(zipPath);
    const entries = readZip(zip);
    assert.deepEqual(
      entries.map((entry) => entry.name).sort(),
      BUNDLE_FILES.map((name) => `automate-2.5.0/${name}`).sort(),
    );
    /** @param {string} name */
    const entry = (name) =>
      entries.find((candidate) => candidate.name === `automate-2.5.0/${name}`);
    assert.equal(entry('start.sh')?.mode, 0o755);
    assert.equal(entry('start.ps1')?.mode, 0o644);
    const compose = entry('compose.yml')?.data.toString() ?? '';
    assert.match(compose, /automate-api:\$\{AUTOMATE_VERSION:-2\.5\.0\}/);
    assert.doesNotMatch(compose, /^\s+build:/m);
    assert.match(entry('QUICKSTART.md')?.data.toString() ?? '', /Automate 2\.5\.0/);
    assert.doesNotMatch(entry('QUICKSTART.md')?.data.toString() ?? '', /\{\{VERSION\}\}/);
    assert.match(entry('LICENSE')?.data.toString() ?? '', /^MIT License/);
    // Windows files keep CRLF inside the zip, whatever the checkout did.
    assert.match(entry('start.cmd')?.data.toString() ?? '', /\r\n/);
    assert.doesNotMatch(entry('start.sh')?.data.toString() ?? '', /\r/);
    const digest = createHash('sha256').update(zip).digest('hex');
    assert.equal(readFileSync(sumsPath, 'utf8'), `${digest}  automate-2.5.0.zip\n`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
