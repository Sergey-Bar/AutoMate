import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.DASHBOARD_URL ?? 'http://localhost:5173';

/* ──────────────────────────────────────────────────────────────────────────────
 * Global: skip onboarding wizard for all tests
 * ────────────────────────────────────────────────────────────────────────── */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'mc-onboarding',
      JSON.stringify({ state: { hasCompletedOnboarding: true }, version: 0 }),
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * Accessibility tests — axe-core scans on key pages
 * ══════════════════════════════════════════════════════════════════════════ */

test.describe('accessibility', () => {
  test('dashboard page has no critical accessibility violations', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .disableRules(['color-contrast']) // theme-dependent, tested separately
      .analyze();

    expect(results.violations.filter((v) => v.impact === 'critical')).toEqual([]);
  });

  test('login page has no critical accessibility violations', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.waitForLoadState('domcontentloaded');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .disableRules(['color-contrast'])
      .analyze();

    expect(results.violations.filter((v) => v.impact === 'critical')).toEqual([]);
  });

  test('runs page has no critical accessibility violations', async ({ page }) => {
    await page.goto(`${BASE}/runs`);
    await page.waitForLoadState('domcontentloaded');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .disableRules(['color-contrast'])
      .analyze();

    expect(results.violations.filter((v) => v.impact === 'critical')).toEqual([]);
  });

  test('settings page has no critical accessibility violations', async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await page.waitForLoadState('domcontentloaded');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .disableRules(['color-contrast'])
      .analyze();

    expect(results.violations.filter((v) => v.impact === 'critical')).toEqual([]);
  });

  test('analytics page has no critical accessibility violations', async ({ page }) => {
    await page.goto(`${BASE}/analytics`);
    await page.waitForLoadState('domcontentloaded');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .disableRules(['color-contrast'])
      .analyze();

    expect(results.violations.filter((v) => v.impact === 'critical')).toEqual([]);
  });

  test('config page has no critical accessibility violations', async ({ page }) => {
    await page.goto(`${BASE}/config`);
    await page.waitForLoadState('domcontentloaded');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .disableRules(['color-contrast'])
      .analyze();

    expect(results.violations.filter((v) => v.impact === 'critical')).toEqual([]);
  });

  test('baselines page has no critical accessibility violations', async ({ page }) => {
    await page.goto(`${BASE}/baselines`);
    await page.waitForLoadState('domcontentloaded');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .disableRules(['color-contrast'])
      .analyze();

    expect(results.violations.filter((v) => v.impact === 'critical')).toEqual([]);
  });

  test('no serious violations across all key pages', async ({ page }) => {
    const pages = ['/', '/login', '/runs', '/analytics', '/config', '/baselines', '/settings'];
    const allViolations: { page: string; violations: string[] }[] = [];

    for (const url of pages) {
      await page.goto(`${BASE}${url}`);
      await page.waitForLoadState('domcontentloaded');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .disableRules(['color-contrast'])
        .analyze();

      const serious = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      if (serious.length > 0) {
        allViolations.push({
          page: url,
          violations: serious.map((v) => `[${v.impact}] ${v.id}: ${v.description}`),
        });
      }
    }

    expect(allViolations).toEqual([]);
  });
});
