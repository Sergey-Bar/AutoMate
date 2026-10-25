import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { duplicatedWork, expandScript, workUnits } from './gate-duplication.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/** @returns {Record<string, string>} */
function rootScripts() {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).scripts;
}

test('nested root scripts are inlined, builtins and filtered runs stay leaves', () => {
  const scripts = {
    all: 'pnpm a && pnpm audit --audit-level=high && pnpm --filter x test',
    a: 'pnpm b && eslint .',
    b: 'tsc -p .',
  };
  assert.deepEqual(expandScript('all', scripts), [
    'tsc -p .',
    'eslint .',
    'pnpm audit --audit-level=high',
    'pnpm --filter x test',
  ]);
});

test('a script cycle is refused rather than expanded for ever', () => {
  assert.throws(() => expandScript('a', { a: 'pnpm b', b: 'pnpm a' }), /script cycle/);
});

test('package test runs are recognised in all three spellings', () => {
  assert.deepEqual(workUnits('turbo run test', REPO_ROOT), ['package-test:*']);
  assert.deepEqual(workUnits('turbo run test --filter=@a/x --filter=@a/y', REPO_ROOT), [
    'package-test:@a/x',
    'package-test:@a/y',
  ]);
  assert.deepEqual(workUnits('pnpm --filter @a/x test', REPO_ROOT), ['package-test:@a/x']);
});

test('node --test globs expand to files, so two spellings of one file collide', () => {
  const units = workUnits('node --test --test-concurrency=1 scripts/lib/*.test.mjs', REPO_ROOT);
  assert.ok(units.includes('node-test:scripts/lib/gate-duplication.test.mjs'));
  assert.ok(!units.some((unit) => unit.includes('--test')), 'flags are not files');
});

test('the analyser refutes a chain that repeats work', () => {
  // The shape `verify` had: every package, then a filtered package again, then a docs
  // test file that the meta-test glob had already run.
  const scripts = {
    verify: 'pnpm test && pnpm test:contract && pnpm meta && pnpm docs && pnpm lint && pnpm lint',
    test: 'turbo run test',
    'test:contract': 'turbo run test --filter=@automate/contract-tests',
    meta: 'node --test scripts/lib/*.test.mjs',
    docs: 'node --test scripts/lib/gate-duplication.test.mjs',
    lint: 'eslint .',
  };
  const findings = duplicatedWork('verify', scripts, REPO_ROOT);
  assert.ok(findings.some((f) => f.includes('package-test:@automate/contract-tests')));
  assert.ok(findings.some((f) => f.includes('node-test:scripts/lib/gate-duplication.test.mjs')));
  assert.ok(findings.some((f) => f.includes('command:eslint .')));
});

test('verify performs each unit of work exactly once', () => {
  assert.deepEqual(duplicatedWork('verify', rootScripts(), REPO_ROOT), []);
});
