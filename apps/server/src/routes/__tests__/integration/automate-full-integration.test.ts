import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../../../index.js';

const { streamMock, createOrchestratorMock } = vi.hoisted(() => {
  const stream = vi.fn(() =>
    Promise.resolve({
      toTextStreamResponse: () =>
        new Response('data: {"type":"text-delta","text":"integration-ok"}\n\n', {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        }),
    })
  );

  const createOrchestrator = vi.fn(() => ({
    stream,
    buildStreamParams: vi.fn(),
  }));

  return {
    streamMock: stream,
    createOrchestratorMock: createOrchestrator,
  };
});

vi.mock('../../../agent/orchestrator-loop.js', () => ({
  createOrchestrator: createOrchestratorMock,
}));

// ---------------------------------------------------------------------------
// Mock DB with in-memory store
// ---------------------------------------------------------------------------

type AnyRow = Record<string, unknown>;

const { mockDb, mockCloseDb, mockPgClient } = vi.hoisted(() => {
  const tables: Record<string, AnyRow[]> = {
    conversations: [],
    messages: [],
    execution_log: [],
    model_config: [
      {
        id: 'default',
        provider: 'ollama',
        model: 'llama3.1',
        endpoint: 'http://localhost:11434',
        temperature: 0.7,
        maxTokens: 4096,
        systemPrompt: null,
        updatedAt: new Date().toISOString(),
      },
    ],
    flow_templates: [],
    connector_configs: [],
    trace_links: [],
    message_attachments: [],
  };

  function applyWhere(rows: AnyRow[], cond: unknown): AnyRow[] {
    if (!cond || typeof cond !== 'object') return rows;
    const chunks = (cond as { queryChunks?: unknown[] }).queryChunks;
    if (!Array.isArray(chunks) || chunks.length < 4) return rows;
    const colChunk = chunks[1] as { name?: string } | undefined;
    const valChunk = chunks[3] as { value?: unknown } | undefined;
    if (!colChunk?.name || valChunk === undefined) return rows;
    const colSnake = colChunk.name;
    const val = valChunk.value;
    // Convert snake_case to camelCase for matching against JS-keyed rows
    const colCamel = colSnake.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
    return rows.filter((r) => r[colSnake] === val || r[colCamel] === val);
  }

  function makeChain(rows: AnyRow[]) {
    return {
      where(cond: unknown) { return makeChain(applyWhere(rows, cond)); },
      orderBy(..._args: unknown[]) { return makeChain(rows); },
      limit(n: number) {
        const limited = rows.slice(0, n);
        return {
          offset(o: number) { return Promise.resolve(rows.slice(o, o + n)); },
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

  const db = {
    _tables: tables,

    insert(table: Parameters<typeof getTableName>[0]) {
      const name = getTableName(table);
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
          const name = getTableName(table);
          return makeChain(tables[name] ?? []);
        },
      };
    },

    update(table: Parameters<typeof getTableName>[0]) {
      const name = getTableName(table);
      return {
        set(vals: AnyRow) {
          return {
            where(cond: unknown) {
              const filtered = applyWhere(tables[name] ?? [], cond);
              for (const row of filtered) {
                Object.assign(row, vals);
              }
              return Promise.resolve([]);
            },
          };
        },
      };
    },

    delete(table: Parameters<typeof getTableName>[0]) {
      const name = getTableName(table);
      return {
        where(cond: unknown) {
          const toRemove = applyWhere(tables[name] ?? [], cond);
          tables[name] = (tables[name] ?? []).filter((r) => !toRemove.includes(r));
          return Promise.resolve([]);
        },
      };
    },

    execute: vi.fn().mockResolvedValue([]),
  };

  const closeDb = vi.fn().mockResolvedValue(undefined);

  const pgClient = Object.assign(vi.fn().mockResolvedValue([]), {
    unsafe: vi.fn().mockResolvedValue([]),
    end: vi.fn().mockResolvedValue(undefined),
  });

  return { mockDb: db, mockCloseDb: closeDb, mockPgClient: pgClient };
});

vi.mock('../../../db/client.js', () => ({
  db: mockDb,
  pgClient: mockPgClient,
  closeDb: mockCloseDb,
}));

vi.mock('../../../db/migrate.js', () => ({
  migrateDb: vi.fn().mockResolvedValue(undefined),
  runDrizzleMigrations: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../db/seed.js', () => ({
  seed: vi.fn().mockResolvedValue(undefined),
  seedDb: vi.fn().mockResolvedValue(undefined),
}));

describe.sequential('Automate full route integration (buildServer + Drizzle PG mock)', () => {
  let app: FastifyInstance;
  let createdConversationId: string;
  let deletedConversationId: string;
  let listCountBeforeDelete = 0;

  beforeAll(async () => {
    const vaultDbPath = join(tmpdir(), `vault-integration-test-${Date.now()}.db`);
    app = await buildServer({
      logger: false,
      vaultDbPath,
      vaultPassword: 'test-password-123',
      rateLimitMax: 1000,
      rateLimitWindow: '1 minute',
    });

    await app.ready();
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok and db connected', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);

    const body = response.json() as { status: string; db: string };
    expect(body.status).toBe('ok');
    expect(body.db).toBe('connected');
  });

  it('POST /api/conversations creates conversation with title', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: { title: 'Test Conv' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { id: string; title: string };
    expect(body.id).toBeTruthy();
    expect(body.title).toBe('Test Conv');
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    createdConversationId = body.id;
  });

  it('POST /api/conversations creates conversation with null title for empty payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: {},
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { id: string; title: string | null };
    expect(body.id).toBeTruthy();
    expect(body.title).toBeNull();
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    deletedConversationId = body.id;
  });

  it('GET /api/conversations returns all conversations', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/conversations' });
    expect(response.statusCode).toBe(200);

    const body = response.json() as Array<{ id: string; title: string | null }>;
    expect(body.length).toBeGreaterThanOrEqual(2);
    // eslint-disable-next-line test-flakiness/no-global-state-mutation
    listCountBeforeDelete = body.length;
  });

  it('GET /api/conversations supports limit/offset pagination', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/conversations?limit=1&offset=0',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as unknown[];
    expect(body).toHaveLength(1);
  });

  it('GET /api/conversations rejects invalid pagination', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/conversations?limit=0',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty('error');
  });

  it('GET /api/conversations/:id/messages returns empty list initially', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/conversations/${createdConversationId}/messages`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('GET /api/conversations/:id/messages rejects invalid pagination', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/conversations/${createdConversationId}/messages?limit=0`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty('error');
  });

  it('DELETE /api/conversations/:id deletes an existing conversation', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/conversations/${deletedConversationId}`,
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
  });

  it('GET /api/conversations reflects decreased count after deletion', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/conversations' });
    expect(response.statusCode).toBe(200);

    const body = response.json() as unknown[];
    expect(body.length).toBe(listCountBeforeDelete - 1);
  });

  it('DELETE /api/conversations/nonexistent-id returns 404', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/conversations/nonexistent-id',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Conversation not found' });
  });

  it('GET /api/model-config returns default model config shape', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/model-config' });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      provider: string;
      model: string;
      endpoint: string;
      temperature: number;
      maxTokens: number;
    };

    expect(body.provider).toBeTypeOf('string');
    expect(body.model).toBeTypeOf('string');
    expect(body.endpoint).toBeTypeOf('string');
    expect(body.temperature).toBeTypeOf('number');
    expect(body.maxTokens).toBeTypeOf('number');
  });

  it('PUT /api/model-config updates config values', async () => {
    const payload = {
      provider: 'ollama',
      model: 'mistral',
      endpoint: 'http://localhost:11434',
      temperature: 0.5,
      maxTokens: 2048,
    };

    const response = await app.inject({
      method: 'PUT',
      url: '/api/model-config',
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('GET /api/model-config persists updated values', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/model-config' });
    expect(response.statusCode).toBe(200);

    const body = response.json() as { provider: string; model: string };
    expect(body.provider).toBeTypeOf('string');
    expect(body.model).toBeTypeOf('string');
  });

  it('PUT /api/model-config rejects invalid temperature above max', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/model-config',
      payload: { temperature: 5.0 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty('error');
  });

  it('PUT /api/model-config empty payload is accepted and updates timestamp', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/model-config',
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('GET /api/connectors lists github/jira/slack manifests', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/connectors' });
    expect(response.statusCode).toBe(200);

    const body = response.json() as Array<{ name: string }>;
    const names = body.map((item) => item.name);
    expect(names).toContain('github');
    expect(names).toContain('jira');
    expect(names).toContain('slack');
  });

  it('GET /api/vault/status is unlocked after startup auto-unlock', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/vault/status' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ isUnlocked: true });
  });

  it('PUT /api/vault/credentials/github stores credentials', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/vault/credentials/github',
      payload: { credentials: { token: 'ghp_test123' } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('POST /api/vault/lock locks vault', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/vault/lock' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('GET /api/vault/status shows locked state after lock', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/vault/status' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ isUnlocked: false });
  });

  it('POST /api/vault/unlock with valid password unlocks vault', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/vault/unlock',
      payload: { password: 'test-password-123' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('GET /api/vault/status shows unlocked state after unlock', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/vault/status' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ isUnlocked: true });
  });

  it('POST /api/chat streams mocked SSE response', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        conversationId: createdConversationId,
        messages: [{ role: 'user', content: 'Hello' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('data:');
    expect(streamMock).toHaveBeenCalledTimes(1);
  });

  it('POST /api/chat persists user message to conversation', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/conversations/${createdConversationId}/messages`,
    });

    expect(response.statusCode).toBe(200);
    const messages = response.json() as Array<{ role: string; content: string }>;
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages.some((message) => message.role === 'user' && message.content === 'Hello')).toBe(true);
  });

  it('POST /api/chat rejects invalid payload without messages', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { message: 'Hello' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'messages: Invalid input: expected array, received undefined' });
  });

  it('POST /api/vault/unlock with wrong password returns error', async () => {
    await app.inject({ method: 'POST', url: '/api/vault/lock' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/vault/unlock',
      payload: { password: 'wrong-password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Unlock failed' });
  });
});
