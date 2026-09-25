import { describe, expect, it, beforeEach, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { createDrizzleMemory } from './memory-drizzle.js';
import type { MemoryRepository } from './memory.js';

// ---------------------------------------------------------------------------
// Build a mock drizzle-like db that stores data in memory
// ---------------------------------------------------------------------------

type AnyRow = Record<string, unknown>;

function buildMockDrizzleDb() {
  const tables: Record<string, AnyRow[]> = {
    conversations: [],
    messages: [],
    execution_log: [],
  };

  function tableName(table: Parameters<typeof getTableName>[0]): string {
    return getTableName(table);
  }

  return {
    _tables: tables,

    insert(table: Parameters<typeof getTableName>[0]) {
      const name = tableName(table);
      return {
        values(vals: AnyRow) {
          if (!tables[name]) tables[name] = [];
          tables[name].push({ ...vals });
          return Promise.resolve([]);
        },
      };
    },

    select() {
      return {
        from(table: Parameters<typeof getTableName>[0]) {
          const name = tableName(table);
          const store = tables[name] ?? [];

          function makeChain(rows: AnyRow[]) {
            return {
              where(_cond: unknown) {
                return makeChain(rows);
              },
              orderBy(..._args: unknown[]) {
                return makeChain(rows);
              },
              limit(n: number) {
                const limited = rows.slice(0, n);
                return {
                  offset(o: number) {
                    return Promise.resolve(rows.slice(o, o + n));
                  },
                  then(resolve: (v: AnyRow[]) => unknown, reject?: (e: unknown) => unknown) {
                    return Promise.resolve(limited).then(resolve, reject);
                  },
                };
              },
              offset(o: number) {
                return {
                  then(resolve: (v: AnyRow[]) => unknown, reject?: (e: unknown) => unknown) {
                    return Promise.resolve(rows.slice(o)).then(resolve, reject);
                  },
                };
              },
              then(resolve: (v: AnyRow[]) => unknown, reject?: (e: unknown) => unknown) {
                return Promise.resolve(rows).then(resolve, reject);
              },
            };
          }

          return makeChain(store);
        },
      };
    },

    delete(table: Parameters<typeof getTableName>[0]) {
      const name = tableName(table);
      return {
        where(_cond: unknown) {
          tables[name] = [];
          return Promise.resolve([]);
        },
      };
    },

    execute: vi.fn().mockResolvedValue([]),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DrizzleMemory', () => {
  let repo: MemoryRepository;
  let mockDb: ReturnType<typeof buildMockDrizzleDb>;

  beforeEach(() => {
    mockDb = buildMockDrizzleDb();
    repo = createDrizzleMemory(mockDb as unknown as Parameters<typeof createDrizzleMemory>[0]);
  });

  it('saves and retrieves a conversation', async () => {
    await repo.saveConversation({ id: 'c1', title: 'Test Chat' });
    const conv = await repo.getConversation('c1');
    expect(conv).toBeTruthy();
    expect(conv!.title).toBe('Test Chat');
    expect(conv!.createdAt).toBeDefined();
  });

  it('returns null for nonexistent conversation', async () => {
    const conv = await repo.getConversation('nonexistent');
    expect(conv).toBeNull();
  });

  it('lists conversations', async () => {
    await repo.saveConversation({ id: 'c1', title: 'First' });
    await repo.saveConversation({ id: 'c2', title: 'Second' });
    const list = await repo.listConversations();
    expect(list).toHaveLength(2);
  });

  it('saves and lists messages for a conversation', async () => {
    await repo.saveConversation({ id: 'c1', title: null });
    await repo.saveMessage({ id: 'm1', conversationId: 'c1', role: 'user', content: 'hello' });
    await repo.saveMessage({ id: 'm2', conversationId: 'c1', role: 'assistant', content: 'hi there' });
    const msgs = await repo.listMessages('c1');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('hello');
  });

  it('saves message with tool fields', async () => {
    await repo.saveConversation({ id: 'c1', title: null });
    await repo.saveMessage({
      id: 'm1',
      conversationId: 'c1',
      role: 'tool',
      content: 'result',
      toolCallId: 'tc1',
      toolName: 'github_create_issue',
      metadata: '{"key":"value"}',
    });
    const msgs = await repo.listMessages('c1');
    expect(msgs[0].toolCallId).toBe('tc1');
    expect(msgs[0].toolName).toBe('github_create_issue');
    expect(msgs[0].metadata).toBe('{"key":"value"}');
  });

  it('deletes conversation', async () => {
    await repo.saveConversation({ id: 'c1', title: null });
    await repo.saveMessage({ id: 'm1', conversationId: 'c1', role: 'user', content: 'hello' });
    await repo.deleteConversation('c1');
    const conv = await repo.getConversation('c1');
    expect(conv).toBeNull();
  });

  it('returns empty array for nonexistent conversation messages', async () => {
    const msgs = await repo.listMessages('nonexistent');
    expect(msgs).toEqual([]);
  });

  it('listConversations with offset-only does not crash', async () => {
    await repo.saveConversation({ id: 'c1', title: 'First' });
    await repo.saveConversation({ id: 'c2', title: 'Second' });
    await repo.saveConversation({ id: 'c3', title: 'Third' });
    const list = await repo.listConversations({ offset: 1 });
    expect(list.length).toBeGreaterThanOrEqual(0);
  });

  it('listConversations with limit-only works', async () => {
    await repo.saveConversation({ id: 'c1', title: 'First' });
    await repo.saveConversation({ id: 'c2', title: 'Second' });
    await repo.saveConversation({ id: 'c3', title: 'Third' });
    const list = await repo.listConversations({ limit: 2 });
    expect(list.length).toBeLessThanOrEqual(2);
  });

  it('listMessages with offset-only does not crash', async () => {
    await repo.saveConversation({ id: 'c1', title: null });
    await repo.saveMessage({ id: 'm1', conversationId: 'c1', role: 'user', content: 'one' });
    await repo.saveMessage({ id: 'm2', conversationId: 'c1', role: 'user', content: 'two' });
    await repo.saveMessage({ id: 'm3', conversationId: 'c1', role: 'user', content: 'three' });
    const msgs = await repo.listMessages('c1', { offset: 1 });
    expect(msgs.length).toBeGreaterThanOrEqual(0);
  });

  it('listMessages with limit-only works', async () => {
    await repo.saveConversation({ id: 'c1', title: null });
    await repo.saveMessage({ id: 'm1', conversationId: 'c1', role: 'user', content: 'one' });
    await repo.saveMessage({ id: 'm2', conversationId: 'c1', role: 'user', content: 'two' });
    await repo.saveMessage({ id: 'm3', conversationId: 'c1', role: 'user', content: 'three' });
    const msgs = await repo.listMessages('c1', { limit: 2 });
    expect(msgs.length).toBeLessThanOrEqual(2);
  });
});
