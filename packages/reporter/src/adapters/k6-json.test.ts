import { describe, expect, it } from 'vitest';

import { K6_JSON_ADAPTER_VERSION, parseK6Summary } from './k6-json.js';
import type { ProducerContext } from '../adapter.js';
import type { CanonicalStatus } from '../producer-status.js';

const context: ProducerContext = {
  workspaceId: 'ws-1',
  runId: 'run-1',
  projectId: 'project-1',
  sourceUri: 'k6-summary.json',
  sourceDigest: 'a'.repeat(64),
  producerVersion: '0.54.0',
  adapterVersion: K6_JSON_ADAPTER_VERSION,
  startedAt: '2026-10-02T10:00:00.000Z',
  finishedAt: '2026-10-02T10:05:00.000Z',
};

const bytes = (document: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(document));

function parse(document: unknown) {
  return parseK6Summary(bytes(document), context);
}

const statusOf = (result: ReturnType<typeof parseK6Summary>, testId: string): CanonicalStatus =>
  result.attempts.find((attempt) => attempt.testId === testId)?.status ?? 'unknown';

describe('a k6 summary is a load result, not a suite of tests', () => {
  it('turns each metric carrying pass and fail counts into one attempt', () => {
    const result = parse({
      metrics: {
        checks: { passes: 418, fails: 2, value: 0.99 },
        http_req_failed: { passes: 2, fails: 418, value: 0.01 },
      },
    });

    expect(result.attempts).toHaveLength(2);
    expect(statusOf(result, 'k6.checks')).toBe('failed');
    // `http_req_failed` is inverted: a *low* value is the good outcome, so its
    // `fails` count is how many requests were fine. Reading every metric with the
    // same polarity would report 418 failures on a run that had 2.
    expect(statusOf(result, 'k6.http_req_failed')).toBe('failed');
  });

  it('reports a fully passing metric as passed', () => {
    const result = parse({
      metrics: { checks: { passes: 418, fails: 0, value: 1 } },
    });
    expect(statusOf(result, 'k6.checks')).toBe('passed');
  });

  it('marks a metric whose value is above zero on a failure metric as failed', () => {
    // `http_req_failed` with `value: 0.02` means 2% of requests failed even
    // though its `fails`/`passes` counters are absent from a partial summary.
    const result = parse({ metrics: { http_req_failed: { value: 0.02 } } });
    expect(statusOf(result, 'k6.http_req_failed')).toBe('failed');
  });

  it('carries the numeric metric into the attempt, so the dashboard can chart it', () => {
    const result = parse({
      metrics: { http_req_duration: { avg: 12.5, 'p(95)': 480, max: 900, min: 1 } },
    });
    // A duration metric has no pass/fail counter, so it is not an attempt on its
    // own — it is the evidence for the thresholds declared over it.
    expect(result.attempts.some((attempt) => attempt.testId === 'k6.http_req_duration')).toBe(
      false,
    );
    expect(result.provenance['metrics']).toMatchObject({ http_req_duration: { 'p(95)': 480 } });
  });
});

describe("a threshold is k6's actual pass or fail, so it is an attempt", () => {
  it('reads a breached threshold as a failure and names the bound', () => {
    const result = parse({
      options: { thresholds: { http_req_duration: ['p(95)<500'] } },
      metrics: { http_req_duration: { 'p(95)': 480 } },
    });

    const threshold = result.attempts.find((attempt) => attempt.testId.startsWith('threshold:'));
    expect(threshold?.status).toBe('passed');
    expect(threshold?.title).toContain('p(95)<500');
  });

  it('reads an unbreached threshold as a failure', () => {
    const result = parse({
      options: { thresholds: { http_req_duration: ['p(95)<500'] } },
      metrics: { http_req_duration: { 'p(95)': 900 } },
    });

    const threshold = result.attempts.find((attempt) => attempt.testId.startsWith('threshold:'));
    expect(threshold?.status).toBe('failed');
    expect(threshold?.error?.message).toContain('p(95)<500');
  });

  it('reports a threshold whose metric is missing as unknown rather than passed', () => {
    // The absent metric is the honest reading: k6 did not measure it, so the
    // threshold says nothing. Defaulting to `passed` would put a green run on the
    // dashboard for a bound that was never evaluated.
    const result = parse({
      options: { thresholds: { http_req_failed: ['rate<0.01'] } },
      metrics: {},
    });
    expect(statusOf(result, 'threshold:http_req_failed[rate<0.01]')).toBe('unknown');
  });

  it('keeps the trend of a threshold expression, because k6 selectors carry one', () => {
    const result = parse({
      options: { thresholds: { 'http_req_duration{scenario:default}': ['p(95)<500'] } },
      metrics: { 'http_req_duration{scenario:default}': { 'p(95)': 100 } },
    });
    expect(statusOf(result, 'threshold:http_req_duration{scenario:default}[p(95)<500]')).toBe(
      'passed',
    );
  });
});

describe('a summary that measured nothing is not a pass', () => {
  it('emits an unknown attempt rather than a green run', () => {
    // `runStatusFrom([])` falls through to `skipped` — an empty outcome list is
    // the one input where that ladder is wrong, and an adapter has to refuse to
    // hand it one. A k6 summary with no metrics asserted nothing, and reporting
    // that as anything but `unknown` is a lie the score would then read.
    const result = parse({ metrics: {} });
    expect(result.status).toBe('unknown');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.status).toBe('unknown');
    expect(result.completeness.state).toBe('unknown');
  });

  it('refuses a document that is not a k6 summary', () => {
    expect(() => parse({ hello: 'world' })).toThrow(/k6/i);
    expect(() => parseK6Summary(new TextEncoder().encode('not json'), context)).toThrow();
  });
});

