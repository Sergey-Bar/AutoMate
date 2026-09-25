import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const API_KEY = __ENV.API_KEY || 'test-api-key';

export const options = {
  vus: 5,
  duration: '30s',
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
  const healthOk = check(healthRes, {
    'health status 200': (r) => r.status === 200,
    'health response time < 200ms': (r) => r.timings.duration < 200,
  });
  errorRate.add(!healthOk);

  sleep(0.5);

  // Runs list
  const runsRes = http.get(`${BASE_URL}/api/runs`, params);
  const runsOk = check(runsRes, {
    'runs status 200': (r) => r.status === 200,
    'runs response time < 500ms': (r) => r.timings.duration < 500,
  });
  errorRate.add(!runsOk);

  sleep(0.5);
}
