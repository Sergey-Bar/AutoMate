// Source of the two "real tool output" fixtures (node-junit, node-lcov).
//
// Run by `node --test` with the JUnit and lcov reporters; see corpus/manifest.json for the
// exact command and the tool version. It contains a deliberate failure, a deliberate
// error, a skip and a todo so the output covers every outcome the runner can emit.
//
// It is not named `*.test.mjs` on purpose: the repository's test globs must not pick up a
// suite that fails by design.
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { add } from './node-sample-subject.mjs';

describe('arithmetic', () => {
  test('adds two numbers', () => {
    assert.equal(add(1, 2), 3);
  });

  test('fails on purpose', () => {
    assert.equal(add(1, 1), 3);
  });

  test('throws on purpose', () => {
    throw new TypeError('boom from the sample suite');
  });

  test('is skipped', { skip: 'skipped by design' }, () => {
    assert.fail('never runs');
  });

  test('is a todo', { todo: 'not written yet' }, () => {
    assert.fail('todo bodies still run, and this one fails');
  });
});

test('top-level test with a parameter-like name [case=1]', () => {
  assert.equal(add(0, 0), 0);
});
