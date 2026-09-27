import assert from 'node:assert/strict';
import test from 'node:test';
import { baseBaseline, loweredFloors } from './coverage-floor-ratchet.mjs';

const BASELINE = {
  'packages/shared-contracts': { statements: 99, branches: 97, functions: 97, lines: 99 },
  'packages/ui': { statements: 59, branches: 74, functions: 62, lines: 59 },
  'tests/contract': { status: 'not_configured', reason: 'a test-only package' },
};

/** @param {Record<string, unknown>} overrides */
function after(overrides = {}) {
  return { ...BASELINE, ...overrides };
}

test('an unchanged baseline lowers nothing', () => {
  assert.deepEqual(loweredFloors(BASELINE, after()), []);
});

test('a lowered floor is a finding, and names both numbers', () => {
  // The whole reason this module exists. `coverage-ratchet.mjs` alone reported
  // `passed` for this exact edit.
  const findings = loweredFloors(
    BASELINE,
    after({
      'packages/shared-contracts': { ...BASELINE['packages/shared-contracts'], statements: 1 },
    }),
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0], /statements floor lowered from 99 to 1/);
});

test('a raised floor is progress, not a finding', () => {
  assert.deepEqual(
    loweredFloors(
      BASELINE,
      after({ 'packages/ui': { ...BASELINE['packages/ui'], statements: 65 } }),
    ),
    [],
  );
});

test('removing a package is a lowering, not a deletion', () => {
  const findings = loweredFloors(BASELINE, {
    'packages/ui': BASELINE['packages/ui'],
    'tests/contract': BASELINE['tests/contract'],
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /packages\/shared-contracts: removed from coverage-baseline\.json/);
});

test('replacing a measured floor with not_configured is a lowering with another spelling', () => {
  const findings = loweredFloors(BASELINE, {
    ...after(),
    'packages/ui': { status: 'not_configured', reason: 'temporarily paused' },
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /replaced with \{"status":"not_configured"\}/);
});

test('a not_configured package that was already not_configured is not a finding', () => {
  assert.deepEqual(
    loweredFloors(BASELINE, {
      ...after(),
      'tests/contract': { status: 'not_configured', reason: 'a different but honest reason' },
    }),
    [],
  );
});

test('a package that becomes not_configured and then configured again is compared from the base', () => {
  // Only the *base* state decides which comparison applies. A row that was measured
  // at the base and is measured now with a higher floor is progress.
  assert.deepEqual(
    loweredFloors(
      { 'packages/ui': { ...BASELINE['packages/ui'] } },
      { 'packages/ui': { ...BASELINE['packages/ui'], branches: 80 } },
    ),
    [],
  );
});

test('a floor that stops being a number is a finding', () => {
  const findings = loweredFloors(BASELINE, {
    ...after(),
    'packages/ui': { ...BASELINE['packages/ui'], branches: '74' },
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /branches floor is no longer a number/);
});

test('a metric that was unmeasured at the base is reported rather than accepted', () => {
  // Adding a floor is good. Adding one that no base floor existed for is not
  // comparable, and reporting it is the difference between a visible change and a
  // silent one.
  const findings = loweredFloors(
    { 'packages/ui': { statements: 59 } },
    { 'packages/ui': { statements: 59, branches: 74 } },
  );
  assert.equal(findings.length, 1);
  assert.match(
    findings[0],
    /branches floor is new but the metric it guards was previously unmeasured/,
  );
});

test('a package absent from the base is not a finding', () => {
  // A brand-new package has no base floor, so there is nothing it could have
  // lowered. Failing on this would make adding a package impossible.
  assert.deepEqual(loweredFloors({}, after()), []);
});

test('no base at all lowers nothing, and says so rather than passing quietly', () => {
  assert.deepEqual(loweredFloors(null, after()), []);
  const result = baseBaseline({ ref: null, read: () => null });
  assert.equal(result.baseline, null);
  assert.match(result.reason, /no base ref was supplied/);
});

test('an unreadable base is reported, not treated as an empty base', () => {
  const result = baseBaseline({ ref: 'nope', read: () => null });
  assert.equal(result.baseline, null);
  assert.match(result.reason, /produced nothing/);
});

test('a base that is not valid JSON is reported with the parse error', () => {
  const result = baseBaseline({ ref: 'v1', read: () => '{ not json' });
  assert.equal(result.baseline, null);
  assert.match(result.reason, /not valid JSON/);
});

test('a readable base is parsed and named', () => {
  const result = baseBaseline({
    ref: 'abc123',
    read: () => JSON.stringify({ 'packages/ui': { statements: 59 } }),
  });
  assert.deepEqual(result.baseline, { 'packages/ui': { statements: 59 } });
  assert.match(result.reason, /compared against abc123/);
});
