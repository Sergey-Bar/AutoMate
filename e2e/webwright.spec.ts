import { test, expect } from '@playwright/test';

test.describe('Webwright Pillar', () => {
  test('navigates to /webwright and shows prompt input', async ({ page }) => {
    await page.goto('/webwright');
    await expect(page).toHaveURL(/\/webwright/);
    await expect(page.getByTestId('nav-bar')).toBeVisible();
    const promptInput = page.locator(
      '[data-testid="prompt-input"], textarea, input[type="text"], [role="textbox"]'
    );
    await expect(promptInput.first()).toBeVisible();
  });

  test('submitting a prompt triggers run feed update', async ({ page }) => {
    await page.goto('/webwright');
    const promptInput = page
      .locator('[data-testid="prompt-input"], textarea, [role="textbox"]')
      .first();
    await promptInput.fill('Run a smoke test on the homepage');
    const submitBtn = page.locator(
      '[data-testid="submit-prompt"], button[type="submit"], button:has-text("Run")'
    );
    await submitBtn.first().click();
    const runFeed = page.locator('[data-testid="run-feed"], [data-testid="run-list"], main');
    await expect(runFeed.first()).toBeVisible();
  });

  test('navigates to a webwright run detail', async ({ page }) => {
    await page.goto('/webwright');
    const runItem = page.locator('[data-testid^="run-item"], [data-testid^="run-row"], tbody tr').first();
    await runItem.click();
    await expect(page).toHaveURL(/\/webwright\/.+/);
  });

  test('run detail shows test output sections', async ({ page }) => {
    await page.goto('/webwright');
    const runItem = page.locator('[data-testid^="run-item"], [data-testid^="run-row"], tbody tr').first();
    await runItem.click();
    const detail = page.locator('[data-testid="run-detail"], main, [role="main"]');
    await expect(detail.first()).toBeVisible();
  });
});
