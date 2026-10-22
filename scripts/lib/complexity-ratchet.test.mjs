import assert from 'node:assert/strict';
import test from 'node:test';
import { countByFile, grownFiles, worsenedTo } from './complexity-ratchet.mjs';

/** @param {string} file @param {number} complexity */
const row = (file, complexity) => ({ file, line: 1, complexity });

test('counts offenders per file, not distinct files', () => {
  const counts = countByFile([row('a.ts', 20), row('a.ts', 17), row('b.ts', 16)]);
  assert.equal(counts.get('a.ts'), 2);
  assert.equal(counts.get('b.ts'), 1);
});

test('an equal or smaller tree has not grown', () => {
  const recorded = [row('a.ts', 20), row('b.ts', 16)];
  assert.deepEqual(grownFiles(recorded, recorded), []);
  assert.deepEqual(grownFiles([row('a.ts', 18)], recorded), []);
  assert.deepEqual(grownFiles([], recorded), []);
});

test('a second offender in an already-recorded file is growth', () => {
  // The case the file-count comparison passed: one file before, one file after.
  const recorded = [row('a.ts', 20)];
  assert.deepEqual(grownFiles([row('a.ts', 20), row('a.ts', 16)], recorded), [
    { file: 'a.ts', recorded: 1, measured: 2 },
  ]);
});

test('one file fixed and another broken is growth, not a wash', () => {
  // Also passed before: one file out, one file in, so the sizes of the two maps were equal.
  const recorded = [row('a.ts', 20)];
  assert.deepEqual(grownFiles([row('b.ts', 16)], recorded), [
    { file: 'b.ts', recorded: 0, measured: 1 },
  ]);
});

test('a file the baseline does not mention may hold no offender', () => {
  assert.deepEqual(grownFiles([row('new.ts', 16)], []), [
    { file: 'new.ts', recorded: 0, measured: 1 },
  ]);
});

test('the worst offender getting worse is reported even when no count changed', () => {
  assert.equal(worsenedTo([row('a.ts', 40)], 20), 40);
  assert.equal(worsenedTo([row('a.ts', 20)], 20), null);
  assert.equal(worsenedTo([row('a.ts', 19)], 20), null);
  assert.equal(worsenedTo([], 20), null);
});

test('with no recorded worst there is nothing to compare against', () => {
  assert.equal(worsenedTo([row('a.ts', 40)], undefined), null);
});

test('an offender whose complexity could not be parsed counts as present but not worse', () => {
  assert.equal(worsenedTo([{ file: 'a.ts', complexity: null }], 0), null);
  assert.equal(grownFiles([{ file: 'a.ts', complexity: null }], []).length, 1);
});
