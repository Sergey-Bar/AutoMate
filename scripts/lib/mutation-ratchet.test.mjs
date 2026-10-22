import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  MUTATION_PACKAGES,
  evaluateMutation,
  loweredMutationFloors,
  mutationScore,
  parseMutationBaseline,
  recordScores,
} from './mutation-ratchet.mjs';

/** @param {string[]} statuses */
function reportWith(statuses) {
  return {
    schemaVersion: '2',
    files: {
      'src/a.ts': {
        language: 'typescript',
        source: '',
        mutants: statuses.map((status) => ({ status })),
      },
    },
  };
}

const BASELINE = {
  target: 75,
  packages: {
    'packages/auth': { score: 60, measuredOn: '2026-10-22' },
    'packages/reporting': { score: 80.5, measuredOn: '2026-10-22' },
  },
};

test('the score is detected over valid, and ignored / compile-error mutants are not valid', () => {
  const result = mutationScore(
    reportWith(['Killed', 'Timeout', 'Survived', 'NoCoverage', 'Ignored', 'CompileError']),
  );
  // 2 detected of 4 valid. Ignored and CompileError never counted either way.
  assert.equal(result.score, 50);
  assert.equal(result.survived, 1);
  assert.equal(result.noCoverage, 1);
});

test('a runtime error is not a kill and is not counted as a miss', () => {
  assert.equal(mutationScore(reportWith(['Killed', 'RuntimeError', 'Survived'])).score, 50);
});

test('the score is floored at two decimals, never rounded up past what was measured', () => {
  // 2/3 = 66.666...: rounding would record 66.67, which is above the measurement.
  assert.equal(mutationScore(reportWith(['Killed', 'Killed', 'Survived'])).score, 66.66);
});

test('a report with no valid mutant measures nothing and throws', () => {
  assert.throws(() => mutationScore(reportWith(['Ignored'])), /no valid mutant/);
  assert.throws(() => mutationScore({ files: {} }), /no valid mutant/);
  assert.throws(() => mutationScore(null), /not a mutation report/);
});

test('a well-formed baseline parses', () => {
  const parsed = parseMutationBaseline(JSON.stringify(BASELINE));
  assert.equal(parsed.ok, true);
});

test('a baseline fails closed on every way it can be unreadable', () => {
  for (const source of [
    null,
    '',
    '{not json',
    '[]',
    '{}',
    JSON.stringify({ target: 75, packages: {} }),
    JSON.stringify({
      target: 75,
      packages: { 'packages/auth': { score: 'high', measuredOn: 'x' } },
    }),
    JSON.stringify({ target: 75, packages: { 'packages/auth': { score: 0, measuredOn: 'x' } } }),
    JSON.stringify({ target: 75, packages: { 'packages/auth': { score: 101, measuredOn: 'x' } } }),
    JSON.stringify({ target: 75, packages: { 'packages/auth': { score: 50 } } }),
    JSON.stringify({ packages: { 'packages/auth': { score: 50, measuredOn: 'x' } } }),
  ]) {
    const parsed = parseMutationBaseline(source);
    assert.equal(parsed.ok, false, `accepted ${String(source)}`);
  }
});

test('a measured score at or above the floor passes', () => {
  const failures = evaluateMutation({
    baseline: BASELINE,
    measured: { 'packages/auth': 60, 'packages/reporting': 90 },
    expectedPackages: ['packages/auth', 'packages/reporting'],
  });
  assert.deepEqual(failures, []);
});

test('a lowered score is a finding naming both numbers', () => {
  const failures = evaluateMutation({
    baseline: BASELINE,
    measured: { 'packages/auth': 59.99, 'packages/reporting': 90 },
    expectedPackages: ['packages/auth', 'packages/reporting'],
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /packages\/auth: mutation score 59.99 < 60/);
});

test('a package with no measurement fails; it is never skipped', () => {
  const failures = evaluateMutation({
    baseline: BASELINE,
    measured: { 'packages/auth': 70 },
    expectedPackages: ['packages/auth', 'packages/reporting'],
  });
  assert.match(failures.join('\n'), /packages\/reporting: no mutation report/);
});

test('an expected package absent from the baseline fails until it is recorded deliberately', () => {
  const failures = evaluateMutation({
    baseline: BASELINE,
    measured: { 'packages/auth': 70, 'packages/reporting': 90, 'packages/new': 80 },
    expectedPackages: ['packages/auth', 'packages/reporting', 'packages/new'],
  });
  assert.match(failures.join('\n'), /packages\/new: has no entry in mutation-baseline.json/);
});

test('a baseline entry for a package nobody mutates fails', () => {
  const failures = evaluateMutation({
    baseline: BASELINE,
    measured: { 'packages/auth': 70 },
    expectedPackages: ['packages/auth'],
  });
  assert.match(
    failures.join('\n'),
    /packages\/reporting: names a package the mutation run does not cover/,
  );
});

test('a lowered recorded floor is a finding even when the measurement still clears it', () => {
  const lowered = {
    ...BASELINE,
    packages: { ...BASELINE.packages, 'packages/auth': { score: 10, measuredOn: '2026-10-22' } },
  };
  const findings = loweredMutationFloors(BASELINE, lowered);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /packages\/auth: floor lowered from 60 to 10/);
});

test('a removed floor and a lowered target are findings; no base is none', () => {
  assert.equal(loweredMutationFloors(null, BASELINE).length, 0);
  const removed = {
    ...BASELINE,
    packages: { 'packages/auth': BASELINE.packages['packages/auth'] },
  };
  assert.match(loweredMutationFloors(BASELINE, removed).join(), /packages\/reporting: removed/);
  assert.match(
    loweredMutationFloors(BASELINE, { ...BASELINE, target: 50 }).join(),
    /target lowered from 75 to 50/,
  );
});

test('recording raises existing floors, adds new ones, and never lowers', () => {
  const next = recordScores(
    BASELINE,
    { 'packages/auth': 40, 'packages/reporting': 91.25, 'packages/runner-sdk': 55 },
    '2026-10-23',
  );
  assert.equal(next.packages['packages/auth'].score, 60);
  assert.equal(next.packages['packages/reporting'].score, 91.25);
  assert.equal(next.packages['packages/reporting'].measuredOn, '2026-10-23');
  assert.equal(next.packages['packages/runner-sdk'].score, 55);
  // The input is not mutated.
  assert.equal(BASELINE.packages['packages/reporting'].score, 80.5);
});

test('the five core packages are the ones the roadmap names', () => {
  assert.deepEqual([...MUTATION_PACKAGES].sort(), [
    'packages/auth',
    'packages/orchestration',
    'packages/reporting',
    'packages/runner-sdk',
    'packages/shared-contracts',
  ]);
});

test('the committed baseline is well-formed and covers exactly the five packages', () => {
  // The fast, blocking half of the mutation gate: it needs no Stryker run. A baseline
  // that is missing, truncated, or silently drops a package fails here on every PR.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const source = readFileSync(path.join(root, 'docs/quality/mutation-baseline.json'), 'utf8');
  const parsed = parseMutationBaseline(source);
  assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.reason);
  if (!parsed.ok) return;
  assert.deepEqual(Object.keys(parsed.baseline.packages).sort(), [...MUTATION_PACKAGES].sort());
});
