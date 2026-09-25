/**
 * settings-dashboard.spec.ts — T33 Settings & Dashboard E2E
 *
 * Tests:
 * 1. Settings: invalid temperature is rejected, valid temperature saves and persists on reload
 * 2. Dashboard: run detail navigation from list with exact values
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(__dirname, '../../.sisyphus/evidence/production-readiness');
const API_BASE = 'http://localhost:3456';
const WEB_BASE = 'http://localhost:5173';

// ---------------------------------------------------------------------------
// Helpers — pre-seed dashboard runs via reporter API (legacy wire format)
//
// The reporter endpoint accepts a "legacy" format when the body lacks BOTH
// `version` AND `timestamp`:  { type, runId, payload: unknown }
// ---------------------------------------------------------------------------

async function seedRun(
  request: APIRequestContext,
  runId: string,
  stats: { total: number; passed: number; failed: number },
  durationMs: number,
): Promise<void> {
  // 1. run:start — sets total counter and status = 'running'
  const startRes = await request.post(`${API_BASE}/api/v1/reporter/events`, {
    data: {
      type: 'run:start',
      runId,
      payload: { total: stats.total },
    },
  });
  expect(startRes.status()).toBe(202);

  // 2. Individual test:end events — increments passed / failed counters on the run
  for (let i = 0; i < stats.passed; i++) {
    const testRes = await request.post(`${API_BASE}/api/v1/reporter/events`, {
      data: {
        type: 'test:end',
        runId,
        payload: { testId: `${runId}-passed-${i}`, status: 'passed' },
      },
    });
    expect(testRes.status()).toBe(202);
  }

  for (let i = 0; i < stats.failed; i++) {
    const testRes = await request.post(`${API_BASE}/api/v1/reporter/events`, {
      data: {
        type: 'test:end',
        runId,
        payload: { testId: `${runId}-failed-${i}`, status: 'failed' },
      },
    });
    expect(testRes.status()).toBe(202);
  }

  // 3. run:end — sets final status and durationMs
  //    Status is explicitly 'passed' per task requirements (independent of test counters).
  const endRes = await request.post(`${API_BASE}/api/v1/reporter/events`, {
    data: {
      type: 'run:end',
      runId,
      payload: { status: 'passed', durationMs },
    },
  });
  expect(endRes.status()).toBe(202);
}

// ---------------------------------------------------------------------------
// 1. Settings — invalid temperature blocked
// ---------------------------------------------------------------------------

test('settings — invalid temperature is blocked', async ({ page }) => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  await page.goto(`${WEB_BASE}/settings`);
  await page.waitForSelector('[data-testid="settings-page"]');

  // Triple-click to select all, then type an invalid value
  await page.locator('[data-testid="temperature-input"]').click({ clickCount: 3 });
  await page.keyboard.type('abc');

  // Click Save
  await page.click('[data-testid="save-settings"]');

  // Error must appear
  await expect(page.getByText('Temperature must be a valid number')).toBeVisible({ timeout: 5000 });

  // Success must NOT appear
  await expect(page.getByText('Settings saved successfully!')).not.toBeVisible();

  // Evidence screenshot
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'task-33-settings-e2e.png'),
    fullPage: true,
  });
});

// ---------------------------------------------------------------------------
// 2. Settings — valid temperature saves and persists after reload
// ---------------------------------------------------------------------------

test('settings — valid temperature saves and persists after reload', async ({ page }) => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  await page.goto(`${WEB_BASE}/settings`);
  await page.waitForSelector('[data-testid="settings-page"]');

  // Triple-click to select all, then type a valid value
  await page.locator('[data-testid="temperature-input"]').click({ clickCount: 3 });
  await page.keyboard.type('0.9');

  // Click Save
  await page.click('[data-testid="save-settings"]');

  // Success message must appear
  await expect(page.getByText('Settings saved successfully!')).toBeVisible({ timeout: 5000 });

  // Reload the page
  await page.reload();
  await page.waitForSelector('[data-testid="settings-page"]');

  // Temperature input must reflect saved value
  await expect(page.locator('[data-testid="temperature-input"]')).toHaveValue('0.9');
});

// ---------------------------------------------------------------------------
// 3. Dashboard — run detail navigation shows exact values
// ---------------------------------------------------------------------------

test('dashboard — run detail navigation shows exact values', async ({ page, request }) => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const runId = 'detail-e2e-run-001';

  // Seed run via reporter API
  await seedRun(
    request,
    runId,
    { total: 3, passed: 2, failed: 1 },
    100,
  );

  // Navigate to dashboard list
  await page.goto(`${WEB_BASE}/dashboard`);

  // Wait for the specific run item to appear in the list
  await page.waitForSelector(`[data-testid="run-item-${runId}"]`, { timeout: 10000 });

  // Click the run item
  await page.click(`[data-testid="run-item-${runId}"]`);

  // Assert URL contains the run id
  await expect(page).toHaveURL(`/dashboard/runs/${runId}`, { timeout: 10000 });

  // Wait for the run detail page
  await page.waitForSelector('[data-testid="run-detail-page"]');

  // Assert exact values on the detail page
  await expect(page.locator('[data-testid="run-total"]')).toHaveText('3');
  await expect(page.locator('[data-testid="run-passed"]')).toHaveText('2');
  await expect(page.locator('[data-testid="run-failed"]')).toHaveText('1');
  await expect(page.locator('[data-testid="run-duration"]')).toHaveText('100ms');

  // Evidence screenshot
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'task-33-dashboard-detail-e2e.png'),
    fullPage: true,
  });
});
