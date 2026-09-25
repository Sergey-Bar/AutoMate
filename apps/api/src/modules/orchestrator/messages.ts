/**
 * messages.ts — Message store and routes
 *
 * GET /api/v1/orchestrator/conversations/:id/messages  — list messages for a conversation
 */
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import type { ConversationStore } from './conversations.js';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string; // ISO-8601
}

// ---------------------------------------------------------------------------
// Store interface + in-memory implementation
// ---------------------------------------------------------------------------

export interface MessageStore {
  addMessage(msg: Omit<Message, 'id' | 'createdAt'>): Message;
  listMessages(conversationId: string): Message[];
}

export class InMemoryMessageStore implements MessageStore {
  private readonly _messages: Message[] = [];

  addMessage(msg: Omit<Message, 'id' | 'createdAt'>): Message {
    const message: Message = {
      id: randomUUID(),
      conversationId: msg.conversationId,
      role: msg.role,
      content: msg.content,
      createdAt: new Date().toISOString(),
    };
    this._messages.push(message);
    return message;
  }

  listMessages(conversationId: string): Message[] {
    return this._messages
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

// ---------------------------------------------------------------------------
// Options + route factory
// ---------------------------------------------------------------------------

export interface OrchestratorMessageRouteOptions {
  conversationStore: ConversationStore;
  messageStore: MessageStore;
}

export function createOrchestratorMessageRoutes(
  options: OrchestratorMessageRouteOptions,
): Hono {
  const app = new Hono();

  // ── GET /api/v1/orchestrator/conversations/:id/messages ───────────────────
  app.get('/api/v1/orchestrator/conversations/:id/messages', (c) => {
    const id = c.req.param('id');
    const conv = options.conversationStore.get(id);
    if (!conv) {
      return c.json({ error: 'Conversation not found' }, 404);
    }
    return c.json(options.messageStore.listMessages(id));
  });

  return app;
}
