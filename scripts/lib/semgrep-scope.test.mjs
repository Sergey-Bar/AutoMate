import assert from 'node:assert/strict';
import test from 'node:test';
import { SEMGREP_SCOPE, semgrepDirectories } from './semgrep-scope.mjs';

test('the scope still turns findings into a non-zero exit', () => {
  // Without `--error`, semgrep prints findings and exits 0, and the gate's
  // `status !== 0` check reports a clean scan over a scan that found things.
  assert.ok(SEMGREP_SCOPE.includes('--error'));
});

test('a flag argument is not read as a directory', () => {
  // `--exclude **/dist` is one flag and one value. Reading the value as a scanned
  // path would make the config check believe `dist` is covered, and the check is
  // the only thing standing between a new package and an unscanned security gate.
  const directories = semgrepDirectories();
  assert.ok(!directories.includes('**/dist'));
  assert.ok(!directories.includes('.semgrep.yml'));
  assert.ok(!directories.includes('scan'));
  assert.ok(!directories.some((entry) => entry.startsWith('--')));
});

test('every application is named explicitly', () => {
  // `apps/api/src` alone was the scope for as long as the ruleset existed, so the
  // other three applications — the ones most reachable from a browser or a
  // subprocess — were never examined.
  for (const app of ['api', 'web', 'runner', 'worker']) {
    assert.ok(
      SEMGREP_SCOPE.includes(`apps/${app}/src`),
      `apps/${app}/src must be in the semgrep scope`,
    );
  }
});

test('test files are scanned', () => {
  // A blanket test exclusion is how a real secret in a fixture goes unnoticed.
  assert.ok(!SEMGREP_SCOPE.some((entry) => entry.includes('*.test')));
  assert.ok(SEMGREP_SCOPE.includes('e2e'));
  assert.ok(SEMGREP_SCOPE.includes('tests'));
});
