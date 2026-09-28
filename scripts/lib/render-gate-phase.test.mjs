import assert from 'node:assert/strict';
import test from 'node:test';
import { PHASES, phaseFor, tierProblems } from './render-gate-phase.mjs';

/**
 * The invariant under test is one sentence: **the rendering gate's tier follows its
 * baseline.** Every case below is a way that sentence could be untrue, and each one
 * produces a required check that is permanently red, or a real gate that nothing
 * enforces.
 *
 * The asymmetry is deliberate and is the reason this file exists. Failing to graduate
 * is an operational nuisance — a loud red job. Failing to graduate *correctly* is a
 * silent hole: `recorded: true` beside invented numbers plus a `pr-reporting` tier
 * means a gate that is both permanently green and not required, which no reviewer and
 * no test would otherwise catch. That combination is the last case here for a reason.
 */

/** @param {string[]} problems @param {RegExp} pattern */
function has(problems, pattern) {
  return problems.some((problem) => pattern.test(problem));
}

/** @param {Record<string, unknown>} [overrides] */
function baseline(overrides = {}) {
  return { recorded: true, routes: { '/login': { lcpMs: 1200 } }, ...overrides };
}

test('a baseline with no recorded measurement is the measurement phase', () => {
  assert.equal(phaseFor({ recorded: false }), 'measurement');
  assert.equal(phaseFor({}), 'measurement');
});

test('a recorded baseline is the threshold phase', () => {
  assert.equal(phaseFor(baseline()), 'threshold');
});

test('a missing or malformed budget is the measurement phase, not a crash', () => {
  // The budget is a committed file. A missing or truncated one has to degrade to "no
  // measurement yet" rather than taking the gate down, because the job's job in this
  // phase is to produce the measurement that repairs it.
  for (const value of [undefined, null, [], 'recorded', 42]) {
    assert.equal(phaseFor(value), 'measurement', `phaseFor(${String(value)})`);
  }
});

test('only a literal true is a recorded measurement', () => {
  // `recorded` is written by a human-run script. Anything else — a date, a string, a
  // truthy number — is not a measurement, and treating it as one would graduate the
  // gate on a typo.
  for (const recorded of ['true', '2026-09-27', 1, {}, []]) {
    assert.equal(phaseFor({ recorded }), 'measurement', `recorded: ${JSON.stringify(recorded)}`);
  }
});

test('the matching tier is not a finding in either phase', () => {
  assert.deepEqual(tierProblems({ recorded: false }, PHASES['measurement']), []);
  assert.deepEqual(tierProblems(baseline(), PHASES['threshold']), []);
});

test('a required check that can never pass is a finding', () => {
  // The defect this module exists to prevent, in the form the repository actually
  // shipped it: `pr-blocking` with no baseline. The message has to name the fix,
  // because the instinct on reading "red required check" is to add a number.
  const problems = tierProblems({ recorded: false }, PHASES['threshold']);
  assert.equal(problems.length, 1);
  assert.ok(has(problems, /can never pass/));
  assert.ok(has(problems, /PERF-1/), 'the finding must point at the row that owns the measurement');
  assert.ok(has(problems, /pr-reporting/), 'and name the tier that is correct instead');
});

test('a real gate that nothing is required to satisfy is a finding', () => {
  // The dangerous direction. The comparison is live and strict, and a `pr-reporting`
  // tier means a regression does not stop a merge. Silently green and unenforced is
  // the state this whole two-phase design is meant to make unreachable.
  const problems = tierProblems(baseline(), PHASES['measurement']);
  assert.equal(problems.length, 1);
  assert.ok(has(problems, /must be tiered `pr-blocking`/));
  assert.ok(
    has(problems, /worse than the two-phase rollout/),
    'the message should say why this direction is worse, not just that it is wrong',
  );
});

test('graduating the gate is one consistent change, not two', () => {
  // The transition a human performs: record a real baseline, and raise the tier in
  // the same commit. Both halves are checked here, so the pair cannot be half-applied
  // and left passing.
  const measured = baseline();
  assert.equal(phaseFor(measured), 'threshold');
  assert.deepEqual(tierProblems(measured, PHASES['threshold']), []);
});

test('an unrelated tier value is still a finding, and names the right one', () => {
  for (const tier of ['nightly', 'release', 'never-in-ci', '']) {
    assert.equal(
      tierProblems({ recorded: false }, tier).length,
      1,
      `tier "${tier}" was accepted while unmeasured`,
    );
    assert.equal(
      tierProblems(baseline(), tier).length,
      1,
      `tier "${tier}" was accepted while the gate is real`,
    );
  }
});

test('both phases are distinct tiers, so a swap is always a change', () => {
  // A regression guard on the table itself: if the two values ever became equal,
  // `tierProblems` would return [] for every input and the module would pass
  // vacuously while enforcing nothing.
  assert.notEqual(PHASES['measurement'], PHASES['threshold']);
});
