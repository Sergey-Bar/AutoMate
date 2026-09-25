import { eq, desc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { conversations, messages, executionLog } from '../db/schema.js';
import type { MemoryRepository } from './memory.js';

export function createDrizzleMemory(db: PostgresJsDatabase<Record<string, unknown>>): MemoryRepository {
  return {
    async saveConversation(conv) {
      const now = new Date().toISOString();
      await db.insert(conversations)
        .values({
          id: conv.id,
          title: conv.title,
          createdAt: now,
          updatedAt: now,
        });
    },

    async getConversation(id) {
      const rows = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, id));

      const row = rows[0];
      if (!row) return null;

      return {
        id: row.id,
        title: row.title,
        createdAt: row.createdAt,
      };
    },

    async listConversations(opts?: { limit?: number; offset?: number }) {
      const baseQuery = db
        .select()
        .from(conversations)
        .orderBy(desc(conversations.createdAt), desc(conversations.id));

      let rows;
      if (opts?.limit !== undefined && opts?.offset !== undefined) {
        rows = await baseQuery.limit(opts.limit).offset(opts.offset);
      } else if (opts?.limit !== undefined) {
        rows = await baseQuery.limit(opts.limit);
      } else if (opts?.offset !== undefined) {
        rows = await baseQuery.offset(opts.offset);
      } else {
        rows = await baseQuery;
      }

      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        createdAt: row.createdAt,
      }));
    },

    async deleteConversation(id) {
      await db.delete(conversations).where(eq(conversations.id, id));
    },

    async saveMessage(msg) {
      const now = new Date().toISOString();
      await db.insert(messages)
        .values({
          id: msg.id,
          conversationId: msg.conversationId,
          role: msg.role as 'user' | 'assistant' | 'system' | 'tool',
          content: msg.content,
          toolCallId: msg.toolCallId ?? null,
          toolName: msg.toolName ?? null,
          metadata: msg.metadata ?? null,
          createdAt: now,
        });
    },

    async listMessages(conversationId, opts?: { limit?: number; offset?: number }) {
      const baseQuery = db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(messages.createdAt);

      let rows;
      if (opts?.limit !== undefined && opts?.offset !== undefined) {
        rows = await baseQuery.limit(opts.limit).offset(opts.offset);
      } else if (opts?.limit !== undefined) {
        rows = await baseQuery.limit(opts.limit);
      } else if (opts?.offset !== undefined) {
        rows = await baseQuery.offset(opts.offset);
      } else {
        rows = await baseQuery;
      }

      return rows.map((row) => ({
        id: row.id,
        conversationId: row.conversationId,
        role: row.role,
        content: row.content,
        toolCallId: row.toolCallId,
        toolName: row.toolName,
        metadata: row.metadata,
        createdAt: row.createdAt,
      }));
    },

    async insertExecutionLog(row) {
      await db.insert(executionLog).values(row);
    },
  };
}
