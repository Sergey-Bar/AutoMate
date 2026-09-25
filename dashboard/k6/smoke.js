/**
 * k6 Smoke Test — Automate API
 *
 * Purpose : Verify the API is alive and responds within acceptable latency.
 * Profile : 1 VU, 10 seconds — minimal footprint, runs in CI on every deploy.
 *
 * Usage:
 *   k6 run k6/smoke.js
 *   DASHBOARD_URL=http://staging:4000 AUTOMATE_DASHBOARD_API_KEY=secret k6 run k6/smoke.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ── Configuration ─────────────────────────────────────────────────────────────

const BASE_URL = __ENV.DASHBOARD_URL || 'http://localhost:4000';
const API_KEY = __ENV.AUTOMATE_DASHBOARD_API_KEY || '';

// ── Custom metrics ────────────────────────────────────────────────────────────

const errorRate = new Rate('error_rate');
const runsListDuration = new Trend('runs_list_duration', true);
const runDetailDuration = new Trend('run_detail_duration', true);
const analyticsTrendsDuration = new Trend('analytics_trends_duration', true);

// ── k6 options ────────────────────────────────────────────────────────────────

export const options = {
  vus: 1,
  duration: '10s',

  thresholds: {
    // Core SLA: p95 response time under 500 ms
    http_req_duration: ['p(95)<500'],
    // Error rate must stay below 1 %
    http_req_failed: ['rate<0.01'],
    // Per-endpoint latency guards
    runs_list_duration: ['p(95)<500'],
    run_detail_duration: ['p(95)<500'],
    analytics_trends_duration: ['p(95)<500'],
  },
};

// ── Shared request params ─────────────────────────────────────────────────────

const params = {
  headers: {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json',
  },
  timeout: '10s',
};

// ── Default function (one iteration per VU) ───────────────────────────────────

export default function () {
  // 1. Health check — confirm the server is up
  const healthRes = http.get(`${BASE_URL}/health`, params);
  check(healthRes, {
    'health: status 200': (r) => r.status === 200,
    'health: body ok': (r) => r.json('status') === 'ok',
  });
  errorRate.add(healthRes.status >= 400);

  sleep(0.3);

  // 2. GET /api/runs — list runs
  const runsRes = http.get(`${BASE_URL}/api/runs?limit=20`, params);
  runsListDuration.add(runsRes.timings.duration);
  const runsOk = check(runsRes, {
    'GET /api/runs: status 200': (r) => r.status === 200,
    'GET /api/runs: is array': (r) => Array.isArray(r.json()),
  });
  errorRate.add(!runsOk);

  sleep(0.3);

  // 3. GET /api/runs/:id — single run detail (use first run id if available)
  let runId = null;
  try {
    const runsData = runsRes.json();
    if (Array.isArray(runsData) && runsData.length > 0) {
      runId = runsData[0].id;
    }
  } catch (_e) {
    // no runs in the DB yet — skip detail check
  }

  if (runId) {
    const runDetailRes = http.get(`${BASE_URL}/api/runs/${runId}`, params);
    runDetailDuration.add(runDetailRes.timings.duration);
    const runDetailOk = check(runDetailRes, {
      'GET /api/runs/:id: status 200': (r) => r.status === 200,
      'GET /api/runs/:id: has id field': (r) => r.json('id') === runId,
    });
    errorRate.add(!runDetailOk);
  }

  sleep(0.3);

  // 4. GET /api/analytics/trends — analytics trends endpoint
  const trendsRes = http.get(`${BASE_URL}/api/analytics/trends`, params);
  analyticsTrendsDuration.add(trendsRes.timings.duration);
  const trendsOk = check(trendsRes, {
    // Accept 200 (data) or 404 (endpoint not yet enabled) — not a server error
    'GET /api/analytics/trends: not server error': (r) => r.status < 500,
  });
  errorRate.add(!trendsOk);

  sleep(0.3);

  // 5. GET /api/analytics/pass-rate — core analytics
  const passRateRes = http.get(`${BASE_URL}/api/analytics/pass-rate`, params);
  check(passRateRes, {
    'GET /api/analytics/pass-rate: status 200': (r) => r.status === 200,
  });
  errorRate.add(passRateRes.status >= 500);

  sleep(0.5);
}
