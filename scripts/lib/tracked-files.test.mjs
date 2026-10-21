import assert from 'node:assert/strict';
import test from 'node:test';
import { trackedFiles } from './tracked-files.mjs';

/**
 * `unify:preflight` read the git index through a `try` whose `catch` returned `[]`, so
 * a host where git could not run — no git binary, no `.git`, a `safe.directory` refusal —
 * produced an empty file list, and "generated paths are untracked" passed over it. The
 * first step of `pnpm verify` then reported clean having checked nothing.
 */

test('a git that cannot run is a failure the caller can see, not an empty index', () => {
  const result = trackedFiles(() => {
    throw new Error('spawn git ENOENT');
  });
  assert.equal(result.files.length, 0);
  assert.match(result.problem ?? '', /ENOENT/);
});

test('an index with no files is a failure too, because a repository always has some', () => {
  const result = trackedFiles(() => '\n');
  assert.match(result.problem ?? '', /no files/);
});

test('a readable index is returned line by line, with no problem', () => {
  const result = trackedFiles(() => 'package.json\r\nREADME.md\n');
  assert.deepEqual(result, { files: ['package.json', 'README.md'], problem: null });
});
