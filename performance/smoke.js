/**
 * The committed performance scenario.
 *
 * `scripts/performance-gate.mjs` previously ended its success branch in
 * `process.exit(1)`, so the gate failed even when k6 worked — and no scenario
 * existed for it to run. This file is that scenario, and the `thresholds` block
 * below is the single authority the gate enforces: k6 exits 99 when a threshold
 * is breached, which the script treats as a failure and anything else non-zero
 * as a run failure.
 *
 * The numbers are duplicated in `performance/thresholds.json` so a change to
 * either is visible in review. The scenario is the one k6 executes; the JSON is
 * the record.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';

export const options = {
  scenarios: {
    smoke: {
      executor: 'ramping-arrival-rate',
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 10,
      maxVUs: 50,
      stages: [
        { target: 20, duration: '30s' },
        { target: 50, duration: '1m' },
        { target: 0, duration: '10s' },
      ],
    },
  },
  thresholds: {
    // Kept in step with performance/thresholds.json.
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
  discardResponseBodies: false,
};

const HEADERS = {
  'content-type': 'application/json',
  // The API key the compose stack is started with. The E2E/performance stack
  // supplies a key of its own; the value is a fixture, not a credential.
  authorization: `Bearer ${__ENV.AUTOMATE_API_KEY || 'e2e-installation-key'}`,
};

export default function smoke() {
  // Liveness: unauthenticated by design, and the cheapest thing to measure.
  const health = http.get(`${BASE_URL}/api/v1/health`);
  check(health, {
    'health returns 200': (response) => response.status === 200,
  });

  // Capability manifest: small, cached, and the path the dashboard hits first.
  const features = http.get(`${BASE_URL}/api/v1/features`);
  check(features, {
    'features returns 200': (response) => response.status === 200,
    'features returns json': (response) =>
      (response.headers['Content-Type'] || '').includes('application/json'),
  });

  // The list read behind every dashboard view.
  const runs = http.get(`${BASE_URL}/api/v1/runs`, { headers: HEADERS });
  check(runs, {
    'runs returns 200': (response) => response.status === 200,
    // A 401 or 500 here is a real failure, not a performance signal, and would
    // otherwise be averaged into the latency numbers.
    'runs is not an error': (response) => response.status < 400,
  });

  sleep(1);
}

export function handleSummary(data) {
  // `scripts/performance-gate.mjs` writes `--summary-export`; this keeps the
  // human-readable output on stdout without adding a reporter dependency.
  return {
    stdout: `\nrequests: ${data.metrics.http_reqs?.values?.count ?? 0}\n` +
      `p95: ${data.metrics.http_req_duration?.values?.['p(95)'] ?? 'n/a'} ms\n` +
      `p99: ${data.metrics.http_req_duration?.values?.['p(99)'] ?? 'n/a'} ms\n` +
      `failed: ${data.metrics.http_req_failed?.values?.rate ?? 'n/a'}\n` +
      `checks: ${data.metrics.checks?.values?.rate ?? 'n/a'}\n`,
  };
}
