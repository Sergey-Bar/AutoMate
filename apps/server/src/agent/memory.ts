import type { ExecutionLogRow } from '../db/schema.js';

export interface MemoryRepository {
  saveConversation(conv: { id: string; title: string | null }): Promise<void>;
  getConversation(id: string): Promise<{ id: string; title: string | null; createdAt: string } | null>;
  listConversations(opts?: { limit?: number; offset?: number }): Promise<
    Array<{ id: string; title: string | null; createdAt: string }>
  >;
  deleteConversation(id: string): Promise<void>;
  saveMessage(msg: {
    id: string;
    conversationId: string;
    role: string;
    content: string;
    toolCallId?: string | null;
    toolName?: string | null;
    metadata?: string | null;
  }): Promise<void>;
  listMessages(conversationId: string, opts?: { limit?: number; offset?: number }): Promise<
    Array<{
      id: string;
      conversationId: string;
      role: string;
      content: string;
      toolCallId: string | null;
      toolName: string | null;
      metadata: string | null;
      createdAt: string;
    }>
  >;
  insertExecutionLog(row: ExecutionLogRow): Promise<void>;
}

interface ConversationRow {
  id: string;
  title: string | null;
  createdAt: string;
}

interface MessageRow {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  toolCallId: string | null;
  toolName: string | null;
  metadata: string | null;
  createdAt: string;
}

/**
 * In-memory implementation of MemoryRepository.
 * 
 * WARNING: This is intended for TESTING ONLY. It grows unbounded with no
 * eviction or size limits. Production usage should use createDrizzleMemory().
 * 
 * @see createDrizzleMemory for production-grade persistence
 */
export function createMemoryRepository(): MemoryRepository {
  const conversations: ConversationRow[] = [];
  const messages: MessageRow[] = [];

  return {
    async saveConversation(c: { id: string; title: string | null }) {
      conversations.push({
        id: c.id,
        title: c.title,
        createdAt: new Date().toISOString(),
      });
    },

    async getConversation(id: string) {
      return conversations.find((c) => c.id === id) ?? null;
    },

    async listConversations(opts?: { limit?: number; offset?: number }) {
      const all = [...conversations];
      if (opts?.limit === undefined && opts?.offset === undefined) {
        return all;
      }

      const offset = opts?.offset ?? 0;
      const end = opts?.limit === undefined ? undefined : offset + opts.limit;
      return all.slice(offset, end);
    },

    async deleteConversation(id: string) {
      const idx = conversations.findIndex((c) => c.id === id);
      if (idx !== -1) conversations.splice(idx, 1);
      // Cascade: remove messages for this conversation
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].conversationId === id) messages.splice(i, 1);
      }
    },

    async saveMessage(msg: {
      id: string;
      conversationId: string;
      role: string;
      content: string;
      toolCallId?: string | null;
      toolName?: string | null;
      metadata?: string | null;
    }) {
      messages.push({
        id: msg.id,
        conversationId: msg.conversationId,
        role: msg.role,
        content: msg.content,
        toolCallId: msg.toolCallId ?? null,
        toolName: msg.toolName ?? null,
        metadata: msg.metadata ?? null,
        createdAt: new Date().toISOString(),
      });
    },

    async listMessages(conversationId: string, opts?: { limit?: number; offset?: number }) {
      const all = messages.filter((m) => m.conversationId === conversationId);
      if (opts?.limit === undefined && opts?.offset === undefined) {
        return all;
      }

      const offset = opts?.offset ?? 0;
      const end = opts?.limit === undefined ? undefined : offset + opts.limit;
      return all.slice(offset, end);
    },

    async insertExecutionLog(_row: ExecutionLogRow) {
      // In-memory implementation is a no-op — use DrizzleMemoryRepository for persistence.
    },
  };
}
