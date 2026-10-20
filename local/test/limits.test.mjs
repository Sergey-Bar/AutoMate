import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { TextEncoder } from 'node:util';
import { ingest } from '../src/ingest.mjs';

const encoder = new TextEncoder();

test('Playwright JSON over the byte limit is rejected before it is parsed', () => {
  const { result } = ingest(encoder.encode(`{"suites":[],"pad":"${'x'.repeat(2048)}"}`), {
    maxBytes: 1024,
  });
  assert.equal(result.kind, 'rejected');
  assert.equal(result.rejection, 'too-large');
});

test('Playwright JSON over the test limit keeps the first tests and says it is partial', () => {
  const tests = Array.from({ length: 30 }, (_, index) => ({
    projectName: 'p',
    status: 'expected',
    results: [{ status: 'passed', duration: 1 }],
    title: `t${String(index)}`,
  }));
  const specs = tests.map((test_) => ({ title: test_.title, tests: [test_] }));
  const report = { suites: [{ title: 's.spec.ts', file: 'tests/s.spec.ts', specs }], stats: {} };
  const { result } = ingest(encoder.encode(JSON.stringify(report)), { maxTests: 10 });
  assert.equal(result.kind, 'run');
  assert.equal(result.tests.length, 10);
  assert.equal(result.completeness, 'partial');
  assert.ok(result.warnings.includes('test-limit-reached'));
  assert.equal(result.runStatus, 'unknown', 'a partial report cannot be reported as passed');
});

test('lcov over the byte limit is rejected', () => {
  const { result } = ingest(
    encoder.encode(`TN:\nSF:a.js\n${'DA:1,1\n'.repeat(500)}end_of_record\n`),
    {
      maxBytes: 100,
    },
  );
  assert.equal(result.kind, 'rejected');
  assert.equal(result.rejection, 'too-large');
});

test('absurdly nested JSON is refused quickly and does not crash the process', () => {
  const depth = 200_000;
  const started = performance.now();
  const { result } = ingest(encoder.encode(`{"suites":${'['.repeat(depth)}${']'.repeat(depth)}}`));
  const elapsed = performance.now() - started;
  assert.ok(['rejected', 'run'].includes(result.kind));
  assert.ok(elapsed < 5000, `took ${String(elapsed)} ms`);
});

test('ingesting twenty thousand testcases does not blow up', () => {
  // A guard against accidental quadratic behaviour, not a benchmark. The bound is
  // deliberately generous; a measured figure belongs in a recorded run on named hardware.
  const cases = Array.from(
    { length: 20_000 },
    (_, index) =>
      `<testcase classname="C${String(index % 50)}" name="t${String(index)}" time="0.001"/>`,
  ).join('\n');
  const xml = `<testsuite name="big" tests="20000">${cases}</testsuite>`;
  const started = performance.now();
  const { result } = ingest(encoder.encode(xml));
  const elapsed = performance.now() - started;
  assert.equal(result.kind, 'run');
  assert.equal(result.tests.length, 20_000);
  assert.equal(result.runStatus, 'passed');
  assert.ok(elapsed < 5000, `took ${String(elapsed)} ms`);
});
