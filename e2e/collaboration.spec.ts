import { test, expect } from '@playwright/test';

test.describe('Collaboration Pillar', () => {
  test('navigates to GitHub integration page and shows config form', async ({ page }) => {
    await page.goto('/automate/integrations/github');
    await expect(page).toHaveURL(/\/automate\/integrations\/github/);
    await expect(page.getByTestId('nav-bar')).toBeVisible();
    const configForm = page.locator(
      '[data-testid="github-config"], form, [data-testid="integration-form"]'
    );
    await expect(configForm.first()).toBeVisible();
  });

  test('GitHub integration page has a save/connect button', async ({ page }) => {
    await page.goto('/automate/integrations/github');
    const saveBtn = page.locator(
      '[data-testid="save-integration"], button:has-text("Save"), button:has-text("Connect")'
    );
    await expect(saveBtn.first()).toBeVisible();
  });

  test('navigates to /automate/integrations/alerts and shows alert rules', async ({ page }) => {
    await page.goto('/automate/integrations/alerts');
    await expect(page).toHaveURL(/\/automate\/integrations\/alerts/);
    const alertsContent = page.locator(
      '[data-testid="alert-rules"], [data-testid="alerts-list"], main'
    );
    await expect(alertsContent.first()).toBeVisible();
  });

  test('alerts page has a create alert rule button', async ({ page }) => {
    await page.goto('/automate/integrations/alerts');
    const createBtn = page.locator(
      '[data-testid="create-alert"], button:has-text("Create"), button:has-text("Add")'
    );
    await expect(createBtn.first()).toBeVisible();
  });
});
