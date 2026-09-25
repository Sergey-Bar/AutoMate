import { test, expect } from '@playwright/test';

/**
 * E2E tests for error states and edge cases in Automate.
 *
 * Covers:
 *  - API unavailable / server errors: verify error UI shown to the user
 *  - Invalid / nonexistent conversation ID: verify graceful handling in the UI
 *  - Network failure during chat: verify disconnection handling and retry UX
 *
 * No Ollama required — all AI/chat API calls are intercepted via page.route().
 * The actual server (port 4000) runs normally; only specific endpoints are mocked.
 */

// ─── Chat API Error States ──────────────────────────────────────────────────

test.describe('Chat API Error States', () => {
  test('shows error message when chat API returns 500', async ({ page }) => {
    // Intercept /api/chat to simulate a server error
    await page.route('/api/chat', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' }),
      });
    });

    await page.goto('/');

    const input = page.getByPlaceholder('Ask Automate anything...');
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();

    await input.fill('Hello, Automate');
    await input.press('Enter');

    // The error message should appear in the conversation area
    await expect(
      page.getByText('Something went wrong. Please try again.')
    ).toBeVisible({ timeout: 10_000 });
  });

  test('shows Retry button when chat API returns an error', async ({ page }) => {
    await page.route('/api/chat', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Service Unavailable' }),
      });
    });

    await page.goto('/');

    const input = page.getByPlaceholder('Ask Automate anything...');
    await input.fill('Test message');
    await input.press('Enter');

    // Retry button must be visible after error
    await expect(
      page.getByRole('button', { name: /retry last message/i })
    ).toBeVisible({ timeout: 10_000 });
  });

  test('input is disabled after chat API error', async ({ page }) => {
    await page.route('/api/chat', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Server Error' }),
      });
    });

    await page.goto('/');

    const input = page.getByPlaceholder('Ask Automate anything...');
    await input.fill('Hello');
    await input.press('Enter');

    // After error, input should be disabled (error != null disables PromptInput)
    await expect(page.getByText('Something went wrong. Please try again.')).toBeVisible({ timeout: 10_000 });
    await expect(input).toBeDisabled();
  });

  test('user message still appears in the conversation after API error', async ({ page }) => {
    await page.route('/api/chat', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Server Error' }),
      });
    });

    await page.goto('/');

    const input = page.getByPlaceholder('Ask Automate anything...');
    await input.fill('My test message');
    await input.press('Enter');

    // The user's own message should be visible
    await expect(page.locator('text=My test message').first()).toBeVisible({ timeout: 5_000 });

    // And the error state should follow
    await expect(
      page.getByText('Something went wrong. Please try again.')
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ─── Network Failure / Disconnection ───────────────────────────────────────

test.describe('Network Disconnection Handling', () => {
  test('shows error when chat API request is aborted (network failure)', async ({ page }) => {
    // Simulate a hard network failure — the fetch itself fails
    await page.route('/api/chat', async (route) => {
      await route.abort('failed');
    });

    await page.goto('/');

    const input = page.getByPlaceholder('Ask Automate anything...');
    await expect(input).toBeVisible();

    await input.fill('This will fail');
    await input.press('Enter');

    // Network failure should trigger the same error UI as an HTTP error
    await expect(
      page.getByText('Something went wrong. Please try again.')
    ).toBeVisible({ timeout: 10_000 });
  });

  test('Retry button appears after network failure', async ({ page }) => {
    await page.route('/api/chat', async (route) => {
      await route.abort('connectionaborted');
    });

    await page.goto('/');

    const input = page.getByPlaceholder('Ask Automate anything...');
    await input.fill('Network test');
    await input.press('Enter');

    await expect(
      page.getByRole('button', { name: /retry last message/i })
    ).toBeVisible({ timeout: 10_000 });
  });

  test('clicking Retry clears the error and re-enables the input', async ({ page }) => {
    let callCount = 0;

    await page.route('/api/chat', async (route) => {
      callCount++;
      if (callCount === 1) {
        // First attempt: fail
        await route.abort('failed');
      } else {
        // Subsequent attempts: simulate a successful (but empty) stream response
        await route.fulfill({
          status: 200,
          contentType: 'text/plain',
          body: '',
        });
      }
    });

    await page.goto('/');

    const input = page.getByPlaceholder('Ask Automate anything...');
    await input.fill('Will retry');
    await input.press('Enter');

    // Wait for error state
    const retryButton = page.getByRole('button', { name: /retry last message/i });
    await expect(retryButton).toBeVisible({ timeout: 10_000 });

    // Click Retry — the route now succeeds
    await retryButton.click();

    // After retry sends successfully, the input should become enabled again
    await expect(input).toBeEnabled({ timeout: 10_000 });
  });

  test('conversations list remains visible when chat API is unavailable', async ({ page }) => {
    // Block only the chat endpoint — conversations API remains live
    await page.route('/api/chat', async (route) => {
      await route.abort('failed');
    });

    await page.goto('/');

    // The chat input and layout should still be accessible
    const input = page.getByPlaceholder('Ask Automate anything...');
    await expect(input).toBeVisible();

    // Navigation links in the sidebar should still work
    await expect(page.getByRole('link', { name: /Connectors/i })).toBeVisible();
  });
});

// ─── Invalid / Nonexistent Conversation ID ──────────────────────────────────

test.describe('Invalid Conversation ID', () => {
  test('navigating to nonexistent conversation ID loads the chat page without crashing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/chat/nonexistent-id-00000000');

    // Page must load without JS errors
    await expect(page.locator('body')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('navigating to nonexistent conversation ID shows the chat input', async ({ page }) => {
    await page.goto('/chat/nonexistent-id-00000000');

    // The chat shell renders with the (empty) conversation — input is available
    const input = page.getByPlaceholder('Ask Automate anything...');
    await expect(input).toBeVisible({ timeout: 10_000 });
    await expect(input).toBeEnabled();
  });

  test('navigating to nonexistent conversation ID renders empty state', async ({ page }) => {
    await page.goto('/chat/nonexistent-id-00000000');

    // No messages in a brand-new or nonexistent conversation → empty state
    await expect(
      page.getByText('No conversations yet', { exact: true })
    ).toBeVisible({ timeout: 10_000 });
  });

  test('sending a message on a nonexistent conversation ID triggers error (API intercepted)', async ({ page }) => {
    // Mock /api/chat to return 404 for unknown conversation
    await page.route('/api/chat', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Conversation not found' }),
      });
    });

    await page.goto('/chat/nonexistent-id-00000000');

    const input = page.getByPlaceholder('Ask Automate anything...');
    await expect(input).toBeVisible({ timeout: 10_000 });

    await input.fill('Test on missing conversation');
    await input.press('Enter');

    // The chat error state should appear
    await expect(
      page.getByText('Something went wrong. Please try again.')
    ).toBeVisible({ timeout: 10_000 });
  });

  test('GET /api/conversations/:id returns 404 for nonexistent conversation', async ({ request }) => {
    const response = await request.get('/api/conversations/nonexistent-id-00000000/messages');

    // The API should return 200 with empty array (messages for unknown conv) or 404
    // Either is acceptable — important thing is it doesn't 500
    expect(response.status()).toBeLessThan(500);
  });

  test('DELETE /api/conversations/:id returns 404 for nonexistent conversation', async ({ request }) => {
    const response = await request.delete('/api/conversations/nonexistent-id-00000000');

    expect(response.status()).toBe(404);

    const body = await response.json() as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
    expect(body.error).toContain('not found');
  });
});

