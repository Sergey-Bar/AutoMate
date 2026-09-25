/**
 * ai-chat.spec.ts — T30 AI Chat E2E
 *
 * Tests:
 * 1. Send message → deterministic assistant response visible
 * 2. Conversation history persists after page refresh
 * 3. Two conversations have isolated histories
 * 4. Send failure: UI recovers (input restored, message removed from UI)
 *
 * Prerequisites (playwright.config.ts webServer):
 *   - API server on http://localhost:3456  (no AUTOMATE_API_KEY → auth bypass)
 *   - Vite dev server on http://localhost:5173
 *
 * Mock AI: DEFAULT_MOCK_RESPONSE = 'I am your AI QA assistant. I received your message and I am processing it.'
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(__dirname, '../../.sisyphus/evidence/production-readiness');
const API_BASE = 'http://localhost:3456';
const WEB_BASE = 'http://localhost:5173';

/** Start of DEFAULT_MOCK_RESPONSE — asserted in assistant message */
const MOCK_RESPONSE_FRAGMENT = 'I am your AI QA assistant';

// ---------------------------------------------------------------------------
// Helpers — pre-seed state via API (not browser)
// ---------------------------------------------------------------------------

async function apiCreateConversation(
  request: APIRequestContext,
  title: string,
): Promise<{ id: string; title: string }> {
  const res = await request.post(`${API_BASE}/api/v1/orchestrator/conversations`, {
    data: { title },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; title: string };
}

async function apiSendMessage(
  request: APIRequestContext,
  conversationId: string,
  message: string,
): Promise<void> {
  const res = await request.post(`${API_BASE}/api/v1/orchestrator/chat`, {
    data: { conversationId, message },
  });
  expect(res.status()).toBe(201);
}

// ---------------------------------------------------------------------------
// 1. Happy path — type in the browser, click send, see assistant response
// ---------------------------------------------------------------------------

test('ai chat — send message and see deterministic assistant response', async ({ page }) => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  await page.goto(`${WEB_BASE}/ai`);
  await page.waitForSelector('[data-testid="ai-page"]');

  // Type a message and send
  await page.fill('[data-testid="chat-input"]', 'Generate checkout smoke test');
  await page.click('[data-testid="send-message"]');

  // Wait for and assert the deterministic assistant response
  await page.waitForSelector('[data-testid="assistant-message"]', { timeout: 15000 });
  const assistantText = await page
    .locator('[data-testid="assistant-message"]')
    .first()
    .textContent();
  expect(assistantText).toContain(MOCK_RESPONSE_FRAGMENT);

  // Evidence screenshot
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'task-30-ai-chat.png'),
    fullPage: true,
  });
});

// ---------------------------------------------------------------------------
// 2. History persistence — messages survive a full page reload
// ---------------------------------------------------------------------------

test('ai chat — conversation history persists after page refresh', async ({ page, request }) => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const ts = Date.now();
  const title = `Persist Test ${ts}`;
  const message = `Persistence check message ${ts}`;

  // Pre-seed a conversation + message via API so we have a known state
  const conv = await apiCreateConversation(request, title);
  await apiSendMessage(request, conv.id, message);

  // ── First visit ──────────────────────────────────────────────────────────
  await page.goto(`${WEB_BASE}/ai`);
  await page.waitForSelector('[data-testid="ai-page"]');
  await page.waitForSelector('[data-testid="conversation-list"]');

  // Click the specific conversation
  await page
    .locator('[data-testid="conversation-list"] li', { hasText: title })
    .click();

  // User message and assistant response must be visible
  await expect(page.getByText(message)).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="assistant-message"]').first()).toBeVisible({
    timeout: 10000,
  });

  // ── Reload ───────────────────────────────────────────────────────────────
  await page.reload();
  await page.waitForSelector('[data-testid="ai-page"]');
  await page.waitForSelector('[data-testid="conversation-list"]');

  // Re-select the same conversation after reload
  await page
    .locator('[data-testid="conversation-list"] li', { hasText: title })
    .click();

  // Messages must still be visible — persistence confirmed
  await expect(page.getByText(message)).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="assistant-message"]').first()).toBeVisible({
    timeout: 10000,
  });
});

