import { expect, test } from '@playwright/test';

test('browser smoke passes', async ({ page }) => {
  const response = await page.goto('/health');
  expect(response?.ok()).toBe(true);
  await expect(page.getByText('automate-api')).toBeVisible();
});
