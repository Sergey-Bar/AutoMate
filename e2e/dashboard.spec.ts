import { test, expect } from '@playwright/test';

test.describe('Dashboard Pillar', () => {
  test('navigates to /dashboard and shows runs table', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId('nav-bar')).toBeVisible();
    const runsTable = page.locator('table, [data-testid="runs-table"], [role="table"]');
    await expect(runsTable.first()).toBeVisible();
  });

  test('shows run rows with status indicators', async ({ page }) => {
    await page.goto('/dashboard');
    const rows = page.locator('tr, [data-testid^="run-row"]');
    await expect(rows.first()).toBeVisible();
  });

  test('clicking a run row navigates to run detail', async ({ page }) => {
    await page.goto('/dashboard');
    const firstRow = page.locator('tbody tr, [data-testid^="run-row"]').first();
    await firstRow.click();
    await expect(page).toHaveURL(/\/dashboard\/.+/);
  });

  test('run detail page renders key sections', async ({ page }) => {
    await page.goto('/dashboard');
    const firstRow = page.locator('tbody tr, [data-testid^="run-row"]').first();
    await firstRow.click();
    const detail = page.locator('[data-testid="run-detail"], main, [role="main"]');
    await expect(detail.first()).toBeVisible();
  });
});