// ---------------------------------------------------------------------------
// 3. Conversation isolation — switching reveals separate message histories
// ---------------------------------------------------------------------------

test('ai chat — two conversations have isolated histories', async ({ page, request }) => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const ts = Date.now();
  const titleA = `Isolation Conv A ${ts}`;
  const titleB = `Isolation Conv B ${ts + 1}`;
  const messageA = `Isolation message A content ${ts}`;
  const messageB = `Isolation message B content ${ts + 1}`;

  // Pre-seed both conversations
  const convA = await apiCreateConversation(request, titleA);
  await apiSendMessage(request, convA.id, messageA);

  const convB = await apiCreateConversation(request, titleB);
  await apiSendMessage(request, convB.id, messageB);

  await page.goto(`${WEB_BASE}/ai`);
  await page.waitForSelector('[data-testid="ai-page"]');
  await page.waitForSelector('[data-testid="conversation-list"]');

  // ── Select Conversation A ─────────────────────────────────────────────────
  await page
    .locator('[data-testid="conversation-list"] li', { hasText: titleA })
    .click();

  // Wait for A's assistant response to appear
  await expect(page.locator('[data-testid="assistant-message"]').first()).toBeVisible({
    timeout: 10000,
  });

  // messageA visible, messageB absent
  await expect(page.getByText(messageA)).toBeVisible();
  await expect(page.getByText(messageB)).not.toBeVisible();

  // ── Select Conversation B ─────────────────────────────────────────────────
  await page
    .locator('[data-testid="conversation-list"] li', { hasText: titleB })
    .click();

  // Wait for B's assistant response to appear
  await expect(page.locator('[data-testid="assistant-message"]').first()).toBeVisible({
    timeout: 10000,
  });

  // messageB visible, messageA absent
  await expect(page.getByText(messageB)).toBeVisible();
  await expect(page.getByText(messageA)).not.toBeVisible();

  // Evidence: screenshot shows Conversation B selected with isolated history
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'task-30-conversation-switching.png'),
    fullPage: true,
  });
});

// ---------------------------------------------------------------------------
// 4. Send failure recovery — input restored, optimistic message removed, error shown
// ---------------------------------------------------------------------------

test('ai chat — send failure: input restored and error shown', async ({ page, request }) => {
  const ts = Date.now();
  const title = `Failure Test ${ts}`;

  // Pre-seed a conversation (no messages) to ensure a valid conversationId
  await apiCreateConversation(request, title);

  await page.goto(`${WEB_BASE}/ai`);
  await page.waitForSelector('[data-testid="ai-page"]');
  await page.waitForSelector('[data-testid="conversation-list"]');

  // Select the pre-seeded conversation
  await page
    .locator('[data-testid="conversation-list"] li', { hasText: title })
    .click();

  // Wait for idle state (no messages, input enabled)
  await expect(page.locator('[data-testid="chat-input"]')).toBeEnabled({ timeout: 5000 });

  const failMessage = `This message will fail ${ts}`;

  // Intercept the chat POST and return 500 — simulates a server-side failure
  await page.route('**/api/v1/orchestrator/chat', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Simulated server error' }),
    });
  });

  // Type and attempt to send the message
  await page.fill('[data-testid="chat-input"]', failMessage);
  await page.click('[data-testid="send-message"]');

  // Error banner must appear
  await page.waitForSelector('[data-testid="chat-error"]', { timeout: 10000 });
  await expect(page.locator('[data-testid="chat-error"]')).toBeVisible();

  // Input must be restored with the original message (ready for retry)
  await expect(page.locator('[data-testid="chat-input"]')).toHaveValue(failMessage);

  // Optimistic user message must be removed from the message list
  // (getByText matches element text content, not input values)
  await expect(page.getByText(failMessage)).not.toBeVisible();
});
