/**
 * The k6 thresholds are tied to a recorded observation, not to an estimate (RF-9).
 *
 * `scripts/performance-gate.mjs` already proves the record and the scenario carry the
 * same expressions. What nothing proved was that the expressions describe a
 * measurement: `observed_on_reference_hardware` shipped `recorded: false` with three
 * nulls, and `p(95)<500` sat ~90x above the latency the API actually has. These tests
 * hold the other half — the observation exists, it is under every ceiling, and no
 * ceiling has drifted so far above it that it could not catch a regression.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const record = JSON.parse(readFileSync(path.join(root, 'performance', 'thresholds.json'), 'utf8'));
const scenario = readFileSync(path.join(root, 'performance', 'smoke.js'), 'utf8');
const observed = record.observed_on_reference_hardware;

/**
 * The bound of a `<` expression such as `p(95)<50`, or `null` when there is none.
 *
 * @param {unknown} expressions
 * @param {string} aggregate
 * @returns {number | null}
 */
function upperBound(expressions, aggregate) {
  if (!Array.isArray(expressions)) return null;
  for (const expression of expressions) {
    const match = new RegExp(`^${aggregate.replace(/[()]/g, '\\$&')}<(\\d+(?:\\.\\d+)?)$`).exec(
      String(expression),
    );
    if (match?.[1] !== undefined) return Number(match[1]);
  }
  return null;
}

/**
 * How far above an observation a latency ceiling may sit and still be a regression
 * signal. The old `p(95)<500` was ~90x the recorded p95, and that is the shape refused.
 */
const MAX_HEADROOM = 30;

test('the reference observation is recorded, dated and on named hardware', () => {
  assert.equal(observed?.recorded, true, 'observed_on_reference_hardware must be recorded');
  assert.match(String(observed.recordedOn), /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(String(observed.hardware ?? '').length > 20, 'the hardware must be named');
  for (const key of ['http_req_duration_p95', 'http_req_duration_p99', 'http_req_failed_rate']) {
    assert.ok(
      Number.isFinite(observed[key]),
      `${key} must be a measured number, not ${observed[key]}`,
    );
  }
});

test('every observed value is inside the threshold it is recorded against', () => {
  const duration = record.release.http_req_duration;
  const p95 = upperBound(duration, 'p(95)');
  const p99 = upperBound(duration, 'p(99)');
  const failed = upperBound(record.release.http_req_failed, 'rate');
  assert.ok(p95 !== null && p99 !== null && failed !== null, 'each ceiling must be a `<` bound');
  assert.ok(observed.http_req_duration_p95 < p95);
  assert.ok(observed.http_req_duration_p99 < p99);
  assert.ok(observed.http_req_failed_rate < failed);
});

test('no latency ceiling sits so far above the observation that it cannot fail', () => {
  const duration = record.release.http_req_duration;
  for (const [aggregate, key] of [
    ['p(95)', 'http_req_duration_p95'],
    ['p(99)', 'http_req_duration_p99'],
  ]) {
    const ceiling = upperBound(duration, aggregate);
    assert.ok(ceiling !== null);
    assert.ok(
      ceiling <= observed[key] * MAX_HEADROOM,
      `${aggregate}<${String(ceiling)} is more than ${String(MAX_HEADROOM)}x the observed ` +
        `${String(observed[key])} ms, so a regression of that size would still pass.`,
    );
  }
});

test('the scenario exports p(99), so the observation can be read from the gate output', () => {
  // k6's default trend stats stop at p(95). Without this the threshold is evaluated but
  // `var/performance-summary.json` has no p99, and the record cannot be refreshed.
  assert.match(scenario, /summaryTrendStats:\s*\[[^\]]*'p\(99\)'/);
});
