/**
 * The failing load fixture: the same request, against an endpoint the test server delays, under
 * a latency bound it cannot meet. k6 reports the threshold as crossed and exits 99, and that
 * - not a request failure - is what turns the run into a failure.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  thresholds: {
    http_req_duration: ['p(95)<5'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const response = http.get(`${__ENV.TARGET_URL}/slow`);
  check(response, { 'status is 200': (r) => r.status === 200 });
  sleep(0.1);
}
