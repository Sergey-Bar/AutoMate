/**
 * conversations.ts — In-memory conversation store and routes
 *
 * POST   /api/v1/orchestrator/conversations      — create a conversation (title required)
 * GET    /api/v1/orchestrator/conversations      — list all conversations
 * GET    /api/v1/orchestrator/conversations/:id  — get single conversation
 * DELETE /api/v1/orchestrator/conversations/:id  — delete a conversation
 */
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface Conversation {
  id: string;
  title: string;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

// ---------------------------------------------------------------------------
// Store interface + in-memory implementation
// ---------------------------------------------------------------------------

export interface ConversationStore {
  create(title: string): Conversation;
  list(): Conversation[];
  get(id: string): Conversation | undefined;
  remove(id: string): boolean;
}

export class InMemoryConversationStore implements ConversationStore {
  private readonly _conversations = new Map<string, Conversation>();

  create(title: string): Conversation {
    const now = new Date().toISOString();
    const conv: Conversation = {
      id: randomUUID(),
      title,
      createdAt: now,
      updatedAt: now,
    };
    this._conversations.set(conv.id, conv);
    return conv;
  }

  list(): Conversation[] {
    return Array.from(this._conversations.values());
  }

  get(id: string): Conversation | undefined {
    return this._conversations.get(id);
  }

  remove(id: string): boolean {
    return this._conversations.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Options + route factory
// ---------------------------------------------------------------------------

export interface OrchestratorConversationOptions {
  store: ConversationStore;
}

export function createOrchestratorConversationRoutes(
  options: OrchestratorConversationOptions,
): Hono {
  const app = new Hono();

  // ── POST /api/v1/orchestrator/conversations ────────────────────────────────
  app.post('/api/v1/orchestrator/conversations', async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const { title } = body;

    if (typeof title !== 'string' || !title.trim()) {
      return c.json({ error: 'title is required' }, 400);
    }

    const conv = options.store.create(title.trim());
    return c.json(conv, 201);
  });

  // ── GET /api/v1/orchestrator/conversations ────────────────────────────────
  app.get('/api/v1/orchestrator/conversations', (c) => {
    return c.json(options.store.list());
  });

  // ── GET /api/v1/orchestrator/conversations/:id ────────────────────────────
  app.get('/api/v1/orchestrator/conversations/:id', (c) => {
    const id = c.req.param('id');
    const conv = options.store.get(id);
    if (!conv) {
      return c.json({ error: 'Conversation not found' }, 404);
    }
    return c.json(conv);
  });

  // ── DELETE /api/v1/orchestrator/conversations/:id ─────────────────────────
  app.delete('/api/v1/orchestrator/conversations/:id', (c) => {
    const id = c.req.param('id');
    const removed = options.store.remove(id);
    if (!removed) {
      return c.json({ error: 'Conversation not found' }, 404);
    }
    return c.json({ deleted: true });
  });

  return app;
}
