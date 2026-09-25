import { test, expect } from '@playwright/test';

const BASE = process.env.DASHBOARD_URL ?? 'http://localhost:5173';
const API = process.env.API_BASE_URL ?? 'http://localhost:4000';

/* ──────────────────────────────────────────────────────────────────────────────
 * Global: skip onboarding wizard for all tests
 * ────────────────────────────────────────────────────────────────────────── */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mc-onboarding', JSON.stringify({ state: { hasCompletedOnboarding: true }, version: 0 }));
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * Sprint 6.1 — v2 graduated feature flags and endpoints
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Feature Flags — v2 graduated features', () => {
  test('sidebar shows Quarantine, Baselines, and Codegen when flags are ON', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(800);

    const quarantineLink = page.getByRole('link', { name: /quarantine/i });
    if (!(await quarantineLink.isVisible().catch(() => false))) {
      const toggleSidebar = page.getByLabel('Toggle sidebar');
      await toggleSidebar.click();
      await page.waitForTimeout(400);
    }

    await expect(page.getByRole('link', { name: /quarantine/i })).toBeVisible({ timeout: 7000 });
    await expect(page.getByRole('link', { name: /baselines/i })).toBeVisible({ timeout: 7000 });
    await expect(page.getByRole('link', { name: /codegen/i })).toBeVisible({ timeout: 7000 });
  });

  test('v2 feature API endpoints return 200 (not 404)', async ({ request }) => {
    const endpoints = ['/api/quarantine', '/api/baselines', '/api/codegen/status'];

    for (const endpoint of endpoints) {
      const res = await request.get(`${API}${endpoint}`);
      expect(res.status(), `expected 200 from ${endpoint}`).toBe(200);
      expect(res.status(), `endpoint should not be 404: ${endpoint}`).not.toBe(404);
    }
  });
});
