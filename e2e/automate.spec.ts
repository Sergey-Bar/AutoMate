import { test, expect } from '@playwright/test';

test.describe('Automate Pillar', () => {
  test('navigates to /automate and shows conversations list', async ({ page }) => {
    await page.goto('/automate');
    await expect(page).toHaveURL(/\/automate/);
    await expect(page.getByTestId('nav-bar')).toBeVisible();
    const conversations = page.locator(
      '[data-testid="conversations-list"], [data-testid="conversation-item"], ul, [role="list"]'
    );
    await expect(conversations.first()).toBeVisible();
  });

  test('opens a conversation detail when clicking a conversation', async ({ page }) => {
    await page.goto('/automate');
    const firstConversation = page
      .locator('[data-testid="conversation-item"], [role="listitem"], li')
      .first();
    await firstConversation.click();
    await expect(page).toHaveURL(/\/automate\/.+/);
  });

  test('navigates to /automate/connectors and shows connector list', async ({ page }) => {
    await page.goto('/automate/connectors');
    await expect(page).toHaveURL(/\/automate\/connectors/);
    const connectors = page.locator(
      '[data-testid="connectors-list"], [data-testid="connector-card"], main'
    );
    await expect(connectors.first()).toBeVisible();
  });

  test('navigates to /automate/vault and shows vault page', async ({ page }) => {
    await page.goto('/automate/vault');
    await expect(page).toHaveURL(/\/automate\/vault/);
    const vaultContent = page.locator('[data-testid="vault-page"], main, [role="main"]');
    await expect(vaultContent.first()).toBeVisible();
  });
});
