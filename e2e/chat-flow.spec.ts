import { test, expect } from '@playwright/test';

/**
 * E2E tests for the chat flow.
 *
 * Prerequisites:
 * - Ollama running locally with llama3.1 model
 * - Server and web dev servers started (handled by playwright.config.ts webServer)
 */
test.describe('Chat Flow', () => {
  test('user can send a message and receive a response', async ({ page }) => {
    await page.goto('/');

    // The chat input placeholder
    const input = page.getByPlaceholder('Ask Automate anything...');
    await expect(input).toBeVisible();

    await input.fill('Hello');
    await input.press('Enter');

    // Wait for the user message to appear in the conversation
    const userMessage = page.locator('text=Hello').first();
    await expect(userMessage).toBeVisible({ timeout: 5000 });

    // Wait for assistant response (Ollama may take a few seconds)
    // The assistant message will appear as a new message element
    const assistantMessage = page.locator('[class*="message"]').filter({ hasNot: page.locator('text=Hello') });
    await expect(assistantMessage.first()).toBeVisible({ timeout: 30_000 });
  });

  test('empty state is shown when no conversations exist', async ({ page }) => {
    await page.goto('/');

    // Should see the empty state prompt (exact match to avoid sidebar duplicate)
    await expect(page.getByText('No conversations yet', { exact: true })).toBeVisible();
  });

  test('chat input is visible on the main page', async ({ page }) => {
    await page.goto('/');

    const input = page.getByPlaceholder('Ask Automate anything...');
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();
  });
});
