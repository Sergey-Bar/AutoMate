// apps/server/src/__tests__/integration/chat-flow.test.ts
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
          new Response(
            'data: {"type":"text-delta","text":"Hello from Automate!"}\n\ndata: [DONE]\n\n',
            {
              status: 200,
              headers: {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
              },
            },
          ),
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
        if (cond && typeof cond === 'object' && cond.left && cond.right && cond.left.name === 'id') {
          builder._filterId = cond.right.value;
        }
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
    update: vi.fn((table) => {
      const name = getTableName(table);
      return {
        set: vi.fn((vals) => {
          return {
            where: vi.fn((cond) => {
              if (cond && typeof cond === 'object' && cond.left && cond.right && cond.left.name === 'id') {
                const id = cond.right.value;
                const idx = (tables[name] ?? []).findIndex(r => r.id === id);
                if (idx !== -1) {
                  tables[name][idx] = { ...tables[name][idx], ...vals };
                }
              }
              return Promise.resolve([]);
            }),
          };
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

describe('chat flow integration', () => {
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

  it('POST /api/chat returns streaming response', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'Hello' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('text-delta');
  });

  it('creates a conversation when no conversationId is provided', async () => {
    const chatRes = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'Test conversation creation' }] },
    });
    expect(chatRes.statusCode).toBe(200);

    // Verify conversation was persisted
    const listRes = await app.inject({ method: 'GET', url: '/api/conversations' });
    const conversations = listRes.json() as Array<{ id: string; title: string | null }>;
    expect(conversations.length).toBeGreaterThanOrEqual(1);
    // The chat route auto-creates with the first user message as title
    const found = conversations.find(c => c.title === 'Test conversation creation');
    expect(found).toBeDefined();
  });

  it('persists user message to the conversation', async () => {
    // Create conversation first
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: { title: 'Message Persistence Test' },
    });
    const { id: convId } = createRes.json() as { id: string };

    // Send chat with that conversationId
    const chatRes = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        messages: [{ role: 'user', content: 'Persisted message' }],
        conversationId: convId,
      },
    });
    expect(chatRes.statusCode).toBe(200);

    // Verify message was saved
    const msgRes = await app.inject({
      method: 'GET',
      url: `/api/conversations/${convId}/messages`,
    });
    const messages = msgRes.json() as Array<{ role: string; content: string }>;
    expect(messages.length).toBeGreaterThanOrEqual(1);
    const userMsg = messages.find(m => m.role === 'user' && m.content === 'Persisted message');
    expect(userMsg).toBeDefined();
  });

  it('rejects requests without messages array', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects requests with non-array messages', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: 'not-an-array' },
    });
    expect(res.statusCode).toBe(400);
  });
});
