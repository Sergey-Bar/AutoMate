// apps/server/src/__tests__/integration/conversations.test.ts
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTableName } from 'drizzle-orm';

// Mock connector manifest imports so tests don't require packages to be built
vi.mock('../../../../../../packages/connectors/github/src/index.js', () => ({
  githubManifest: {
    name: 'github',
    version: '0.1.0',
    displayName: 'GitHub',
    description: 'GitHub connector',
    icon: 'github',
    credentialSchema: {},
    tools: [{ name: 'create_issue', description: 'Create issue', inputSchema: {}, handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }],
  },
}));
vi.mock('../../../../../../packages/connectors/jira/src/index.js', () => ({
  jiraManifest: {
    name: 'jira',
    version: '0.1.0',
    displayName: 'Jira',
    description: 'Jira connector',
    icon: 'jira',
    credentialSchema: {},
    tools: [{ name: 'create_ticket', description: 'Create ticket', inputSchema: {}, handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }],
  },
}));
vi.mock('../../../../../../packages/connectors/slack/src/index.js', () => ({
  slackManifest: {
    name: 'slack',
    version: '0.1.0',
    displayName: 'Slack',
    description: 'Slack connector',
    icon: 'slack',
    credentialSchema: {},
    tools: [{ name: 'send_message', description: 'Send message', inputSchema: {}, handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }],
  },
}));

// Mock orchestrator-loop to avoid real LLM/tool calls
vi.mock('../../agent/orchestrator-loop.js', () => ({
  createOrchestrator: vi.fn(() => ({
    stream: vi.fn(() =>
      Promise.resolve({
        toTextStreamResponse: () =>
          new Response('data: {"type":"text-delta","text":"hello"}\n\n', {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
          }),
      }),
    ),
    buildStreamParams: vi.fn(),
  })),
}));

// Mock DB with in-memory store
const { mockDb, mockPgClient, mockCloseDb, clearTables } = vi.hoisted(() => {
  let tables: Record<string, any[]> = {};

  const createQueryBuilder = (tableName: string) => {
    const builder: any = {
      where: vi.fn((cond) => {
        // Simple mock: if we have an ID filter, try to apply it
        if (cond && typeof cond === 'object' && cond.left && cond.right && cond.left.name === 'id') {
          builder._filterId = cond.right.value;
        }
        // Support conversationId filter too
        if (cond && typeof cond === 'object' && cond.left && cond.right && cond.left.name === 'conversation_id') {
          builder._filterConvId = cond.right.value;
        }
        return builder;
      }),
      orderBy: vi.fn(() => builder),
      limit: vi.fn((val) => {
        builder._limit = val;
        return builder;
      }),
      offset: vi.fn((val) => {
        builder._offset = val;
        return builder;
      }),
      then: (onfulfilled: any) => {
        let rows = [...(tables[tableName] ?? [])];
        if (builder._filterId) {
          rows = rows.filter(r => r.id === builder._filterId);
        }
        if (builder._filterConvId) {
          rows = rows.filter(r => r.conversationId === builder._filterConvId);
        }
        if (builder._offset !== undefined) {
          rows = rows.slice(builder._offset);
        }
        if (builder._limit !== undefined) {
          rows = rows.slice(0, builder._limit);
        }
        return Promise.resolve(rows).then(onfulfilled);
      },
      catch: (onrejected: any) => Promise.resolve([]).catch(onrejected),
    };
    return builder;
  };

  const db = {
    insert: vi.fn((table) => {
      const name = getTableName(table);
      return {
        values: vi.fn((vals) => {
          if (!tables[name]) tables[name] = [];
          const rows = Array.isArray(vals) ? vals : [vals];
          tables[name].push(...rows);
          return Promise.resolve(rows);
        }),
      };
    }),
    select: vi.fn(() => ({
      from: vi.fn((table) => {
        const name = getTableName(table);
        return createQueryBuilder(name);
      }),
    })),
    delete: vi.fn((table) => {
      const name = getTableName(table);
      return {
        where: vi.fn((cond) => {
          if (cond && typeof cond === 'object' && cond.left && cond.right && (cond.left.name === 'id' || cond.left.name === 'conversation_id')) {
            const col = cond.left.name === 'id' ? 'id' : 'conversationId';
            const val = cond.right.value;
            tables[name] = (tables[name] ?? []).filter(r => r[col] !== val);
          } else {
            tables[name] = [];
          }
          return Promise.resolve([]);
        }),
      };
    }),
    execute: vi.fn().mockResolvedValue([]),
  };
  const pgClient = Object.assign(vi.fn().mockResolvedValue([]), {
    unsafe: vi.fn().mockResolvedValue([]),
    end: vi.fn().mockResolvedValue(undefined),
  });
  return { 
    mockDb: db, 
    mockPgClient: pgClient, 
    mockCloseDb: vi.fn().mockResolvedValue(undefined),
    clearTables: () => { tables = {}; }
  };
});

vi.mock('../../db/client.js', () => ({
  db: mockDb,
  pgClient: mockPgClient,
  closeDb: mockCloseDb,
}));

vi.mock('../../db/migrate.js', () => ({
  migrateDb: vi.fn().mockResolvedValue(undefined),
  runDrizzleMigrations: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../db/seed.js', () => ({
  seed: vi.fn().mockResolvedValue(undefined),
}));

import { buildServer } from '../../index.js';

describe('conversation persistence integration', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    app = await buildServer({ logger: false });
  });

  beforeEach(() => {
    clearTables();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates and retrieves conversations', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: { title: 'Integration Test' },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as { id: string; title: string };
    expect(created.id).toBeDefined();
    expect(created.title).toBe('Integration Test');

    const listRes = await app.inject({ method: 'GET', url: '/api/conversations' });
    expect(listRes.statusCode).toBe(200);
    const conversations = listRes.json() as Array<{ id: string; title: string }>;
    const found = conversations.find(c => c.id === created.id);
    expect(found).toBeDefined();
    expect(found!.title).toBe('Integration Test');
  });

  it('creates conversation with no title (null)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: {},
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as { id: string; title: string | null };
    expect(created.id).toBeDefined();
    expect(created.title).toBeNull();
  });

  it('deletes a conversation', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: { title: 'To Delete' },
    });
    const { id } = createRes.json() as { id: string };

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/conversations/${id}`,
    });
    expect(deleteRes.statusCode).toBe(204);

    // Verify it's gone
    const listRes = await app.inject({ method: 'GET', url: '/api/conversations' });
    const conversations = listRes.json() as Array<{ id: string }>;
    expect(conversations.find(c => c.id === id)).toBeUndefined();
  });

  it('retrieves messages for a conversation', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: { title: 'With Messages' },
    });
    const { id } = createRes.json() as { id: string };

    // Initially empty
    const msgRes = await app.inject({
      method: 'GET',
      url: `/api/conversations/${id}/messages`,
    });
    expect(msgRes.statusCode).toBe(200);
    expect(msgRes.json()).toEqual([]);
  });

  it('chat creates messages visible via conversation API', async () => {
    // Create a conversation
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: { title: 'Chat Messages' },
    });
    const { id: convId } = createRes.json() as { id: string };

    // Send a chat message to this conversation
    await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        messages: [{ role: 'user', content: 'Hello from integration test' }],
        conversationId: convId,
      },
    });

    // Verify message appears via conversation messages endpoint
    const msgRes = await app.inject({
      method: 'GET',
      url: `/api/conversations/${convId}/messages`,
    });
    const messages = msgRes.json() as Array<{ role: string; content: string }>;
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Hello from integration test');
  });
});
