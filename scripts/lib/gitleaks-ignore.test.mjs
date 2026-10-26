import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gitleaksIgnoreProblems } from './gitleaks-ignore.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMMIT = '678112773ee7e6814f02538f79ef1a5e6b36f2ac';

test('accepts comments, blank lines and exact commit-scoped fingerprints', () => {
  const source = ['# why', '', `${COMMIT}:packages/x/src/a.test.ts:generic-api-key:413`].join('\n');
  assert.deepEqual(gitleaksIgnoreProblems(source), []);
});

test('refuses a fingerprint without a commit, which would exempt the line in every commit', () => {
  const problems = gitleaksIgnoreProblems('packages/x/src/a.test.ts:generic-api-key:413');
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /not an exact fingerprint/u);
});

test('refuses an abbreviated commit, a missing line and a glob', () => {
  for (const entry of [
    '6781127:packages/x/src/a.test.ts:generic-api-key:413',
    `${COMMIT}:packages/x/src/a.test.ts:generic-api-key`,
    `${COMMIT}:packages/**:generic-api-key:1`,
    `${COMMIT}:packages/x/src/a.test.ts:*:1`,
  ]) {
    assert.equal(gitleaksIgnoreProblems(entry).length, 1, entry);
  }
});

test("the repository's own .gitleaksignore passes", () => {
  const source = readFileSync(path.join(root, '.gitleaksignore'), 'utf8');
  assert.deepEqual(gitleaksIgnoreProblems(source), []);
});
