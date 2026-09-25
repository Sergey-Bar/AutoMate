/**
 * k6 Load Test — Automate API
 *
 * Purpose : Verify the API sustains acceptable latency and error rate under
 *           concurrent load representative of normal production traffic.
 * Profile : Ramp up to 10 VUs over 10 s → hold for 40 s → ramp down 10 s.
 *           Total wall-clock time ≈ 60 s.
 *
 * Thresholds (SLA):
 *   - p95 response time  < 500 ms  (all requests and per-endpoint)
 *   - error rate         < 1 %
 *
 * Usage:
 *   k6 run k6/load.js
 *   DASHBOARD_URL=http://staging:4000 AUTOMATE_DASHBOARD_API_KEY=secret k6 run k6/load.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ── Configuration ─────────────────────────────────────────────────────────────

const BASE_URL = __ENV.DASHBOARD_URL || 'http://localhost:4000';
const API_KEY = __ENV.AUTOMATE_DASHBOARD_API_KEY || '';

// ── Custom metrics ────────────────────────────────────────────────────────────

const errorRate = new Rate('error_rate');
const runsListDuration = new Trend('runs_list_duration', true);
const runDetailDuration = new Trend('run_detail_duration', true);
const analyticsTrendsDuration = new Trend('analytics_trends_duration', true);
const analyticsPassRateDuration = new Trend('analytics_pass_rate_duration', true);
const analyticsFlakeyDuration = new Trend('analytics_flaky_duration', true);
const requestCount = new Counter('total_requests');

// ── k6 options ────────────────────────────────────────────────────────────────

export const options = {
  stages: [
    { duration: '10s', target: 10 },  // ramp up to 10 VUs
    { duration: '40s', target: 10 },  // sustain 10 VUs
    { duration: '10s', target: 0 },   // ramp down
  ],

  thresholds: {
    // Core SLA: p95 response time under 500 ms across ALL requests
    http_req_duration: ['p(95)<500'],
    // Error rate must stay below 1 %
    http_req_failed: ['rate<0.01'],
    // Per-endpoint latency guards
    runs_list_duration: ['p(95)<500'],
    run_detail_duration: ['p(95)<500'],
    analytics_trends_duration: ['p(95)<500'],
    analytics_pass_rate_duration: ['p(95)<500'],
    analytics_flaky_duration: ['p(95)<500'],
    // Custom error rate derived from check() results
    error_rate: ['rate<0.01'],
  },
};

// ── Shared request params ─────────────────────────────────────────────────────

const params = {
  headers: {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json',
  },
  timeout: '15s',
};

// ── Helper: record a request result ──────────────────────────────────────────

function recordRequest(res, trendMetric, checkObj) {
  requestCount.add(1);
  if (trendMetric) trendMetric.add(res.timings.duration);
  const passed = check(res, checkObj);
  errorRate.add(!passed || res.status >= 500);
  return passed;
}

// ── Scenario A: List and inspect runs ────────────────────────────────────────

function scenarioRuns() {
  // GET /api/runs
  const runsRes = http.get(`${BASE_URL}/api/runs?limit=50`, params);
  recordRequest(runsRes, runsListDuration, {
    'GET /api/runs: status 200': (r) => r.status === 200,
    'GET /api/runs: returns array': (r) => Array.isArray(r.json()),
  });

  // GET /api/runs/:id — pick first available run
  let runId = null;
  try {
    const runsData = runsRes.json();
    if (Array.isArray(runsData) && runsData.length > 0) {
      // Spread requests across different run IDs for realistic load
      const idx = Math.floor(Math.random() * Math.min(runsData.length, 10));
      runId = runsData[idx].id;
    }
  } catch (_e) {
    // empty DB — skip
  }

  if (runId) {
    const runDetailRes = http.get(`${BASE_URL}/api/runs/${runId}`, params);
    recordRequest(runDetailRes, runDetailDuration, {
      'GET /api/runs/:id: status 200': (r) => r.status === 200,
      'GET /api/runs/:id: has id': (r) => Boolean(r.json('id')),
    });
  }
}

// ── Scenario B: Analytics endpoints ──────────────────────────────────────────

function scenarioAnalytics() {
  // GET /api/analytics/trends (may return 404 if not implemented)
  const trendsRes = http.get(`${BASE_URL}/api/analytics/trends`, params);
  recordRequest(trendsRes, analyticsTrendsDuration, {
    'GET /api/analytics/trends: no server error': (r) => r.status < 500,
  });

  sleep(0.2);

  // GET /api/analytics/pass-rate
  const passRateRes = http.get(`${BASE_URL}/api/analytics/pass-rate?days=30`, params);
  recordRequest(passRateRes, analyticsPassRateDuration, {
    'GET /api/analytics/pass-rate: status 200': (r) => r.status === 200,
    'GET /api/analytics/pass-rate: returns array': (r) => Array.isArray(r.json()),
  });

  sleep(0.2);

  // GET /api/analytics/flaky
  const flakyRes = http.get(`${BASE_URL}/api/analytics/flaky?limit=20`, params);
  recordRequest(flakyRes, analyticsFlakeyDuration, {
    'GET /api/analytics/flaky: status 200': (r) => r.status === 200,
  });
}

// ── Scenario C: Health probe ──────────────────────────────────────────────────

function scenarioHealth() {
  const res = http.get(`${BASE_URL}/health`, params);
  recordRequest(res, null, {
    'GET /health: status 200': (r) => r.status === 200,
    'GET /health: ok': (r) => r.json('status') === 'ok',
  });
}

// ── Default function (round-robin across scenarios) ───────────────────────────

export default function () {
  // Distribute load across scenarios:
  //   40 % → runs (heaviest — DB queries)
  //   40 % → analytics (aggregation queries)
  //   20 % → health (lightweight probe)
  const roll = Math.random();

  if (roll < 0.40) {
    scenarioRuns();
  } else if (roll < 0.80) {
    scenarioAnalytics();
  } else {
    scenarioHealth();
  }

  // Think time between iterations: 0.5–1.5 s (simulates real browser pacing)
  sleep(0.5 + Math.random());
}