describe('attribution survives the parse', () => {
  it('records the adapter version, so a changed reading is answerable later', () => {
    const result = parse({ metrics: { checks: { passes: 1, fails: 0, value: 1 } } });
    expect(result.provenance['producer']).toBe('k6');
    expect(result.provenance['adapterVersion']).toBe(K6_JSON_ADAPTER_VERSION);
  });
});

// ---------------------------------------------------------------------------
// The document `k6 run --summary-export` writes (k6 v2.3.0). This is the only shape a
// producer in this repository emits, and it differs from the one the adapter was first
// written against: thresholds are not an `options` block, they sit on the metric they
// judge as `{ "<expression>": <crossed> }`, where `true` means the bound was BREACHED.
// ---------------------------------------------------------------------------

/** What k6 v2.3.0 exported for a run that met every bound (trimmed to the judged metrics). */
const EXPORTED_CLEAN = {
  metrics: {
    checks: { passes: 40, fails: 0, thresholds: { 'rate>0.99': false }, value: 1 },
    http_req_failed: { passes: 0, fails: 40, thresholds: { 'rate<0.01': false }, value: 0 },
    http_req_duration: { avg: 0.7, 'p(95)': 2.4, thresholds: { 'p(95)<2000': false } },
    http_reqs: { count: 40, rate: 19.7 },
  },
};

/** The same, for a run whose p(95) latency bound was crossed (k6 exited 99). */
const EXPORTED_BREACHED = {
  metrics: {
    checks: { passes: 28, fails: 0, value: 1 },
    http_req_failed: { passes: 0, fails: 28, thresholds: { 'rate<0.01': false }, value: 0 },
    http_req_duration: { avg: 43.7, 'p(95)': 53.3, thresholds: { 'p(95)<5': true } },
  },
};

describe("the thresholds `k6 run --summary-export` writes are k6's own verdict", () => {
  it('reads a crossed threshold on a metric with no counters as a failed attempt naming the bound', () => {
    const result = parse(EXPORTED_BREACHED);

    const crossed = result.attempts.find(
      (attempt) => attempt.testId === 'threshold:http_req_duration[p(95)<5]',
    );
    expect(crossed?.status).toBe('failed');
    expect(crossed?.error?.message).toContain('p(95)<5');
    expect(result.status).toBe('failed');
  });

  it('reads a summary whose every threshold held as passed', () => {
    const result = parse(EXPORTED_CLEAN);

    expect(result.attempts.map((attempt) => [attempt.testId, attempt.status])).toEqual([
      ['threshold:checks[rate>0.99]', 'passed'],
      ['threshold:http_req_failed[rate<0.01]', 'passed'],
      ['threshold:http_req_duration[p(95)<2000]', 'passed'],
    ]);
    expect(result.status).toBe('passed');
  });

  it('reads http_req_failed by the requests that failed, which k6 counts as `passes`', () => {
    // `passes` of a Rate is the number of non-zero samples; for `http_req_failed` those are
    // the failed requests. A run with no failed request has `passes: 0, fails: 40`, and reading
    // `fails` as the failure count reported 40 failures on a clean run.
    const clean = parse({ metrics: { http_req_failed: { passes: 0, fails: 40, value: 0 } } });
    expect(statusOf(clean, 'k6.http_req_failed')).toBe('passed');

    const failing = parse({ metrics: { http_req_failed: { passes: 3, fails: 37, value: 0.075 } } });
    expect(statusOf(failing, 'k6.http_req_failed')).toBe('failed');
  });

  it('judges a metric that carries thresholds by them, not by its raw counters', () => {
    // k6 itself passes a 3% failure rate under `rate>0.95`; failing it on `fails: 3` as well
    // would overrule the script's own tolerance.
    const result = parse({
      metrics: {
        checks: { passes: 97, fails: 3, thresholds: { 'rate>0.95': false }, value: 0.97 },
      },
    });

    expect(result.attempts.map((attempt) => [attempt.testId, attempt.status])).toEqual([
      ['threshold:checks[rate>0.95]', 'passed'],
    ]);
  });

  it('still fails a metric with no thresholds of its own on any failed sample', () => {
    const result = parse({ metrics: { checks: { passes: 97, fails: 3, value: 0.97 } } });
    expect(statusOf(result, 'k6.checks')).toBe('failed');
  });

  it('lists a threshold once when it is both exported on the metric and declared in options', () => {
    const result = parse({
      options: { thresholds: { http_req_duration: ['p(95)<5'] } },
      metrics: { http_req_duration: { 'p(95)': 53.3, thresholds: { 'p(95)<5': true } } },
    });

    const ids = result.attempts.map((attempt) => attempt.testId);
    expect(ids.filter((id) => id === 'threshold:http_req_duration[p(95)<5]')).toHaveLength(1);
    expect(statusOf(result, 'threshold:http_req_duration[p(95)<5]')).toBe('failed');
  });

  it('reads a verdict that is not a boolean as unknown, never as passed', () => {
    const result = parse({
      metrics: { http_req_duration: { 'p(95)': 1, thresholds: { 'p(95)<5': 'maybe' } } },
    });
    expect(statusOf(result, 'threshold:http_req_duration[p(95)<5]')).toBe('unknown');
  });
});
