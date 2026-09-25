import { test, expect } from '@playwright/test';

/**
 * E2E tests for the Conversations API and UI.
 *
 * Covers:
 *  - GET /api/conversations — list endpoint shape
 *  - POST /api/conversations — create a conversation
 *  - DELETE /api/conversations/:id — delete a conversation
 *  - GET /api/conversations/:id/messages — messages list endpoint
 *  - Home page renders the conversation list area
 *
 * API requests use Playwright's `request` fixture so no browser UI is needed
 * for the pure API tests. UI tests navigate the web app.
 */
test.describe('Conversations API', () => {
  test('GET /api/conversations returns 200 with an array', async ({ request }) => {
    const response = await request.get('/api/conversations');

    expect(response.status()).toBe(200);

    const body: unknown = await response.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('POST /api/conversations creates a conversation and returns 201', async ({ request }) => {
    const response = await request.post('/api/conversations', {
      data: { title: 'E2E test conversation' },
    });

    expect(response.status()).toBe(201);

    const body = await response.json() as Record<string, unknown>;
    expect(typeof body.id).toBe('string');
    expect(body.title).toBe('E2E test conversation');
  });

  test('POST /api/conversations creates a conversation with no title', async ({ request }) => {
    const response = await request.post('/api/conversations', {
      data: {},
    });

    expect(response.status()).toBe(201);

    const body = await response.json() as Record<string, unknown>;
    expect(typeof body.id).toBe('string');
  });

  test('DELETE /api/conversations/:id removes the conversation', async ({ request }) => {
    // First, create a conversation to delete
    const createResponse = await request.post('/api/conversations', {
      data: { title: 'Conversation to delete' },
    });
    expect(createResponse.status()).toBe(201);

    const created = await createResponse.json() as Record<string, unknown>;
    const id = created.id as string;

    // Delete it
    const deleteResponse = await request.delete(`/api/conversations/${id}`);
    expect(deleteResponse.status()).toBe(204);

    // Verify it no longer exists in the list
    const listResponse = await request.get('/api/conversations');
    const list = await listResponse.json() as Array<Record<string, unknown>>;
    const found = list.find((c) => c.id === id);
    expect(found).toBeUndefined();
  });

  test('DELETE /api/conversations/:id returns 404 for non-existent id', async ({ request }) => {
    const response = await request.delete('/api/conversations/non-existent-id-00000000');

    expect(response.status()).toBe(404);

    const body = await response.json() as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });

  test('GET /api/conversations/:id/messages returns an array', async ({ request }) => {
    // Create a conversation first
    const createResponse = await request.post('/api/conversations', {
      data: { title: 'Conversation for messages test' },
    });
    expect(createResponse.status()).toBe(201);

    const created = await createResponse.json() as Record<string, unknown>;
    const id = created.id as string;

    // Fetch messages — should be empty array for a brand-new conversation
    const msgResponse = await request.get(`/api/conversations/${id}/messages`);
    expect(msgResponse.status()).toBe(200);

    const messages = await msgResponse.json() as unknown;
    expect(Array.isArray(messages)).toBe(true);
  });
});

test.describe('Conversations UI', () => {
  test('home page loads and shows the chat input', async ({ page }) => {
    await page.goto('/');

    // The main chat input should always be present on the home page
    const input = page.getByPlaceholder('Ask Automate anything...');
    await expect(input).toBeVisible();
  });

  test('home page shows empty state when no conversations exist', async ({ page }) => {
    await page.goto('/');

    // Empty state message is rendered when conversation list is empty
    await expect(page.getByText('No conversations yet', { exact: true })).toBeVisible();
  });
});
