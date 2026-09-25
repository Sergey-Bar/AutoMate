/**
 * chat.ts — Chat endpoints
 *
 * POST /api/v1/orchestrator/chat
 *   Body: { conversationId: string, message: string }
 *   Response: application/json — Message object { id, conversationId, role, content, createdAt }
 *
 * POST /api/v1/orchestrator/chat/stream
 *   Body: { conversationId: string, message: string }
 *   Response: text/event-stream (SSE) with mock AI response (preserved for future use)
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { randomUUID } from 'node:crypto';
import type { ConversationStore } from './conversations.js';
import type { MessageStore } from './messages.js';

// ---------------------------------------------------------------------------
// Options + route factory
// ---------------------------------------------------------------------------

export interface OrchestratorChatOptions {
  /** Conversation store for validating that the conversation exists */
  conversationStore?: ConversationStore;
  /** Message store for persisting user and assistant messages */
  messageStore?: MessageStore;
  /** Optional override for generating mock responses — useful in tests */
  mockResponseFn?: (conversationId: string, message: string) => string;
}

const DEFAULT_MOCK_RESPONSE = 'I am your AI QA assistant. I received your message and I am processing it.';

export function createOrchestratorChatRoutes(
  options: OrchestratorChatOptions = {},
): Hono {
  const app = new Hono();

  // ── POST /api/v1/orchestrator/chat ─────────────────────────────────────────
  // JSON endpoint — returns a Message object
  app.post('/api/v1/orchestrator/chat', async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;

    const { conversationId, message } = body;

    if (typeof conversationId !== 'string' || !conversationId.trim()) {
      return c.json({ error: 'conversationId is required' }, 400);
    }
    if (typeof message !== 'string' || !message.trim()) {
      return c.json({ error: 'message is required' }, 400);
    }

    const trimmedConvId = conversationId.trim();
    const trimmedMessage = message.trim();

    // Validate conversation exists when a store is provided
    if (options.conversationStore) {
      const conv = options.conversationStore.get(trimmedConvId);
      if (!conv) {
        return c.json({ error: 'Conversation not found' }, 404);
      }
    }

    const responseText =
      options.mockResponseFn?.(trimmedConvId, trimmedMessage) ?? DEFAULT_MOCK_RESPONSE;

    if (options.messageStore) {
      // Persist user message
      options.messageStore.addMessage({
        conversationId: trimmedConvId,
        role: 'user',
        content: trimmedMessage,
      });

      // Persist assistant message and return it
      const assistantMessage = options.messageStore.addMessage({
        conversationId: trimmedConvId,
        role: 'assistant',
        content: responseText,
      });

      return c.json(assistantMessage, 201);
    }

    // Fallback when no store is provided (e.g. minimal wiring)
    const assistantMessage = {
      id: randomUUID(),
      conversationId: trimmedConvId,
      role: 'assistant' as const,
      content: responseText,
      createdAt: new Date().toISOString(),
    };

    return c.json(assistantMessage, 201);
  });

  // ── POST /api/v1/orchestrator/chat/stream ─────────────────────────────────
  // SSE streaming endpoint — preserved for future streaming use
  app.post('/api/v1/orchestrator/chat/stream', async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;

    const { conversationId, message } = body;

    if (typeof conversationId !== 'string' || !conversationId.trim()) {
      return c.json({ error: 'conversationId is required' }, 400);
    }
    if (typeof message !== 'string' || !message.trim()) {
      return c.json({ error: 'message is required' }, 400);
    }

    const trimmedConvId = conversationId.trim();
    const trimmedMessage = message.trim();

    // Validate conversation exists when a store is provided
    if (options.conversationStore) {
      const conv = options.conversationStore.get(trimmedConvId);
      if (!conv) {
        return c.json({ error: 'Conversation not found' }, 404);
      }
    }

    const responseText =
      options.mockResponseFn?.(trimmedConvId, trimmedMessage) ?? DEFAULT_MOCK_RESPONSE;

    // Persist user message before streaming
    options.messageStore?.addMessage({
      conversationId: trimmedConvId,
      role: 'user',
      content: trimmedMessage,
    });

    return streamSSE(c, async (stream) => {
      // Split response into chunks to simulate streaming
      const words = responseText.split(' ');
      for (const word of words) {
        await stream.writeSSE({
          event: 'text',
          data: JSON.stringify({ text: word + ' ' }),
        });
      }
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ conversationId: trimmedConvId }),
      });

      // Persist assistant message after stream completes
      options.messageStore?.addMessage({
        conversationId: trimmedConvId,
        role: 'assistant',
        content: responseText,
      });
    });
  });

  return app;
}
