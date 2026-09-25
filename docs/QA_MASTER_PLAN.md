# Automate — Master QA Plan

> Comprehensive quality assurance strategy for the Automate monorepo.
> Covers both **Automate** and **Automate** projects.
> All tools are **free / open-source**. Full automation. Zero manual gates.

---

## Table of Contents

1. [Current State Audit](#1-current-state-audit)
2. [QA Architecture Overview](#2-qa-architecture-overview)
3. [Testing Pyramid](#3-testing-pyramid)
4. [Unit Testing](#4-unit-testing)
5. [Integration Testing](#5-integration-testing)
6. [End-to-End Testing](#6-end-to-end-testing)
7. [Visual Regression Testing](#7-visual-regression-testing)
8. [Performance Testing](#8-performance-testing)
9. [Security Testing](#9-security-testing)
10. [Accessibility Testing](#10-accessibility-testing)
11. [Mutation Testing](#11-mutation-testing)
12. [Contract Testing](#12-contract-testing)
13. [Database Testing](#13-database-testing)
14. [Code Quality & Static Analysis](#14-code-quality--static-analysis)
15. [CI/CD Pipeline](#15-cicd-pipeline)
16. [Monitoring & Observability](#16-monitoring--observability)
17. [Chaos & Resilience Testing](#17-chaos--resilience-testing)
18. [API Documentation & Testing](#18-api-documentation--testing)
19. [Test Data Management](#19-test-data-management)
20. [Execution Schedule](#20-execution-schedule)
21. [Gap Analysis & Roadmap](#21-gap-analysis--roadmap)

---

## 1. Current State Audit

### What Exists ✅

| Dimension | Automate | Dashboard | Notes |
|---|---|---|---|
| **Unit tests** | 440 tests (server 57, web 53, shared 22, SDK 10, connectors 298) | 1,699 tests (server 1,055, client 644) | Strong foundation |
| **Coverage thresholds** | Server: 97% stmt / 88% branch | Server: 93% stmt / 81% branch, Client: 93% stmt / 83% branch | Enforced in vitest.config |
| **E2E tests** | 6 specs (chat, conversations, health, settings, sql-browser, vault) | 8 specs (a11y, api, auth, dashboard, feature-flags, mobile, ui) + global setup | Chromium only |
| **Mutation testing** | Stryker (vitest runner), 10 files, break threshold 75% | Stryker (command runner), full route/service/component coverage, break 75% | Already configured |
| **ESLint** | Flat config, `no-explicit-any: error`, `test-flakiness` plugin | Legacy config, `test-flakiness` + `eslint-plugin-playwright` | Both enforce strict TS |
| **Pre-commit hooks** | ❌ None | ✅ Husky + lint-staged (ESLint auto-fix) | Gap in Automate |
| **Docker** | ✅ docker-compose + Ollama sidecar | ✅ docker-compose + nginx profile + healthcheck | Production-ready |
| **Smoke tests** | ✅ `scripts/smoke-automate.ts` — 12 structural checks | ❌ None | Gap in Dashboard |
| **Performance seed** | ❌ None | ✅ `scripts/seed-test-data.ts` — 10K row benchmark | Dashboard only |
| **Coverage reporters** | text, json, html, lcov | text, json, html, lcov | Both comprehensive |

### What's Missing ❌

| Gap | Severity | Impact |
|---|---|---|
| **No CI/CD pipeline** | 🔴 Critical | No automated gate. Everything runs manually. |
| **No GitHub Actions workflows** | 🔴 Critical | No `.github/workflows/` directory exists |
| **No visual regression testing** | 🟡 Medium | UI breakage undetected |
| **No performance/load testing** | 🟡 Medium | API latency regressions undetected |
| **No security scanning** | 🔴 Critical | No SAST, no dependency audit, no secret scanning |
| **No accessibility CI** | 🟡 Medium | WCAG violations only caught in Dashboard E2E |
| **No bundle analysis** | 🟢 Low | Bundle size regressions undetected |
| **No API contract testing** | 🟡 Medium | Client/server schema drift possible despite shared Zod |
| **No chaos/resilience testing** | 🟢 Low | Failure recovery untested |
| **No monitoring/error tracking** | 🟡 Medium | Sentry DSN configured but not active |
| **No dead code detection** | 🟢 Low | Unused exports accumulate |
| **Automate pre-commit hooks** | 🟡 Medium | Code ships without lint check |

---

## 2. QA Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          QA AUTOMATION PIPELINE                            │
│                                                                             │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────┐   ┌──────────────┐  │
│  │  PRE-COMMIT  │──▶│  PR PIPELINE  │──▶│  MERGE GATE  │──▶│  SCHEDULED   │  │
│  │             │   │              │   │             │   │              │  │
│  │ • Husky     │   │ • Lint       │   │ • Build     │   │ • Mutation   │  │
│  │ • lint-staged│   │ • Typecheck  │   │ • E2E       │   │ • Load test  │  │
│  │ • Commitlint│   │ • Unit tests │   │ • Visual    │   │ • Security   │  │
│  │ • gitleaks  │   │ • Coverage   │   │ • a11y      │   │ • Lighthouse │  │
│  │             │   │ • Semgrep    │   │ • Bundle    │   │ • OWASP ZAP  │  │
│  │             │   │ • npm audit  │   │ • Contract  │   │ • Knip       │  │
│  └─────────────┘   └──────────────┘   └─────────────┘   └──────────────┘  │
│                                                                             │
│                          ┌──────────────────┐                               │
│                          │  REPORTING LAYER  │                               │
│                          │                  │                               │
│                          │ • Vitest HTML    │                               │
│                          │ • Playwright HTML│                               │
│                          │ • Stryker HTML   │                               │
│                          │ • Lighthouse CI  │                               │
│                          │ • Coverage LCOV  │                               │
│                          │ • Sentry         │                               │
│                          └──────────────────┘                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Shift-left** — catch issues as early as possible (pre-commit > PR > merge > nightly)
2. **Fast feedback** — PR pipeline completes in < 5 minutes
3. **Zero false negatives** — every gate must be deterministic
4. **Incremental** — only test what changed (Turborepo filtering, Playwright sharding)
5. **Free-tier sustainable** — every tool runs without paid subscriptions

---

## 3. Testing Pyramid

```
                    ╱╲
                   ╱  ╲         E2E / Visual / a11y
                  ╱    ╲        Playwright + Argos
                 ╱──────╲       ~15 specs per project
                ╱        ╲
               ╱          ╲     Integration / Contract
              ╱            ╲    Fastify inject + Zod validation
             ╱──────────────╲   ~50-100 per project
            ╱                ╲
           ╱                  ╲  Unit / Component
          ╱                    ╲ Vitest + Testing Library
         ╱────────────────────╲  2,000+ tests
        ╱                      ╲
       ╱       Static Analysis   ╲ ESLint + TypeScript + Semgrep + Knip
      ╱────────────────────────────╲ Always-on
```

**Target distribution:**
- 70% Unit tests (fast, isolated, in-memory)
- 20% Integration tests (Fastify inject, DB, Zod contracts)
- 10% E2E tests (Playwright, visual, accessibility)
- ∞ Static analysis (runs on every keystroke)

---

## 4. Unit Testing

### Current Setup

Both projects use **Vitest 4** with `globals: true`, `clearMocks: true`, `restoreMocks: true`.

| Project | Tests | Environment | Coverage Provider |
|---|---|---|---|
| Automate Server | 57 | `node` | `v8` |
| Automate Web | 53 | `jsdom` | `v8` |
| Automate Shared | 22 | `node` | `v8` |
| Automate SDK | 10 | `node` | `v8` |
| Automate Connectors | 298 | `node` | `v8` |
| Dashboard Server | 1,055 | `node` | `v8` |
| Dashboard Client | 644 | `jsdom` | `v8` |

### Tool Stack

| Tool | Purpose | Status |
|---|---|---|
| `vitest@4` | Test runner | ✅ Installed |
| `@vitest/coverage-v8` | Code coverage (V8 engine) | ✅ Installed |
| `@testing-library/react` | React component testing | ✅ Dashboard client |
| `vitest-axe` | Accessibility assertions in unit tests | 🔲 **Add** |
| `@vitest/ui` | Browser-based test explorer | 🔲 **Add** |
| `eslint-plugin-test-flakiness` | Lint flaky test patterns | ✅ Both projects |

### Coverage Thresholds (enforced)

| Project | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| Automate Server | 97% | 88% | 96% | 98% |
| Dashboard Server | 93% | 81% | 95% | 94% |
| Dashboard Client | 93% | 83% | 93% | 96% |

### Best Practices

```typescript
// ✅ Pattern: Fastify route test with inject
import { buildApp } from '../app.js';

describe('POST /api/conversations', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates conversation and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: { title: 'Test' },
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.payload)).toMatchObject({
      id: expect.any(String),
      title: 'Test',
    });
  });

  it('returns 400 on invalid payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});
```

```typescript
// ✅ Pattern: React component test with Testing Library
import { render, screen } from '@testing-library/react';
import { ConversationList } from './ConversationList.js';

it('renders empty state when no conversations', () => {
  render(<ConversationList conversations={[]} />);
  expect(screen.getByText(/no conversations/i)).toBeInTheDocument();
});
```

### Commands

```bash
# All tests
pnpm test
pnpm --parallel run test

# Single package
pnpm --filter @automate/api test
pnpm --filter @automate/unified-web test

# Single file
pnpm --filter @automate/api exec vitest run src/routes/chat.test.ts

# With coverage
pnpm --filter @automate/api exec vitest run --coverage

# Watch mode (development)
pnpm --filter @automate/api exec vitest

# UI explorer
pnpm --filter @automate/api exec vitest --ui
```

---

## 5. Integration Testing

### Strategy

Integration tests validate module boundaries: routes ↔ services ↔ database ↔ external APIs.

| Layer | Approach | Tool |
|---|---|---|
| **HTTP routes** | `fastify.inject()` | Vitest + Fastify built-in |
| **Database** | In-memory SQLite via `better-sqlite3` | Vitest |
| **WebSocket** | `ws` client against test server | Vitest |
| **External APIs** | Mocked at HTTP level (`msw`) | `msw@2` |

### Add: MSW (Mock Service Worker)

For connector integration tests (GitHub, Jira, Slack), use MSW to intercept real HTTP calls:

```bash
pnpm --filter @automate/api add -D msw@2
```

```typescript
// ✅ Pattern: Integration test with MSW
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const server = setupServer(
  http.post('https://api.github.com/repos/:owner/:repo/issues', () => {
    return HttpResponse.json({ id: 1, number: 42, title: 'Test Issue' });
  }),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

it('creates GitHub issue via connector', async () => {
  const result = await githubConnector.createIssue({
    owner: 'test', repo: 'test', title: 'Test Issue',
  });
  expect(result.number).toBe(42);
});
```

### WebSocket Integration Tests

```typescript
// ✅ Pattern: WebSocket test for reporter ingestion
import WebSocket from 'ws';

it('receives test result events via WebSocket', async () => {
  const ws = new WebSocket('ws://localhost:4001');

  const message = await new Promise((resolve) => {
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'test:start', testId: 't1' }));
    });
    ws.on('message', (data) => resolve(JSON.parse(data.toString())));
  });

  expect(message).toMatchObject({ type: 'ack' });
  ws.close();
});
```

---

## 6. End-to-End Testing

### Current Setup

| Project | Specs | Browser | Runner |
|---|---|---|---|
| Automate | 6 (chat, conversations, health, settings, sql-browser, vault) | Chromium | Playwright |
| Dashboard | 8 (a11y, api, auth, dashboard, feature-flags, mobile, ui) | Chromium (+ auth project) | Playwright |

### Configuration (already exists)

Both projects have `playwright.config.ts` with:
- `fullyParallel: true`
- `forbidOnly: !!process.env.CI`
- `retries: 2` (CI) / `0-1` (local)
- `trace: 'on-first-retry'`
- `webServer` configs for API + client

Dashboard additionally has:
- `screenshot: 'only-on-failure'`
- `video: 'retain-on-failure'`
- Custom `ws-reporter` (dogfood testing)
- `globalSetup` for test data seeding
- Auth project with dependency ordering

### Add: Multi-Browser Support

```typescript
// playwright.config.ts — add Firefox and WebKit
projects: [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
],
```

### Add: Playwright Test Sharding (CI)

```yaml
# In GitHub Actions — shard across 4 workers
strategy:
  matrix:
    shard: [1/4, 2/4, 3/4, 4/4]
steps:
  - run: npx playwright test --shard=${{ matrix.shard }}
```

### E2E Test Categories

| Category | Automate Specs | Dashboard Specs |
|---|---|---|
| Smoke/Health | `health.spec.ts` | `api.spec.ts` |
| Authentication | — | `auth-flow.spec.ts` |
| Core Flows | `chat-flow.spec.ts`, `conversations.spec.ts` | `dashboard.spec.ts`, `ui.spec.ts` |
| Settings/Config | `settings.spec.ts` | `feature-flags.spec.ts` |
| Security | `vault.spec.ts` | — |
| Accessibility | — | `accessibility.spec.ts` |
| Mobile | — | `mobile.spec.ts` |
| Data Entry | `sql-browser.spec.ts` | — |

### Commands

```bash
# All E2E
npx playwright test
pnpm test:e2e

# Single spec
npx playwright test e2e/chat-flow.spec.ts

# Headed (debug)
npx playwright test --headed

# With trace viewer
npx playwright test --trace on
npx playwright show-trace test-results/*/trace.zip

# Generate tests interactively
npx playwright codegen http://localhost:5173
```

---

## 7. Visual Regression Testing

### Tool: Playwright Built-in Screenshots (`toHaveScreenshot()`)

> **Decision**: Using Playwright's built-in visual comparison instead of Argos CI. Argos CI has a 5K screenshot/month free limit and requires a paid subscription for team use. Playwright's `toHaveScreenshot()` is unlimited, fully free, and requires zero external service setup.

| Tool | Free Tier | What It Does |
|---|---|---|
| **Playwright `toHaveScreenshot()`** | ✅ Unlimited | Pixel-level pixel comparison built into Playwright, baselines stored in git |

### How It Works

Playwright generates PNG baseline images on first run and stores them in `e2e/__screenshots__/`. Subsequent runs diff against the baseline. Changed screenshots fail CI and diff images are uploaded as artifacts for review.

```typescript
// e2e/visual-regression.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Visual Regression', () => {
  test('dashboard overview page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveScreenshot('dashboard-overview.png', {
      maxDiffPixelRatio: 0.02, // 2% tolerance for anti-aliasing
    });
  });

  test('run detail page', async ({ page }) => {
    await page.goto('/runs/latest');
    await expect(page).toHaveScreenshot('run-detail.png');
  });

  test('analytics charts', async ({ page }) => {
    await page.goto('/analytics');
    await page.waitForSelector('[data-testid="pass-rate-chart"]');
    await expect(page).toHaveScreenshot('analytics.png');
  });

  test('dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect(page).toHaveScreenshot('dashboard-dark-mode.png');
  });

  test('mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await argosScreenshot(page, 'dashboard-mobile');
  });

  test('RTL layout (Hebrew)', async ({ page }) => {
    await page.goto('/?lang=he');
    await argosScreenshot(page, 'dashboard-rtl');
  });
});
```

### When to Run

- **PR pipeline**: On every pull request (screenshot comparison against main)
- **Main merge**: Update baseline screenshots

---

## 8. Performance Testing

### 8.1 API Load Testing — k6

| Tool | Why | Free Tier |
|---|---|---|
| **k6** (Grafana) | JavaScript-native, best DX, Grafana Cloud integration | 50K VUs/month on Grafana Cloud, unlimited self-hosted |

```bash
# Install k6
# Windows: winget install Grafana.k6
# Mac: brew install k6
# Linux: snap install k6
```

```javascript
// perf/api-load.js — Automate API
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const latency = new Trend('api_latency');

export const options = {
  stages: [
    { duration: '30s', target: 20 },   // Ramp up
    { duration: '1m', target: 50 },    // Sustained load
    { duration: '30s', target: 100 },  // Peak
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.05'],
  },
};

export default function () {
  group('Health Check', () => {
    const res = http.get('http://localhost:3000/health');
    check(res, { 'health 200': (r) => r.status === 200 });
    latency.add(res.timings.duration);
  });

  group('List Conversations', () => {
    const res = http.get('http://localhost:3000/api/conversations');
    check(res, {
      'conversations 200': (r) => r.status === 200,
      'has array': (r) => Array.isArray(JSON.parse(r.body)),
    });
    errorRate.add(res.status !== 200);
    latency.add(res.timings.duration);
  });

  group('Create Conversation', () => {
    const res = http.post(
      'http://localhost:3000/api/conversations',
      JSON.stringify({ title: `Load Test ${Date.now()}` }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    check(res, { 'created 201': (r) => r.status === 201 });
    errorRate.add(res.status !== 201);
  });

  sleep(1);
}
```

```javascript
// perf/dashboard-load.js — Dashboard API
import http from 'k6/http';
import { check, sleep, group } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 30 },
    { duration: '2m', target: 100 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<300', 'p(99)<800'],
    http_req_failed: ['rate<0.01'],
  },
};

const API_KEY = __ENV.API_KEY || 'test-api-key';
const BASE = __ENV.BASE_URL || 'http://localhost:4000';
const headers = {
  'Content-Type': 'application/json',
  'Cookie': `session=${API_KEY}`,
};

export default function () {
  group('Runs List', () => {
    const res = http.get(`${BASE}/api/runs`, { headers });
    check(res, { 'runs 200': (r) => r.status === 200 });
  });

  group('Tests List (large)', () => {
    const res = http.get(`${BASE}/api/runs/latest/tests?limit=1000`, { headers });
    check(res, { 'tests 200': (r) => r.status === 200 });
  });

  group('Analytics', () => {
    const res = http.get(`${BASE}/api/analytics/pass-rate?days=30`, { headers });
    check(res, { 'analytics 200': (r) => r.status === 200 });
  });

  sleep(0.5);
}
```

### 8.2 Frontend Performance — Lighthouse CI

```bash
pnpm add -D @lhci/cli
```

```javascript
// lighthouserc.js
module.exports = {
  ci: {
    collect: {
      url: [
        'http://localhost:5173/',
        'http://localhost:5173/runs',
        'http://localhost:5173/analytics',
      ],
      numberOfRuns: 3,
      startServerCommand: 'pnpm dev',
      startServerReadyPattern: 'Local:',
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.8 }],
        'categories:accessibility': ['warn', { minScore: 0.9 }],
        'categories:best-practices': ['warn', { minScore: 0.9 }],
        'categories:seo': ['warn', { minScore: 0.8 }],
        'first-contentful-paint': ['error', { maxNumericValue: 2000 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 3000 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['error', { maxNumericValue: 300 }],
      },
    },
    upload: {
      target: 'temporary-public-storage', // Free, no account needed
    },
  },
};
```

### 8.3 Bundle Size Analysis

```bash
# Install
pnpm --filter @automate/unified-web add -D vite-bundle-visualizer
pnpm --filter @automate/unified-web add -D vite-bundle-visualizer

# Run
pnpm --filter @automate/unified-web exec vite-bundle-visualizer
pnpm --filter @automate/unified-web exec vite-bundle-visualizer
```

**CI Bundle Guard** — fail if bundle exceeds threshold:

```javascript
// scripts/bundle-guard.mjs
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const DIST = process.argv[2] || 'dist';
const MAX_JS_KB = Number(process.argv[3]) || 500;
const MAX_CSS_KB = Number(process.argv[4]) || 100;

function getSize(dir, ext) {
  let total = 0;
  for (const f of readdirSync(dir, { recursive: true })) {
    if (f.endsWith(ext)) total += statSync(join(dir, f)).size;
  }
  return total / 1024;
}

const jsKB = getSize(DIST, '.js').toFixed(1);
const cssKB = getSize(DIST, '.css').toFixed(1);

console.log(`JS: ${jsKB} KB (limit: ${MAX_JS_KB} KB)`);
console.log(`CSS: ${cssKB} KB (limit: ${MAX_CSS_KB} KB)`);

if (jsKB > MAX_JS_KB) { console.error('❌ JS bundle too large'); process.exit(1); }
if (cssKB > MAX_CSS_KB) { console.error('❌ CSS bundle too large'); process.exit(1); }
console.log('✅ Bundle size OK');
```

### 8.4 Autocannon — Quick Benchmarks

```bash
pnpm add -D autocannon
```

```bash
# Quick benchmark
npx autocannon -c 100 -d 10 http://localhost:3000/health
npx autocannon -c 50 -d 30 http://localhost:4000/api/runs
```

### Performance Budget

| Metric | Target | Tool |
|---|---|---|
| API p95 latency | < 500ms | k6 |
| API p99 latency | < 1000ms | k6 |
| API error rate | < 1% | k6 |
| FCP | < 2s | Lighthouse CI |
| LCP | < 3s | Lighthouse CI |
| CLS | < 0.1 | Lighthouse CI |
| TBT | < 300ms | Lighthouse CI |
| JS bundle | < 500 KB | bundle-guard |
| CSS bundle | < 100 KB | bundle-guard |

---

## 9. Security Testing

### 9.1 SAST — Semgrep

```bash
# Install
pip install semgrep
# or via Docker
docker pull semgrep/semgrep
```

```yaml
# .semgrep.yml — custom rules for this project
rules:
  - id: no-vault-password-log
    patterns:
      - pattern: console.log(..., $PASSWORD, ...)
      - metavariable-regex:
          metavariable: $PASSWORD
          regex: '.*(password|secret|token|key|credential).*'
    message: "Never log secrets"
    severity: ERROR
    languages: [typescript]

  - id: no-raw-sql
    pattern: db.prepare($QUERY)
    message: "Use parameterized queries via Drizzle ORM, not raw SQL"
    severity: WARNING
    languages: [typescript]
    paths:
      exclude:
        - '**/scripts/**'
        - '**/*.test.ts'

  - id: zod-safeParse-required
    patterns:
      - pattern: $SCHEMA.parse($INPUT)
      - pattern-not: $SCHEMA.safeParse($INPUT)
    message: "Use safeParse() instead of parse() — never throw on user input"
    severity: WARNING
    languages: [typescript]
    paths:
      exclude:
        - '**/*.test.ts'
```

### 9.2 Dependency Scanning

| Tool | What | Integration |
|---|---|---|
| `npm audit` | CVE database check | `pnpm audit` in CI |
| **Socket.dev** | Malware + supply chain detection | GitHub App (free 5 repos) |
| **Dependabot** | Automated dependency PRs | GitHub native (free) |

```bash
# CI command
pnpm audit --audit-level=high
```

### 9.3 Secret Scanning — gitleaks

```bash
# Install
# Windows: winget install Gitleaks
# Mac: brew install gitleaks
# Linux: go install github.com/gitleaks/gitleaks/v8@latest
```

```toml
# .gitleaks.toml
title = "Automate gitleaks config"

[allowlist]
  paths = [
    '''\.env\.example''',
    '''test-results''',
    '''node_modules''',
  ]
```

```bash
# Pre-commit hook
gitleaks protect --staged --verbose

# Full repo scan
gitleaks detect --source . --verbose
```

### 9.4 DAST — OWASP ZAP (Scheduled)

```bash
# Docker-based baseline scan
docker run -t zaproxy/zap-stable zap-baseline.py \
  -t http://localhost:3000 \
  -r zap-automate-report.html

docker run -t zaproxy/zap-stable zap-baseline.py \
  -t http://localhost:4000 \
  -r zap-dashboard-report.html
```

### 9.5 Security Checklist (Continuous)

| Check | Tool | Frequency |
|---|---|---|
| Known CVEs in deps | `pnpm audit` | Every PR |
| Secrets in code | `gitleaks` | Pre-commit + every PR |
| SAST rules | Semgrep | Every PR |
| DAST baseline | OWASP ZAP | Weekly |
| Supply chain attacks | Socket.dev | Every PR (via GitHub App) |
| Dependency updates | Dependabot | Weekly PRs |
| Docker image scan | `docker scout` | On Dockerfile change |

---

## 10. Accessibility Testing

### Multi-Layer Strategy

| Layer | Tool | When |
|---|---|---|
| **Component** | `vitest-axe` | Unit tests (every PR) |
| **E2E** | `@axe-core/playwright` | E2E suite (every PR) |
| **Full-site audit** | Playwright + axe | Nightly |
| **Manual** | Lighthouse a11y score | Lighthouse CI run |

### Setup: vitest-axe

```bash
pnpm --filter @automate/unified-web add -D vitest-axe
pnpm --filter @automate/unified-web add -D vitest-axe
```

```typescript
// src/test/setup.ts — add axe matchers
import 'vitest-axe/extend-expect';
```

```typescript
// Component test with accessibility check
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { RunCard } from './RunCard.js';

it('RunCard has no accessibility violations', async () => {
  const { container } = render(<RunCard run={mockRun} />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

### Setup: @axe-core/playwright (already in Dashboard)

```typescript
// e2e/accessibility.spec.ts — already exists in Dashboard
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility', () => {
  test('dashboard page meets WCAG 2.1 AA', async ({ page }) => {
    await page.goto('/');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('run detail page meets WCAG 2.1 AA', async ({ page }) => {
    await page.goto('/runs/latest');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
```

### Accessibility Budget

| Standard | Target | Status |
|---|---|---|
| WCAG 2.1 Level AA | 100% compliance | E2E enforced |
| Lighthouse a11y score | ≥ 90 | Lighthouse CI |
| Component-level violations | 0 | vitest-axe |

---

## 11. Mutation Testing

### Current Setup

Both projects already have Stryker configured:

| Project | Runner | Mutated Files | Break Threshold |
|---|---|---|---|
| Automate | `vitest` | 10 files (routes, agent, services) | 75% |
| Dashboard | `command` | Routes, services, components, hooks, stores, lib | 75% |

### Stryker Configuration (already exists)

**Automate** — `stryker.config.json`:
- Vitest runner, incremental mode
- Mutates: routes (vault, chat, model-config, ws, connectors, conversations), agent (planner, orchestrator-loop), connectors/registry, services/event-hub

**Dashboard** — `stryker.conf.json`:
- Command runner (`pnpm test`), 4 concurrent workers
- Mutates: `apps/server/src/routes/**`, `apps/server/src/services/**`, `apps/client/src/components/**`, `apps/client/src/hooks/**`, `apps/client/src/lib/**`, `apps/client/src/store/**`
- Excludes: tests, test-utils, index.ts, types.ts, .d.ts

### Commands

```bash
# Automate
npx stryker run

# Dashboard
npx stryker run

# Automate packages only
npx stryker run --configFile stryker-packages.config.json
```

### Mutation Score Targets

| Threshold | Value | Action |
|---|---|---|
| `high` | 90% | Green — excellent |
| `low` | 70% | Yellow — needs improvement |
| `break` | 75% | Red — build fails |

### When to Run

- **Nightly** scheduled job (too slow for PR pipeline)
- **On-demand** for critical path changes
- **Weekly** full report with trend tracking

---

## 12. Contract Testing

### Strategy: Zod Schemas as Single Source of Truth

Both projects share Zod schemas between client and server via `packages/shared/`. This is the contract layer.

| Project | Schema Location | Zod Version |
|---|---|---|
| Automate | `packages/shared/` | Zod v4 (`zod/v4`) |
| Dashboard | `packages/shared/` | Zod v3 (`zod`) |

### Contract Validation Tests

```typescript
// packages/shared/src/schemas.contract.test.ts
import { ConversationSchema, CreateConversationBody } from './schemas.js';

describe('Contract: Conversation schemas', () => {
  it('CreateConversationBody produces valid Conversation', () => {
    const input = CreateConversationBody.parse({ title: 'Test' });
    const output = ConversationSchema.safeParse({
      ...input,
      id: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: new Date().toISOString(),
      messages: [],
    });

    expect(output.success).toBe(true);
  });

  it('rejects extra fields (strict)', () => {
    const result = CreateConversationBody.safeParse({
      title: 'Test',
      __proto__: { admin: true }, // prototype pollution
    });

    // Zod strips unknown fields by default
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('admin');
  });
});
```

### API Contract Tests with Vitest + Fastify.inject() *(replaces Hurl)*

```bash
# Install Hurl
# Windows: winget install Orange.Hurl
# Mac: brew install hurl
# Linux: snap install hurl
```

### API Contract Tests with Vitest + Fastify.inject()

> **Decision**: Using Vitest + Fastify.inject() instead of Hurl for contract testing. Hurl requires a running server and separate installation. Fastify.inject() runs in-process — faster, no external process needed, and integrates with the existing Vitest setup.

```typescript
// apps/server/src/routes/contract.test.ts — Automate contract tests
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { buildApp } from '../app.js';
import { ConversationSchema } from '@automate/shared-contracts';

let app: ReturnType<typeof Fastify>;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(() => app.close());

describe('Contract: Automate API', () => {
  it('GET /health returns status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('status', 'ok');
  });

  it('POST /api/conversations creates and returns valid Conversation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: { title: 'Contract Test' },
    });
    expect(res.statusCode).toBe(201);
    const result = ConversationSchema.safeParse(res.json());
    expect(result.success).toBe(true);
  });
});
```

```typescript
// apps/server/src/routes/contract.test.ts — Dashboard contract tests
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { buildApp } from '../app.js';
import { RunSchema } from '@apps/api-shared';
import { z } from 'zod';

let app: ReturnType<typeof Fastify>;
const sessionCookie = 'session=test-api-key';

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(() => app.close());

describe('Contract: Dashboard API', () => {
  it('GET /health returns live status', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/runs returns array of RunSchema', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/runs',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const result = z.array(RunSchema).safeParse(res.json());
    expect(result.success).toBe(true);
  });
});
```

```bash
# Run contract tests (integrated with pnpm test — no separate command needed)
pnpm --filter @automate/api exec vitest run src/routes/contract.test.ts
pnpm --filter @automate/api exec vitest run src/routes/contract.test.ts
```

---

## 13. Database Testing

### Strategy

| Approach | Use Case | Speed |
|---|---|---|
| **In-memory SQLite** | Unit tests (isolated, fast) | ~1ms/test |
| **File-based SQLite** | Integration tests (realistic) | ~5ms/test |
| **Drizzle migrations** | Schema validation | Setup only |

### Database Test Utilities

```typescript
// test-utils/db.ts — shared database factory
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';

export function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  // Apply schema (mirrors db:push behavior)
  // Use raw SQL to create tables for in-memory testing
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- ... more tables
  `);

  return { db, sqlite, cleanup: () => sqlite.close() };
}
```

```typescript
// Database integration test
import { createTestDb } from '../test-utils/db.js';

describe('ConversationService', () => {
  let testDb: ReturnType<typeof createTestDb>;

  beforeEach(() => { testDb = createTestDb(); });
  afterEach(() => { testDb.cleanup(); });

  it('creates and retrieves conversation', async () => {
    const service = new ConversationService(testDb.db);
    const created = await service.create({ title: 'Test' });
    const found = await service.getById(created.id);

    expect(found).toMatchObject({ title: 'Test' });
  });
});
```

### Migration Testing

```typescript
// db/migrations.test.ts
it('migrations apply without errors', async () => {
  const { db, cleanup } = createTestDb();

  // Drizzle push should not throw
  expect(() => {
    // Apply all schema changes
    pushSchema(db);
  }).not.toThrow();

  cleanup();
});
```

---

## 14. Code Quality & Static Analysis

### Tool Stack

| Tool | Purpose | Status | Action |
|---|---|---|---|
| **ESLint** | Linting | ✅ Both projects | Standardize configs |
| **TypeScript strict** | Type safety | ✅ Both projects | Already strict |
| **Prettier** | Formatting | 🔲 **Add** | Consistent formatting |
| **Knip** | Dead code / unused exports | 🔲 **Add** | Remove dead code |
| **eslint-plugin-test-flakiness** | Flaky test patterns | ✅ Both projects | Already configured |
| **eslint-plugin-playwright** | E2E best practices | ✅ Dashboard | Add to Automate |
| **Commitlint** | Commit message format | 🔲 **Add** | Consistent commit messages |

### Add: Knip (Dead Code Detection)

```bash
pnpm add -D knip -w
```

```json
// knip.json (root)
{
  "$schema": "https://unpkg.com/knip@latest/schema.json",
  "workspaces": {
    "Automate/apps/server": {
      "entry": ["src/index.ts"],
      "ignore": ["**/*.test.ts"]
    },
    "Automate/apps/web": {
      "entry": ["src/main.tsx"],
      "ignore": ["**/*.test.tsx"]
    },
    "Automate/apps/server": {
      "entry": ["src/index.ts"],
      "ignore": ["**/*.test.ts"]
    },
    "Automate/apps/client": {
      "entry": ["src/main.tsx"],
      "ignore": ["**/*.test.tsx", "src/routeTree.gen.ts"]
    }
  }
}
```

```bash
# Find unused exports
npx knip

# Find unused dependencies
npx knip --dependencies

# Fix auto-fixable issues
npx knip --fix
```

### Add: Prettier

```bash
pnpm add -D prettier -w
```

```json
// .prettierrc
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

### Add: Commitlint

```bash
pnpm add -D @commitlint/cli @commitlint/config-conventional -w
```

```javascript
// commitlint.config.js
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [2, 'always', [
      'automate', 'dashboard', 'shared', 'ci', 'docs',
      'server', 'client', 'web', 'connectors', 'reporter',
    ]],
  },
};
```

### Add: Husky to Automate

```bash
pnpm add -D husky lint-staged
npx husky init
```

```bash
# .husky/pre-commit
pnpm lint-staged
gitleaks protect --staged --verbose
```

```bash
# .husky/commit-msg
npx commitlint --edit $1
```

```json
// package.json — add lint-staged config
{
  "lint-staged": {
    "apps/server/src/**/*.ts": ["eslint --fix"],
    "apps/web/src/**/*.{ts,tsx}": ["eslint --fix"],
    "packages/**/*.ts": ["eslint --fix"]
  }
}
```

---

## 15. CI/CD Pipeline

### 🔴 CRITICAL: No pipeline exists. Build from scratch.

### Two-Repo Architecture — Critical Constraint

> **Both repos are INDEPENDENT git repositories.** CI workflows CANNOT share a single `.github/` directory.
> - `Automate/.github/workflows/` — for Automate repo
> - `Automate/.github/workflows/` — for Dashboard repo (which is the QA superproject root)
>
> Each repo needs its own: `ci.yml`, `e2e.yml`, `security.yml`, `nightly.yml`, `dependabot.yml`

### File Structure

```
Automate/.github/
  workflows/
    ci.yml              # PR pipeline (lint, typecheck, test, build) — Turborepo
    e2e.yml             # E2E Playwright (health/vault/settings only in PR; full AI E2E nightly)
    security.yml        # Semgrep + pnpm audit + gitleaks + Trivy
    nightly.yml         # Stryker mutation + full AI E2E with Ollama sidecar
  dependabot.yml

Automate/.github/
  workflows/
    ci.yml              # PR pipeline (lint, typecheck, test, build) — path-filtered
    e2e.yml             # E2E Playwright (full suite in CI, no Ollama dependency)
    security.yml        # Semgrep + pnpm audit + gitleaks + Trivy + license compliance
    nightly.yml         # Stryker mutation + Lighthouse CI + k6
  dependabot.yml
```

### CI Caching Strategy

All workflows use pnpm store caching and (for Automate) Turborepo remote cache:

```yaml
# Standard job setup — use in ALL jobs
steps:
  - uses: actions/checkout@v4
  - uses: pnpm/action-setup@v4
    with:
      version: 10
      run_install: false
  - uses: actions/setup-node@v4
    with:
      node-version-file: '.nvmrc'   # Use .nvmrc, not hardcoded version
      cache: 'pnpm'                 # Caches pnpm store automatically
  - run: pnpm install --frozen-lockfile
```

### Path Filtering with dorny/paths-filter (Dashboard only)

Dashboard has no Turborepo — use path-based filtering to skip tests for unchanged packages:

```yaml
jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      server: ${{ steps.filter.outputs.server }}
      client: ${{ steps.filter.outputs.client }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            server:
              - 'apps/server/**'
              - 'packages/shared/**'
            client:
              - 'apps/client/**'
              - 'packages/shared/**'

  test-server:
    needs: changes
    if: ${{ needs.changes.outputs.server == 'true' }}
    # ... run server tests
```

### ci.yml — Pull Request Pipeline (< 5 min target)

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # ─── Stage 1: Static Analysis (parallel) ───
  lint:
    name: Lint & Typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile

      # Parallel lint + typecheck for both projects
      - name: Lint Automate
        run: pnpm lint
        working-directory: Automate

      - name: Lint Dashboard
        run: pnpm lint
        working-directory: Automate

      - name: Typecheck Automate
        run: pnpm typecheck
        working-directory: Automate

      - name: Typecheck Dashboard
        run: pnpm typecheck
        working-directory: Automate

  # ─── Stage 2: Unit Tests (parallel per project) ───
  test-automate:
    name: Test Automate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
        working-directory: Automate
      - name: Run tests with coverage
        run: pnpm test -- --coverage
        working-directory: Automate
      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: coverage-automate
          path: Automate/**/coverage/lcov.info

  test-dashboard:
    name: Test Dashboard
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
        working-directory: Automate
      - name: Run server tests with coverage
        run: pnpm --filter @automate/api test -- --coverage
        working-directory: Automate
      - name: Run client tests with coverage
        run: pnpm --filter @automate/unified-web test -- --coverage
        working-directory: Automate
      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: coverage-dashboard
          path: Automate/**/coverage/lcov.info

  # ─── Stage 3: Build (depends on lint + tests) ───
  build:
    name: Build
    needs: [lint, test-automate, test-dashboard]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Install & Build Automate
        run: |
          pnpm install --frozen-lockfile
          pnpm build
        working-directory: Automate

      - name: Install & Build Dashboard
        run: |
          pnpm install --frozen-lockfile
          pnpm build
        working-directory: Automate

      - name: Bundle size guard (Dashboard)
        run: node scripts/bundle-guard.mjs apps/client/dist 500 100
        working-directory: Automate

  # ─── Stage 4: Security (parallel with tests) ───
  security:
    name: Security Scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Dependency audit (Automate)
        run: pnpm audit --audit-level=high || true
        working-directory: Automate

      - name: Dependency audit (Dashboard)
        run: pnpm audit --audit-level=high || true
        working-directory: Automate

      - name: Secret scanning
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  semgrep:
    name: Semgrep SAST
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: returntocorp/semgrep-action@v1
        with:
          config: 'auto'
```

### e2e.yml — E2E + Visual Regression (on merge)

```yaml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  e2e-dashboard:
    name: E2E Dashboard
    runs-on: ubuntu-latest
    strategy:
      matrix:
        shard: [1/4, 2/4, 3/4, 4/4]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
          run_install: false
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
        working-directory: Automate
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium
      - name: Run E2E tests (shard ${{ matrix.shard }})
        run: npx playwright test --shard=${{ matrix.shard }}
        working-directory: Automate
        env:
          AUTOMATE_DASHBOARD_API_KEY: test-api-key
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report-${{ strategy.job-index }}
          path: Automate/apps/server/test-results/
          retention-days: 14

  e2e-automate:
    name: E2E Automate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
          run_install: false
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
        working-directory: Automate
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium
      - name: Install Ollama
        run: curl -fsSL https://ollama.com/install.sh | sh
      - name: Pull model
        run: ollama pull llama3.1
      - name: Run E2E tests (PR: skip AI specs)
        if: github.event_name == 'pull_request'
        run: npx playwright test --grep-invert "chat|ai|conversation"
        working-directory: Automate
      - name: Run E2E tests (Full AI)
        if: github.event_name != 'pull_request'
        run: npx playwright test
        working-directory: Automate
      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report-automate
          path: Automate/test-results/
          retention-days: 14

  visual-regression:
    test('mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/');
      await expect(page).toHaveScreenshot('dashboard-mobile.png');
    });

    test('RTL layout (Hebrew)', async ({ page }) => {
      await page.goto('/?lang=he');
      await expect(page).toHaveScreenshot('dashboard-rtl.png');
    });
  });

}
```

```typescript
// apps/client/src/main.tsx — Sentry React
import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.01,
  replaysOnErrorSampleRate: 1.0,
});
```

### Uptime Monitoring

| Tool | Free Tier | Use |
|---|---|---|
| **UptimeRobot** | 5 monitors, 5-min intervals | Health endpoint checks |
| **Healthchecks.io** | 3 checks | Cron job monitoring |

### Health Endpoints (already exist)

- Automate: `GET /health` — DB + Ollama status
- Dashboard: `GET /health` + `GET /health/live` (Docker healthcheck)

---

## 17. Chaos & Resilience Testing

### Strategy: Toxiproxy + Custom Fault Injection

```bash
# Install Toxiproxy
# Docker: docker run -p 8474:8474 shopify/toxiproxy
# Direct: https://github.com/Shopify/toxiproxy/releases
```

### Resilience Test Scenarios

| Scenario | What It Tests | Tool |
|---|---|---|
| Ollama timeout | AI chat degrades gracefully | Toxiproxy latency |
| Database lock | SQLite WAL under contention | Concurrent writers |
| WebSocket disconnect | Reporter reconnection | Network proxy |
| Large payload | Memory limits | k6 with large bodies |
| Rate limiting | 429 responses work | autocannon burst |

```typescript
// resilience/ollama-timeout.test.ts
import { buildApp } from '../apps/server/src/app.js';

describe('Resilience: Ollama unavailable', () => {
  it('returns graceful error when Ollama is down', async () => {
    const app = await buildApp({
      logger: false,
      ollamaHost: 'http://localhost:99999', // unreachable
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        conversationId: 'test',
        message: 'hello',
      },
    });

    // Should not crash — should return meaningful error
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.payload).error).toContain('unavailable');
  });
});
```

```typescript
// resilience/concurrent-writes.test.ts
describe('Resilience: Concurrent database writes', () => {
  it('handles 50 concurrent conversation creates', async () => {
    const app = await buildApp({ logger: false });

    const promises = Array.from({ length: 50 }, (_, i) =>
      app.inject({
        method: 'POST',
        url: '/api/conversations',
        payload: { title: `Concurrent ${i}` },
      }),
    );

    const results = await Promise.all(promises);
    const successes = results.filter((r) => r.statusCode === 201);

    expect(successes.length).toBe(50);
  });
});
```

---

## 18. API Documentation & Testing

### OpenAPI from Zod — Fastify Swagger (Dashboard already has it)

Dashboard already uses `@fastify/swagger` + `@fastify/swagger-ui`. Extend to Automate.

```bash
pnpm --filter @automate/api add @fastify/swagger @fastify/swagger-ui
```

```typescript
// Automate — apps/server/src/plugins/swagger.ts
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

export async function registerSwagger(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Automate API',
        version: '1.0.0',
        description: 'AI-native QA orchestration API',
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });
}
```

### Contract Tests (see Section 12 — Vitest + Fastify.inject())

Run API contract tests as part of CI (integrated with Vitest — no separate command):

```bash
pnpm --filter @automate/api exec vitest run src/routes/contract.test.ts
pnpm --filter @automate/api exec vitest run src/routes/contract.test.ts
```

---

## 19. Test Data Management

### Factories & Fixtures

```typescript
// test-utils/factories.ts
import { randomUUID } from 'crypto';

export function createConversation(overrides = {}) {
  return {
    id: randomUUID(),
    title: 'Test Conversation',
    createdAt: new Date().toISOString(),
    messages: [],
    ...overrides,
  };
}

export function createRun(overrides = {}) {
  return {
    id: `run-${Date.now()}`,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: 'passed',
    total: 100,
    passed: 95,
    failed: 3,
    flaky: 2,
    skipped: 0,
    durationMs: 30000,
    ...overrides,
  };
}

export function createTest(runId: string, overrides = {}) {
  return {
    id: randomUUID(),
    runId,
    title: 'test case',
    file: 'tests/example.spec.ts',
    status: 'passed',
    durationMs: 500,
    ...overrides,
  };
}
```

### Seeding

```bash
# Dashboard performance seed (already exists)
pnpm seed:perf

# Dashboard demo data (already exists)
npx tsx scripts/seed-demo-data.ts
```

---

## 20. Execution Schedule

### Every Commit (Pre-commit hooks)

| Check | Time | Tool |
|---|---|---|
| ESLint auto-fix | ~2s | lint-staged |
| Secret scan | ~1s | gitleaks |
| Commit message format | <1s | commitlint |

### Every Pull Request (CI)

| Check | Time | Parallel Group |
|---|---|---|
| ESLint + Typecheck | ~60s | Group A |
| Unit tests (Automate) | ~30s | Group B |
| Unit tests (Dashboard) | ~60s | Group B |
| Coverage thresholds | ∈ tests | Group B |
| Security scan (Semgrep) | ~30s | Group C |
| Dependency audit | ~10s | Group C |
| **Total (parallel)** | **~90s** | |

### Every Merge to Main

| Check | Time | Notes |
|---|---|---|
| All PR checks | ~90s | Required |
| E2E tests (sharded) | ~3min | 4 shards |
| Visual regression | ~2min | Argos upload |
| Accessibility audit | ∈ E2E | axe-core |
| Build both projects | ~60s | Artifact upload |
| Bundle size guard | ~5s | Fail if exceeded |
| Contract tests (Vitest + Fastify.inject) | ~10s | API contracts |

### Nightly (2 AM)

| Check | Time | Notes |
|---|---|---|
| Mutation testing (Stryker) | ~60min | Full run both projects |
| OWASP ZAP baseline | ~15min | Docker-based |
| Full Lighthouse audit | ~5min | 3 runs per URL |
| Knip dead code scan | ~30s | Report only |

### Weekly (Monday 3 AM)

| Check | Time | Notes |
|---|---|---|
| k6 load test | ~5min | API performance baseline |
| Dependabot PRs | Auto | Dependency updates |
| Docker image scan | ~2min | `docker scout` |
| Full bundle analysis | ~1min | `vite-bundle-visualizer` |

---

## 21. Gap Analysis & Roadmap

> **Updated**: Reflecting newly discovered architectural gaps from Metis review + implementation planning.

### Architecture Discovery

| Finding | Impact |
|---|---|
| **Automate is a SEPARATE git repo** — `Automate/` has its own `.git/`. The QA root `.gitignore` excludes it. CI workflows CANNOT share a single `.github/` directory. Each repo needs its own `Automate/.github/workflows/` and `Automate/.github/workflows/` | 🔴 Critical — affects all CI work |
| **Dashboard Husky incomplete** — `package.json` has `"prepare": "husky"` but `.husky/` was never committed. Git hooks don't run until the dir is created | 🟡 Must fix before deploying |
| **Automate E2E depends on Ollama** — Running AI-dependent E2E in CI requires an Ollama sidecar with `llama3.1` pulled. CI strategy: skip AI-dependent specs in PRs (`--grep-invert "chat|ai|conversation"`). Full AI E2E only in nightly cron jobs. | 🟡 Impacts E2E workflow design |
| **Automate missing `.nvmrc`** — Dashboard has `.nvmrc: 22`, Automate doesn't | 🟢 Quick fix |
| **No CI caching strategy** — pnpm store cache and `.turbo` cache not configured — adds 2-5 min to every CI run | 🟡 Efficiency gap |
| **No Docker image scanning** — Container images not scanned for CVEs — add Trivy | 🔴 Security gap |
| **No license compliance checking** — Third-party dependency licenses not validated — add `license-checker-rseidelsohn` | 🟡 Compliance gap |
| **No TypeScript package validation** — Published packages not validated for correct exports, types, CJS/ESM compatibility — add `@arethetypeswrong/cli` and `publint` | 🟡 Quality gap |
| **No path-based test filtering** — CI runs ALL tests even for single-file changes — add `dorny/paths-filter` for targeted test execution | 🟡 Efficiency gap |
| **No flaky test quarantine lifecycle** — Auto-quarantine feature exists in Dashboard but no defined quarantine/unquarantine lifecycle for CI pipelines | 🟡 Reliability gap |

### Priority 1 — Critical (Do Now)

| # | Gap | Action | Effort |
|---|---|---|---|
| 1 | No CI/CD | Create `.github/workflows/ci.yml` in **both** repos | 2 hours |
| 2 | No security scanning | Add Semgrep + `pnpm audit` + gitleaks | 1 hour |
| 3 | No pre-commit hooks (Automate) | Add Husky + lint-staged | 30 min |
| 4 | No Dependabot | Create `.github/dependabot.yml` in both repos | 15 min |

### Priority 2 — High (This Sprint)

| # | Gap | Action | Effort |
|---|---|---|---|
| 5 | No E2E in CI | Create `e2e.yml` in both repos; skip Ollama-dependent specs in PR CI | 2 hours |
| 6 | No visual regression | Add `toHaveScreenshot()` specs with git-committed baselines (NO Argos CI) | 2 hours |
| 7 | No bundle size guard | Add `@size-limit/preset-small-lib` or `bundlesize` to build step | 1 hour |
| 8 | No contract tests | Add Vitest + Fastify.inject() contract tests against shared Zod schemas (NO Hurl) | 1 hour |

### Priority 3 — Medium (This Month)

| # | Gap | Action | Effort |
|---|---|---|---|
| 9 | No performance tests | Add k6 scripts + nightly workflow | 3 hours |
| 10 | No Lighthouse CI | Add `lighthouserc.js` + CI job | 1 hour |
| 11 | No accessibility in Automate | Add vitest-axe + E2E a11y specs | 2 hours |
| 12 | No dead code detection | Add Knip config + weekly CI | 30 min |
| 13 | Mutation testing not in CI | Create `nightly.yml` with Stryker | 30 min |
| 14 | No test-impact analysis | Add `dorny/paths-filter` to run only affected tests per PR | 1 hour |
| 15 | No CI caching | Add `pnpm store` + `.turbo` cache to all workflows | 1 hour |
| 16 | No Docker image scanning | Add Trivy container scan to security workflow | 30 min |
| 17 | No license compliance | Add `license-checker-rseidelsohn` to security workflow | 30 min |
| 18 | No TypeScript package validation | Add `@arethetypeswrong/cli` + `publint` for published packages | 30 min |
| 19 | No flaky test quarantine lifecycle | Document and implement quarantine process using feature flags | 2 hours |

### Priority 4 — Nice to Have (This Quarter)

| # | Gap | Action | Effort |
|---|---|---|---|
| 20 | No DAST | Add OWASP ZAP nightly scan | 2 hours |
| 21 | No chaos testing | Add resilience test suite | 4 hours |
| 22 | No Prettier adoption | Config created; roll out to lint-staged | 30 min |
| 23 | Multi-browser E2E | Add Firefox + WebKit projects | 1 hour |

> **Removed**: Sentry monitoring (out of scope), MSW mock layer (not needed — Fastify.inject() is cleaner), Commitlint (not requested), Argos CI (replaced by toHaveScreenshot), Hurl (replaced by Fastify.inject()).

---

## Tool Summary — All Free

| Tool | Purpose | Free Tier | License |
|---|---|---|---|
| Vitest 4 | Unit/integration tests | ✅ Unlimited | MIT |
| Playwright | E2E + visual + a11y | ✅ Unlimited | Apache 2.0 |
| Playwright `toHaveScreenshot()` | Visual regression (replaces Argos CI) | ✅ Unlimited | Apache 2.0 |
| Stryker | Mutation testing | ✅ Unlimited | Apache 2.0 |
| ESLint | Linting | ✅ Unlimited | MIT |
| TypeScript | Type checking | ✅ Unlimited | Apache 2.0 |
| Semgrep | SAST | ✅ Community | LGPL |
| gitleaks | Secret scanning | ✅ Unlimited | MIT |
| Trivy | Container image scanning | ✅ Unlimited | Apache 2.0 |
| pnpm audit | Dependency vulnerability scan | ✅ Built-in | MIT |
| license-checker-rseidelsohn | License compliance | ✅ Unlimited | BSD-3 |
| k6 | Load testing | ✅ Self-hosted | AGPL |
| Lighthouse CI | Frontend perf | ✅ Unlimited | Apache 2.0 |
| @size-limit | Bundle size guards | ✅ Unlimited | MIT |
| Knip | Dead code detection | ✅ Unlimited | ISC |
| Vitest + Fastify.inject() | API contract testing (replaces Hurl) | ✅ Unlimited | MIT |
| @arethetypeswrong/cli | TypeScript package validation | ✅ Unlimited | MIT |
| publint | npm package linting | ✅ Unlimited | MIT |
| dorny/paths-filter | Test-impact path filtering for CI | ✅ Unlimited | MIT |
| Husky | Git hooks | ✅ Unlimited | MIT |
| lint-staged | Pre-commit lint runner | ✅ Unlimited | MIT |
| Dependabot | Dep updates | ✅ GitHub native | — |
| vitest-axe | a11y unit tests | ✅ Unlimited | MIT |
| Toxiproxy | Chaos testing | ✅ Unlimited | MIT |
| Prettier | Code formatting | ✅ Unlimited | MIT |
| eslint-plugin-playwright | Playwright-aware ESLint rules | ✅ Unlimited | MIT |

---

## Metrics Dashboard

Track these KPIs weekly:

| Metric | Target | Current |
|---|---|---|
| Test count | > 2,500 | 2,155 |
| Code coverage (server) | > 95% | 97% ✅ |
| Code coverage (client) | > 90% | 93% ✅ |
| Mutation score | > 75% | Unknown |
| E2E pass rate | > 98% | Unknown |
| API p95 latency | < 500ms | Unknown |
| Lighthouse perf score | > 80 | Unknown |
| a11y violations | 0 | Unknown |
| Security vulns (high) | 0 | Unknown |
| Bundle size (JS) | < 500 KB | Unknown |
| PR pipeline time | < 5 min | N/A (no pipeline) |

---

*Last updated: April 2026*
*Maintainer: Automate Engineering*
