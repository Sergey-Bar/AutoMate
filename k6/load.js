/**
 * k6 Load Test — Automate API
 *
 * Sustained load test across core endpoints (10 VUs, 60s).
 * Uses ramping stages to ramp up, sustain, then ramp down.
 *
 * Run:
 *   k6 run k6/load.js
 *   AUTOMATE_URL=http://localhost:3000 k6 run k6/load.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const errorRate = new Rate('errors');
const healthDuration = new Trend('health_duration', true);
const conversationsDuration = new Trend('conversations_duration', true);
const connectorsDuration = new Trend('connectors_duration', true);
const requestCount = new Counter('request_count');

export const options = {
  stages: [
    // Ramp up to 10 VUs over 10s
    { duration: '10s', target: 10 },
    // Sustain 10 VUs for 40s
    { duration: '40s', target: 10 },
    // Ramp down to 0 over 10s
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    // p95 response time must be below 500ms
    http_req_duration: ['p(95)<500'],
    // Error rate must be below 1%
    errors: ['rate<0.01'],
    // Per-endpoint p95 thresholds
    health_duration: ['p(95)<500'],
    conversations_duration: ['p(95)<500'],
    connectors_duration: ['p(95)<500'],
    // Ensure we actually send requests
    request_count: ['count>0'],
  },
};

const BASE_URL = __ENV.AUTOMATE_URL || 'http://localhost:3000';

const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

function checkHealth() {
  const res = http.get(`${BASE_URL}/health`, { headers: HEADERS, tags: { name: 'health' } });
  healthDuration.add(res.timings.duration);
  requestCount.add(1);

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
    'GET /health → response time < 500ms': (r) => r.timings.duration < 500,
  });

  errorRate.add(!ok);
  return ok;
}

function checkConversations() {
  const res = http.get(`${BASE_URL}/api/conversations`, {
    headers: HEADERS,
    tags: { name: 'conversations' },
  });
  conversationsDuration.add(res.timings.duration);
  requestCount.add(1);

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
    'GET /api/conversations → response time < 500ms': (r) => r.timings.duration < 500,
  });

  errorRate.add(!ok);
  return ok;
}

function checkConversationsWithPagination() {
  const res = http.get(`${BASE_URL}/api/conversations?limit=10&offset=0`, {
    headers: HEADERS,
    tags: { name: 'conversations_paginated' },
  });
  conversationsDuration.add(res.timings.duration);
  requestCount.add(1);

  const ok = check(res, {
    'GET /api/conversations?limit=10 → 200': (r) => r.status === 200,
    'GET /api/conversations?limit=10 → array response': (r) => {
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
  const res = http.get(`${BASE_URL}/api/connectors`, {
    headers: HEADERS,
    tags: { name: 'connectors' },
  });
  connectorsDuration.add(res.timings.duration);
  requestCount.add(1);

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
    'GET /api/connectors → response time < 500ms': (r) => r.timings.duration < 500,
  });

  errorRate.add(!ok);
  return ok;
}

export default function () {
  // Every VU iteration exercises all three key endpoints
  checkHealth();
  sleep(0.3);

  checkConversations();
  sleep(0.3);

  // Alternate between plain list and paginated list to vary query patterns
  if (__VU % 2 === 0) {
    checkConversationsWithPagination();
    sleep(0.3);
  }

  checkConnectors();
  sleep(0.3);
}
