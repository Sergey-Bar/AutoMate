/**
 * The passing load fixture: one GET against the target the runner hands in as TARGET_URL.
 *
 * Conventions every script in this directory follows (the runner relies on them):
 *   - the target comes from `TARGET_URL`, never a literal, so the runner's origin allowlist
 *     governs where the load goes;
 *   - no `scenarios`: the runner passes `--vus` and `--duration`, which are the bounded
 *     load the job asked for, and a script that declared its own executor would escape them;
 *   - the pass/fail bounds are `thresholds`, which is what k6 (and so the run) is judged on.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const response = http.get(`${__ENV.TARGET_URL}/health`);
  check(response, { 'status is 200': (r) => r.status === 200 });
  sleep(0.1);
}
