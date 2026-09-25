import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  vus: 5,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    errors: ['rate<0.01'],
  },
};

export default function () {
  // Health check
  const healthRes = http.get(`${BASE_URL}/health`);
  const healthOk = check(healthRes, {
    'health status 200': (r) => r.status === 200,
    'health response time < 200ms': (r) => r.timings.duration < 200,
  });
  errorRate.add(!healthOk);

  sleep(0.5);

  // Conversations list
  const convsRes = http.get(`${BASE_URL}/api/conversations`);
  const convsOk = check(convsRes, {
    'conversations status 200': (r) => r.status === 200,
    'conversations response time < 500ms': (r) => r.timings.duration < 500,
  });
  errorRate.add(!convsOk);

  sleep(0.5);
}
