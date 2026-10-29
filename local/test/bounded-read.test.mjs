import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readFileBounded, readFileBoundedSync } from '../src/bounded-read.mjs';

function scratch() {
  return mkdtempSync(path.join(tmpdir(), 'automate-bounded-read-'));
}

/**
 * The directory case differs by platform: Linux opens a directory and the handle reports it,
 * Windows refuses the open with EISDIR. Both must keep a directory from being read.
 *
 * @param {() => unknown} read
 */
function assertDirectoryRefused(read) {
  try {
    assert.deepEqual(read(), { status: 'not-a-file' });
  } catch (error) {
    assert.equal(/** @type {{ code?: string }} */ (error).code, 'EISDIR');
  }
}

for (const [name, read] of /** @type {const} */ ([
  ['readFileBounded', readFileBounded],
  ['readFileBoundedSync', readFileBoundedSync],
])) {
  test(`${name} returns the whole file and its stats when it is within the limit`, async () => {
    const dir = scratch();
    try {
      const file = path.join(dir, 'report.xml');
      writeFileSync(file, '<testsuite/>');
      const result = await read(file, 64);
      assert.equal(result.status, 'ok');
      if (result.status !== 'ok') return;
      assert.equal(Buffer.from(result.bytes).toString('utf8'), '<testsuite/>');
      assert.equal(result.info.size, 12);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test(`${name} reads a file exactly at the limit, and refuses one byte over`, async () => {
    const dir = scratch();
    try {
      const file = path.join(dir, 'out.raw');
      writeFileSync(file, 'x'.repeat(16));
      assert.equal((await read(file, 16)).status, 'ok');
      const over = await read(file, 15);
      assert.equal(over.status, 'too-large');
      if (over.status === 'too-large') assert.equal(over.info.size, 16);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test(`${name} reads an empty file as empty`, async () => {
    const dir = scratch();
    try {
      const file = path.join(dir, 'empty');
      writeFileSync(file, '');
      const result = await read(file, 0);
      assert.equal(result.status, 'ok');
      if (result.status === 'ok') assert.equal(result.bytes.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test(`${name} never reads a directory`, async () => {
    const dir = scratch();
    try {
      if (name === 'readFileBoundedSync') {
        assertDirectoryRefused(() => readFileBoundedSync(dir, 1024));
      } else {
        const outcome = await readFileBounded(dir, 1024).catch((error) => ({ error }));
        if ('error' in outcome) {
          assert.equal(/** @type {{ code?: string }} */ (outcome.error).code, 'EISDIR');
        } else {
          assert.deepEqual(outcome, { status: 'not-a-file' });
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test(`${name} leaves a missing file to the caller as ENOENT`, async () => {
    const dir = scratch();
    try {
      await assert.rejects(async () => read(path.join(dir, 'absent'), 1024), { code: 'ENOENT' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
