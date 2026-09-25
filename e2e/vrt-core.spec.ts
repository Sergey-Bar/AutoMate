import { test, expect } from '@playwright/test';

test.describe('VRT - Core Routes', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept and mock ALL API calls
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();

      // Conversations List
      if (url.includes('/api/conversations') && !url.includes('/messages')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { id: '123', title: 'Example Conversation', updatedAt: new Date().toISOString() }
          ]),
        });
        return;
      }

      // Conversation Messages
      if (url.includes('/messages')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]), // Empty state for basic chat screenshot
        });
        return;
      }

      // Connectors Settings
      if (url.includes('/settings/connectors')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            github: { enabled: true, isConnected: true },
            jira: { enabled: false, isConnected: false },
            slack: { enabled: true, isConnected: false }
          }),
        });
        return;
      }

      // SQL Tables
      if (url.includes('/sql/tables')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(['users', 'sessions', 'logs']),
        });
        return;
      }

      // Default fallback
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });
  });

  test('Home Route', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');
    await expect(page).toHaveScreenshot('home-page.png');
  });

  test('Chat Route with ID', async ({ page }) => {
    await page.goto('/chat/123');
    await page.waitForLoadState('load');
    await expect(page).toHaveScreenshot('chat-conversation.png');
  });

  test('Settings Connectors Route', async ({ page }) => {
    await page.goto('/settings/connectors');
    await page.waitForLoadState('load');
    await expect(page).toHaveScreenshot('settings-connectors.png');
  });

  test('SQL Browser Route', async ({ page }) => {
    await page.goto('/sql');
    await page.waitForLoadState('load');
    await expect(page).toHaveScreenshot('sql-browser.png');
  });
});
