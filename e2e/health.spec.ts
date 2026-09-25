import { test, expect } from '@playwright/test';
import { API } from './helpers.js';

/**
 * E2E tests for the health endpoint and general application reachability.
 *
 * Covers:
 *  - GET /health — server health check
 *  - Web app is reachable at the base URL
 *  - Core API endpoints return expected status codes
 *
 * These tests use Playwright's `request` fixture for pure API tests
 * and `page` for browser-level reachability checks.
 */
test.describe('Health Endpoint', () => {
  // /health is a server-only route (not proxied by Vite), so we must
  // hit the API server directly.
  const HEALTH_URL = `${API}/health`;

  test('GET /health returns 200', async ({ request }) => {
    const response = await request.get(HEALTH_URL);

    expect(response.status()).toBe(200);
  });

  test('GET /health returns an object with a status field', async ({ request }) => {
    const response = await request.get(HEALTH_URL);

    expect(response.status()).toBe(200);

    const body = await response.json() as Record<string, unknown>;
    // Health response must have a "status" key
    expect(body).toHaveProperty('status');
  });

  test('GET /health status field is "ok"', async ({ request }) => {
    const response = await request.get(HEALTH_URL);

    const body = await response.json() as Record<string, unknown>;
    expect(body.status).toBe('ok');
  });

  test('GET /health includes a db field', async ({ request }) => {
    const response = await request.get(HEALTH_URL);

    const body = await response.json() as Record<string, unknown>;
    // Health check should report database connectivity
    expect(body).toHaveProperty('db');
  });
});

test.describe('Web App Reachability', () => {
  test('web app is reachable at the base URL', async ({ page }) => {
    const response = await page.goto('/');

    expect(response?.status()).toBe(200);
  });

  test('web app home page renders without a JS error overlay', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');

    // Allow the page to settle
    await expect(page.locator('body')).toBeVisible();

    // No uncaught JS errors should have occurred
    expect(errors).toHaveLength(0);
  });

  test('web app serves HTML at the root', async ({ request }) => {
    const response = await request.get('/');

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
  });
});

test.describe('Core API Endpoints', () => {
  test('GET /api/conversations returns 200 with array', async ({ request }) => {
    const response = await request.get('/api/conversations');

    expect(response.status()).toBe(200);

    const body: unknown = await response.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('GET /api/model-config returns 200 with model settings', async ({ request }) => {
    const response = await request.get('/api/model-config');

    expect(response.status()).toBe(200);

    const body = await response.json() as Record<string, unknown>;
    // Model config must at minimum expose the model name
    expect(body).toHaveProperty('model');
  });

  test('GET /api/connectors returns 200 with array', async ({ request }) => {
    const response = await request.get('/api/connectors');

    expect(response.status()).toBe(200);

    const body: unknown = await response.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('GET /api/vault/status returns 200', async ({ request }) => {
    const response = await request.get('/api/vault/status');

    expect(response.status()).toBe(200);
  });
});