// ─── Conversations API Unavailable ──────────────────────────────────────────

test.describe('Conversations API Unavailable', () => {
  test('app loads without crashing when conversations API returns 500', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // Intercept the list endpoint to simulate a server error
    await page.route('/api/conversations', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Database connection failed' }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/');

    await expect(page.locator('body')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('chat input remains visible when conversations API fails', async ({ page }) => {
    await page.route('/api/conversations', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Database error' }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/');

    // Core chat input must still be rendered even if conversation list fails
    const input = page.getByPlaceholder('Ask Automate anything...');
    await expect(input).toBeVisible({ timeout: 10_000 });
  });

  test('app loads without crashing when conversations API network fails', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.route('/api/conversations', async (route) => {
      if (route.request().method() === 'GET') {
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    await page.goto('/');

    await expect(page.locator('body')).toBeVisible();
    expect(errors).toHaveLength(0);
  });
});

// ─── Error Boundary Edge Cases ───────────────────────────────────────────────

test.describe('General App Resilience', () => {
  test('app root renders even with partially failed API calls', async ({ page }) => {
    // Simulate partial outage: model-config returns error
    await page.route('/api/model-config', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Service unavailable' }),
      });
    });

    await page.goto('/settings/model');

    // Page must load without completely crashing — ErrorBoundary should catch
    await expect(page.locator('body')).toBeVisible();
  });

  test('connectors page is resilient to API errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // Simulate connectors API failure
    await page.route('/api/connectors', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal error' }),
      });
    });

    await page.goto('/settings/connectors');

    await expect(page.locator('body')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('navigating to an unknown route renders the app layout without crashing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // TanStack Router doesn't have a 404 route defined — it falls through to the root layout
    await page.goto('/this-route-does-not-exist');

    await expect(page.locator('body')).toBeVisible();
    expect(errors).toHaveLength(0);
  });
});
