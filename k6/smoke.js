/**
 * k6 Smoke Test — Automate API
 *
 * Validates core endpoints with minimal load (1 VU, 10s).
 * Purpose: verify the API is up and responding correctly before heavier tests.
 *
 * Run:
 *   k6 run k6/smoke.js
 *   AUTOMATE_URL=http://localhost:3000 k6 run k6/smoke.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const healthDuration = new Trend('health_duration', true);
const conversationsDuration = new Trend('conversations_duration', true);
const connectorsDuration = new Trend('connectors_duration', true);

export const options = {
  vus: 1,
  duration: '10s',
  thresholds: {
    // p95 response time must be below 500ms
    http_req_duration: ['p(95)<500'],
    // Error rate must be below 1%
    errors: ['rate<0.01'],
    // Per-endpoint p95 thresholds
    health_duration: ['p(95)<500'],
    conversations_duration: ['p(95)<500'],
    connectors_duration: ['p(95)<500'],
  },
};

const BASE_URL = __ENV.AUTOMATE_URL || 'http://localhost:3000';

const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

function checkHealth() {
  const res = http.get(`${BASE_URL}/health`, { headers: HEADERS });
  healthDuration.add(res.timings.duration);

  const ok = check(res, {
    'GET /health → 200': (r) => r.status === 200,
    'GET /health → has status field': (r) => {
      try {
        const body = JSON.parse(r.body);
        return typeof body.status === 'string';
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!ok);
  return ok;
}

function checkConversations() {
  const res = http.get(`${BASE_URL}/api/conversations`, { headers: HEADERS });
  conversationsDuration.add(res.timings.duration);

  const ok = check(res, {
    'GET /api/conversations → 200': (r) => r.status === 200,
    'GET /api/conversations → array response': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body);
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!ok);
  return ok;
}

function checkConnectors() {
  const res = http.get(`${BASE_URL}/api/connectors`, { headers: HEADERS });
  connectorsDuration.add(res.timings.duration);

  const ok = check(res, {
    'GET /api/connectors → 200': (r) => r.status === 200,
    'GET /api/connectors → array response': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body);
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!ok);
  return ok;
}

export default function () {
  checkHealth();
  sleep(0.5);

  checkConversations();
  sleep(0.5);

  checkConnectors();
  sleep(0.5);
}
