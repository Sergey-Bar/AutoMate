import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const API_KEY = __ENV.API_KEY || 'test-api-key';

export const options = {
  stages: [
    { duration: '1m', target: 20 },
    { duration: '3m', target: 50 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    errors: ['rate<0.01'],
  },
};

const params = {
  headers: {
    Cookie: `session=${API_KEY}`,
    'Content-Type': 'application/json',
  },
};

export default function () {
  // Health check
  const healthRes = http.get(`${BASE_URL}/health`, params);
  check(healthRes, { 'health 200': (r) => r.status === 200 });
  errorRate.add(healthRes.status !== 200);

  sleep(0.3);

  // Runs list
  const runsRes = http.get(`${BASE_URL}/api/runs`, params);
  const runsOk = check(runsRes, {
    'runs 200': (r) => r.status === 200,
    'runs has body': (r) => r.body && r.body.length > 0,
  });
  errorRate.add(!runsOk);

  sleep(0.3);

  // Run detail (if runs exist)
  if (runsRes.status === 200) {
    let runs;
    try {
      runs = JSON.parse(runsRes.body);
    } catch (_e) {
      runs = [];
    }
    if (Array.isArray(runs) && runs.length > 0) {
      const runId = runs[0].id;
      const detailRes = http.get(`${BASE_URL}/api/runs/${runId}`, params);
      check(detailRes, { 'run detail 200': (r) => r.status === 200 });
      errorRate.add(detailRes.status !== 200);
      sleep(0.2);
    }
  }

  // Analytics
  const analyticsRes = http.get(`${BASE_URL}/api/analytics`, params);
  check(analyticsRes, { 'analytics 2xx': (r) => r.status >= 200 && r.status < 300 });
  errorRate.add(analyticsRes.status < 200 || analyticsRes.status >= 300);

  sleep(0.5);
}
