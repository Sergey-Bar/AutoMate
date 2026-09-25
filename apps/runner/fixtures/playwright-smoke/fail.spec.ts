import { expect, test } from '@playwright/test';

test('selected browser smoke fails', async ({ page }) => {
  const response = await page.goto('/health');
  expect(response?.ok()).toBe(true);
  await expect(page.getByText('selected-failure')).toBeVisible();
});
