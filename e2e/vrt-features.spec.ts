import { test, expect } from '@playwright/test';

test.describe('VRT - Feature Routes', () => {
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

      // Conversation Messages (AI Response with Markdown features)
      if (url.includes('/messages')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { id: 'msg1', role: 'user', content: 'Can you show me a Python example?' },
            { id: 'msg2', role: 'assistant', content: 'Certainly! Here is an example in Python:\n\n```python\ndef hello_world():\n    print("Hello, world!")\n\nhello_world()\n```\n\nThis function simply prints a greeting to the console.' }
          ]),
        });
        return;
      }

      // Settings Model
      if (url.includes('/api/models/ollama/status') || url.includes('/api/models/status')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'running',
            models: ['llama3.1:latest', 'phi3:latest', 'mistral:latest'],
            activeModel: 'llama3.1:latest'
          }),
        });
        return;
      }

      // Vault Settings
      if (url.includes('/api/settings/vault')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            isInitialized: true,
            isUnlocked: true,
            keys: ['github-token', 'jira-api-key']
          }),
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

  test('Settings Model Route', async ({ page }) => {
    await page.goto('/settings/model');
    await page.waitForLoadState('load');
    await expect(page).toHaveScreenshot('settings-model.png');
  });

  test('Settings Vault Route', async ({ page }) => {
    await page.goto('/settings/vault');
    await page.waitForLoadState('load');
    await expect(page).toHaveScreenshot('settings-vault.png');
  });

  test('Chat Route with AI Response Features', async ({ page }) => {
    await page.goto('/chat/123');
    await page.waitForLoadState('load');
    await expect(page).toHaveScreenshot('chat-with-ai-response.png');
  });
});
