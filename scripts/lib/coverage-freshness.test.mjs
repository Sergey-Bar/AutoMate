import assert from 'node:assert/strict';
import test from 'node:test';
import { hashContent, hashInputs, staleCoverageFinding } from './coverage-freshness.mjs';

const files = [
  { path: 'src/a.ts', hash: hashContent('a') },
  { path: 'vitest.config.ts', hash: hashContent('config') },
];

test('the input hash depends on the set of files, not the order they were found in', () => {
  assert.equal(hashInputs(files), hashInputs([...files].reverse()));
  // A directory walk returns a different order on Windows and Linux. If the hash
  // depended on it, the same commit would stamp differently on two machines and
  // the ratchet would fail for a tree nobody changed.
});

test('the input hash changes when a file content changes, and when one is added', () => {
  const edited = [{ path: 'src/a.ts', hash: hashContent('a-edited') }, files[1]];
  assert.notEqual(hashInputs(files), hashInputs(edited));
  assert.notEqual(hashInputs(files), hashInputs([...files, { path: 'src/b.ts', hash: 'x' }]));
  assert.notEqual(hashInputs(files), hashInputs([files[0]]));
});

test('a summary describing the current code is fresh', () => {
  assert.equal(
    staleCoverageFinding({
      relativePath: 'packages/ui',
      summaryPath: 'packages/ui/coverage/coverage-summary.json',
      recordedHash: 'abc',
      currentHash: 'abc',
      changedInputs: [],
    }),
    null,
  );
});

test('a summary describing earlier code is a finding that names what changed', () => {
  const finding = staleCoverageFinding({
    relativePath: 'packages/ui',
    summaryPath: 'packages/ui/coverage/coverage-summary.json',
    recordedHash: 'abc',
    currentHash: 'def',
    changedInputs: ['src/a.ts'],
  });
  assert.ok(finding !== null);
  assert.match(finding, /produced by different code/);
  assert.match(finding, /src\/a\.ts/);
  assert.match(finding, /--coverage/, 'the finding has to say what to do about it');
});

test('a file rewritten with identical content is not a change', () => {
  // The reason this check is content-based. An mtime comparison failed on this
  // case within the hour of being written, because an editor save or a formatter
  // pass moves the timestamp and changes nothing.
  const before = hashInputs(files);
  const after = hashInputs(files.map((file) => ({ ...file })));
  assert.equal(before, after);
  assert.equal(
    staleCoverageFinding({
      relativePath: 'packages/ui',
      summaryPath: 'packages/ui/coverage/coverage-summary.json',
      recordedHash: before,
      currentHash: after,
      changedInputs: [],
    }),
    null,
  );
});

test('a summary with no stamp is unattributable, which is a finding', () => {
  const finding = staleCoverageFinding({
    relativePath: 'packages/ui',
    summaryPath: 'packages/ui/coverage/coverage-summary.json',
    recordedHash: null,
    currentHash: 'abc',
    changedInputs: [],
  });
  assert.ok(finding !== null);
  assert.match(finding, /no coverage provenance/);
});

test('a package whose inputs cannot be hashed is a finding, not a pass', () => {
  // A gate that cannot check has not passed. Reporting null here would be exactly
  // the silent skip this whole mechanism exists to prevent.
  const finding = staleCoverageFinding({
    relativePath: 'packages/ui',
    summaryPath: 'packages/ui/coverage/coverage-summary.json',
    recordedHash: 'abc',
    currentHash: null,
    changedInputs: [],
  });
  assert.ok(finding !== null);
  assert.match(finding, /cannot hash/);
});

test('a change to the coverage policy alone is reported as such', () => {
  // `vitest.config.ts` is an input precisely because changing what is measured
  // invalidates the numbers, and the per-file diff is empty when only the
  // aggregate moved.
  const finding = staleCoverageFinding({
    relativePath: 'packages/ui',
    summaryPath: 'packages/ui/coverage/coverage-summary.json',
    recordedHash: 'abc',
    currentHash: 'def',
    changedInputs: [],
  });
  assert.ok(finding !== null);
  assert.match(finding, /shared coverage policy changed/);
});

test('a long list of changed files is truncated, not dumped', () => {
  const changedInputs = Array.from({ length: 9 }, (_, index) => `src/f${index}.ts`);
  const finding = staleCoverageFinding({
    relativePath: 'packages/ui',
    summaryPath: 'packages/ui/coverage/coverage-summary.json',
    recordedHash: 'abc',
    currentHash: 'def',
    changedInputs,
  });
  assert.ok(finding !== null);
  assert.match(finding, /and 4 more/);
  assert.doesNotMatch(finding, /f8\.ts/);
});
