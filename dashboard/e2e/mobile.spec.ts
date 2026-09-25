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
 * Sprint 6.3 — Mobile viewport behavior (375x812)
 * ════════════════════════════════════════════════════════════════════════════ */
test.describe('Mobile viewport UX', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('dashboard renders without horizontal scroll at 375px', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1200);

    const hasHorizontalOverflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth > doc.clientWidth;
    });

    expect(hasHorizontalOverflow).toBeFalsy();
  });

  test('mobile shows best-viewed notice and sidebar is collapsed to icon rail', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    await expect(page.getByText(/best viewed at \d+px\+/i)).toBeVisible({ timeout: 7000 });
    // Sidebar auto-collapses to icon rail (48px) at narrow viewports — links stay in DOM but labels are clipped
    const sidebar = page.locator('aside');
    const box = await sidebar.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeLessThan(80);
  });

  test('KPI cards use 2-column grid on mobile', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1200);

    const kpiGrid = page.locator('[aria-label="Key metrics"]');
    await expect(kpiGrid).toBeVisible({ timeout: 7000 });

    const className = (await kpiGrid.getAttribute('class')) ?? '';
    expect(className).toContain('grid-cols-2');
  });

  test('table columns Branch/Pass %/Duration are hidden on mobile', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1200);

    const branchHeader = page.getByRole('columnheader', { name: 'Branch' });
    const passRateHeader = page.getByRole('columnheader', { name: 'Pass %' });
    const durationHeader = page.getByRole('columnheader', { name: 'Duration' });

    await expect(branchHeader).not.toBeVisible({ timeout: 5000 });
    await expect(passRateHeader).not.toBeVisible({ timeout: 5000 });
    await expect(durationHeader).not.toBeVisible({ timeout: 5000 });
  });
});
