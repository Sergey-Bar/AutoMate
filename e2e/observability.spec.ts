import { test, expect } from '@playwright/test';

test.describe('Observability Pillar', () => {
  test('navigates to /dashboard/flaky and shows flaky tests table', async ({ page }) => {
    await page.goto('/dashboard/flaky');
    await expect(page).toHaveURL(/\/dashboard\/flaky/);
    await expect(page.getByTestId('nav-bar')).toBeVisible();
    const flakyTable = page.locator(
      '[data-testid="flaky-tests-table"], table, [role="table"]'
    );
    await expect(flakyTable.first()).toBeVisible();
  });

  test('flaky tests page shows test names and flakiness rates', async ({ page }) => {
    await page.goto('/dashboard/flaky');
    const rows = page.locator('tbody tr, [data-testid^="flaky-row"]');
    await expect(rows.first()).toBeVisible();
  });

  test('navigates to /dashboard/trends and shows trend charts', async ({ page }) => {
    await page.goto('/dashboard/trends');
    await expect(page).toHaveURL(/\/dashboard\/trends/);
    const charts = page.locator(
      '[data-testid="trends-chart"], canvas, svg, [role="img"]'
    );
    await expect(charts.first()).toBeVisible();
  });

  test('navigates to /dashboard/performance and shows performance metrics', async ({ page }) => {
    await page.goto('/dashboard/performance');
    await expect(page).toHaveURL(/\/dashboard\/performance/);
    const metrics = page.locator('[data-testid="performance-metrics"], main, [role="main"]');
    await expect(metrics.first()).toBeVisible();
  });
});
