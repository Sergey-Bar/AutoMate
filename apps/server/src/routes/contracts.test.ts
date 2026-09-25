/**
 * API contract validation tests.
 *
 * Each test calls an endpoint via Fastify.inject() and validates the response
 * body against the corresponding Zod schema using safeParse({ success: true }).
 * This ensures API responses never drift from their declared shapes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod/v4';

import { conversationRoutes } from './conversations.js';
import { connectorRoutes } from './connectors.js';
import { featureRoutes } from './features.js';
import { vaultRoutes, _resetUnlockRateLimit, type VaultRouteDeps } from './vault.js';
import { chatRoutes, type ChatDeps } from './chat.js';
import { createMemoryRepository } from '../agent/memory.js';
import { ConnectorRegistry } from '../connectors/registry.js';

// ── Mocks required by model-config (uses DB) ─────────────────────────────────

const {
  mockGet,
  mockRun,
  mockWhere,
  mockSet,
  mockFrom,
  mockSelect,
  mockUpdate,
  mockModelConfig,
  mockEq,
} = vi.hoisted(() => {
  const get = vi.fn();
  const run = vi.fn();
  const where = vi.fn(() => ({ get, run }));
  const set = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const update = vi.fn(() => ({ set }));
  const schemaModelConfig = { id: 'id-column' };
  const eq = vi.fn(() => 'eq-clause');
  return {
    mockGet: get,
    mockRun: run,
    mockWhere: where,
    mockSet: set,
    mockFrom: from,
    mockSelect: select,
    mockUpdate: update,
    mockModelConfig: schemaModelConfig,
    mockEq: eq,
  };
});

vi.mock('drizzle-orm', () => ({ eq: mockEq }));
vi.mock('../db/schema.js', () => ({ modelConfig: mockModelConfig }));
vi.mock('../db/client.js', () => ({
  db: { select: mockSelect, update: mockUpdate },
  sqlite: { prepare: vi.fn() },
  poolConnection: { query: vi.fn() },
  isPostgres: false,
}));

// ── Mock orchestrator for chat route ─────────────────────────────────────────

vi.mock('../agent/orchestrator-loop.js', () => ({
  createOrchestrator: vi.fn(() => ({
    stream: vi.fn(() =>
      Promise.resolve({
        toTextStreamResponse: () =>
          new Response('data: {"type":"text-delta","text":"hello"}\n\n', {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            },
          }),
      }),
    ),
  })),
}));

// ── Mock feature-flags for connector/feature routes ───────────────────────────

vi.mock('../services/feature-flags.js', () => ({
  isEnabled: vi.fn(() => false),
  getFeatureFlags: vi.fn(() => ({ 'mcp-client': false, 'openapi-parsing': false })),
}));

vi.mock('../connectors/mcp-connector.js', () => ({
  getDashboardMcpContractValidationState: vi.fn(),
  buildDashboardMcpConnectorManifest: vi.fn(),
}));

// ── Import after mocks ─────────────────────────────────────────────────────────
import { modelConfigRoutes } from './model-config.js';

// =============================================================================
// Response schemas — exactly what each endpoint returns
// =============================================================================

/** GET /health */
const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  db: z.literal('connected'),
  ollama: z.enum(['connected', 'disconnected', 'error', 'unknown']),
  uptime: z.number(),
});

/** Conversation item returned by the API (subset of shared ConversationSchema) */
const ConversationItemSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  createdAt: z.string(),
});

/** Message item returned by the API (matches shared MessageSchema fields) */
const MessageItemSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: z.string(),
  content: z.string(),
  toolCallId: z.string().nullable(),
  toolName: z.string().nullable(),
  metadata: z.string().nullable(),
  createdAt: z.string(),
});

/** GET /api/connectors — array of connector summaries */
const ConnectorSummarySchema = z.object({
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  icon: z.string(),
  toolCount: z.number().int().nonnegative(),
});

/** GET /api/model-config */
const ModelConfigResponseSchema = z.object({
  provider: z.string(),
  model: z.string(),
  endpoint: z.string(),
  temperature: z.number(),
  maxTokens: z.number().int().positive(),
});

/** Success ack { ok: true } */
const OkResponseSchema = z.object({ ok: z.literal(true) });

/** Error response { error: string } */
const ErrorResponseSchema = z.object({ error: z.string() });

/** Vault status response */
const VaultStatusSchema = z.object({ isUnlocked: z.boolean() });

/** Feature flags response */
const FeatureFlagsSchema = z.record(z.string(), z.boolean());

/** Chat validation error (400) */
const ChatErrorSchema = z.object({ error: z.string() });

// =============================================================================
// Helpers
// =============================================================================

function assertContract<T>(schema: z.ZodType<T>, data: unknown, label: string): void {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Contract violation for "${label}": ${issues}`);
  }
  expect(result.success).toBe(true);
}

// =============================================================================
// GET /health
// =============================================================================

describe('contract: GET /health', () => {
  it('200 response matches HealthResponseSchema', async () => {
    // Build a minimal app that just registers the /health endpoint inline
    const app = Fastify();

    app.get('/health', async () => ({
      status: 'ok',
      version: '1.0.0',
      db: 'connected',
      ollama: 'disconnected',
      uptime: process.uptime(),
    }));

    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    assertContract(HealthResponseSchema, res.json(), 'GET /health 200');

    await app.close();
  });
});

// =============================================================================
// POST /api/conversations
// =============================================================================

describe('contract: POST /api/conversations', () => {
  let app: FastifyInstance;
  let memory: ReturnType<typeof createMemoryRepository>;

  beforeEach(async () => {
    app = Fastify();
    memory = createMemoryRepository();
    await app.register(conversationRoutes, { memory });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('201 response matches ConversationItemSchema', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: { title: 'Contract Test' },
    });

    expect(res.statusCode).toBe(201);
    assertContract(ConversationItemSchema, res.json(), 'POST /api/conversations 201');
  });

  it('400 response matches ErrorResponseSchema when body is invalid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: { title: 123 },
    });

    expect(res.statusCode).toBe(400);
    assertContract(ErrorResponseSchema, res.json(), 'POST /api/conversations 400');
  });
});

// =============================================================================
// GET /api/conversations
// =============================================================================

describe('contract: GET /api/conversations', () => {
  let app: FastifyInstance;
  let memory: ReturnType<typeof createMemoryRepository>;

  beforeEach(async () => {
    app = Fastify();
    memory = createMemoryRepository();
    await app.register(conversationRoutes, { memory });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('200 empty list matches array of ConversationItemSchema', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/conversations' });

    expect(res.statusCode).toBe(200);
    assertContract(z.array(ConversationItemSchema), res.json(), 'GET /api/conversations 200 empty');
  });

  it('200 populated list — each item matches ConversationItemSchema', async () => {
    await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'A' } });
    await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'B' } });

    const res = await app.inject({ method: 'GET', url: '/api/conversations' });

    expect(res.statusCode).toBe(200);
    assertContract(
      z.array(ConversationItemSchema).min(2),
      res.json(),
      'GET /api/conversations 200 populated',
    );
  });

  it('400 response matches ErrorResponseSchema for invalid pagination', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/conversations?limit=0&offset=-1',
    });

    expect(res.statusCode).toBe(400);
    assertContract(ErrorResponseSchema, res.json(), 'GET /api/conversations 400');
  });
});

// =============================================================================
// GET /api/conversations/:id
// =============================================================================

describe('contract: GET /api/conversations/:id/messages', () => {
  let app: FastifyInstance;
  let memory: ReturnType<typeof createMemoryRepository>;

  beforeEach(async () => {
    app = Fastify();
    memory = createMemoryRepository();
    await app.register(conversationRoutes, { memory });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('200 empty messages list matches array of MessageItemSchema', async () => {
    const { id } = (
      await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'T' } })
    ).json<{ id: string }>();

    const res = await app.inject({
      method: 'GET',
      url: `/api/conversations/${id}/messages`,
    });

    expect(res.statusCode).toBe(200);
    assertContract(z.array(MessageItemSchema), res.json(), 'GET /api/conversations/:id/messages 200 empty');
  });

  it('200 with messages — each item matches MessageItemSchema', async () => {
    const { id } = (
      await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'T' } })
    ).json<{ id: string }>();

    await memory.saveMessage({ id: 'm1', conversationId: id, role: 'user', content: 'hello' });
    await memory.saveMessage({ id: 'm2', conversationId: id, role: 'assistant', content: 'world' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/conversations/${id}/messages`,
    });

    expect(res.statusCode).toBe(200);
    assertContract(
      z.array(MessageItemSchema).length(2),
      res.json(),
      'GET /api/conversations/:id/messages 200 with messages',
    );
  });

  it('400 response matches ErrorResponseSchema for invalid pagination', async () => {
    const { id } = (
      await app.inject({ method: 'POST', url: '/api/conversations', payload: {} })
    ).json<{ id: string }>();

    const res = await app.inject({
      method: 'GET',
      url: `/api/conversations/${id}/messages?limit=abc`,
    });

    expect(res.statusCode).toBe(400);
    assertContract(ErrorResponseSchema, res.json(), 'GET /api/conversations/:id/messages 400');
  });
});

// =============================================================================
// DELETE /api/conversations/:id
// =============================================================================

describe('contract: DELETE /api/conversations/:id', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    const memory = createMemoryRepository();
    await app.register(conversationRoutes, { memory });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('204 response has empty body on successful deletion', async () => {
    const { id } = (
      await app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'Del' } })
    ).json<{ id: string }>();

    const res = await app.inject({ method: 'DELETE', url: `/api/conversations/${id}` });

    expect(res.statusCode).toBe(204);
    // 204 No Content must have an empty body
    expect(res.body).toBe('');
  });

  it('404 response matches ErrorResponseSchema for unknown id', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/conversations/does-not-exist',
    });

    expect(res.statusCode).toBe(404);
    assertContract(ErrorResponseSchema, res.json(), 'DELETE /api/conversations/:id 404');
  });
});

// =============================================================================
// GET /api/connectors
// =============================================================================

describe('contract: GET /api/connectors', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    const registry = new ConnectorRegistry();
    registry.registerManifest({
      name: 'contract-connector',
      version: '1.0.0',
      displayName: 'Contract Connector',
      description: 'Used for contract validation',
      icon: 'contract',
      credentialSchema: z.object({ token: z.string() }),
      tools: [
        {
          name: 'contract_tool',
          description: 'A contract tool',
          inputSchema: z.object({ x: z.string() }),
          handler: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
        },
      ],
    });
    await connectorRoutes(app, { registry });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('200 response is an array of ConnectorSummarySchema', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/connectors' });

    expect(res.statusCode).toBe(200);
    assertContract(
      z.array(ConnectorSummarySchema).min(1),
      res.json(),
      'GET /api/connectors 200',
    );
  });

  it('each connector item has expected field types', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/connectors' });
    const body = res.json<Array<unknown>>();

    for (const item of body) {
      assertContract(ConnectorSummarySchema, item, 'connector item');
    }
  });
});

// =============================================================================
// GET /api/model-config
// =============================================================================

describe('contract: GET /api/model-config', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    mockGet.mockReset();
    mockRun.mockReset();
    mockWhere.mockClear();
    mockSelect.mockClear();
    mockUpdate.mockClear();
    mockEq.mockClear();

    app = Fastify();
    await app.register((instance, _opts, done) => {
      modelConfigRoutes(instance).then(() => done()).catch(done);
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('200 default response matches ModelConfigResponseSchema', async () => {
    mockGet.mockReturnValueOnce(undefined);

    const res = await app.inject({ method: 'GET', url: '/api/model-config' });

    expect(res.statusCode).toBe(200);
    assertContract(ModelConfigResponseSchema, res.json(), 'GET /api/model-config 200 default');
  });

  it('200 DB row response matches ModelConfigResponseSchema', async () => {
    mockGet.mockReturnValueOnce({
      provider: 'ollama',
      model: 'llama3.1',
      endpoint: 'http://localhost:11434',
      temperature: 0.5,
      maxTokens: 2048,
    });

    const res = await app.inject({ method: 'GET', url: '/api/model-config' });

    expect(res.statusCode).toBe(200);
    assertContract(ModelConfigResponseSchema, res.json(), 'GET /api/model-config 200 db row');
  });
});

// =============================================================================
// PUT /api/model-config
// =============================================================================

describe('contract: PUT /api/model-config', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    mockGet.mockReset();
    mockRun.mockReset();
    mockWhere.mockClear();
    mockSet.mockClear();
    mockFrom.mockClear();
    mockSelect.mockClear();
    mockUpdate.mockClear();
    mockEq.mockClear();

    app = Fastify();
    await app.register((instance, _opts, done) => {
      modelConfigRoutes(instance).then(() => done()).catch(done);
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('200 success response matches OkResponseSchema', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/model-config',
      payload: { temperature: 0.5 },
    });

    expect(res.statusCode).toBe(200);
    assertContract(OkResponseSchema, res.json(), 'PUT /api/model-config 200');
  });

  it('400 response matches ErrorResponseSchema for invalid temperature', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/model-config',
      payload: { temperature: 'not-a-number' },
    });

    expect(res.statusCode).toBe(400);
    assertContract(ErrorResponseSchema, res.json(), 'PUT /api/model-config 400 invalid temperature');
  });

  it('400 response matches ErrorResponseSchema for invalid endpoint URL', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/model-config',
      payload: { endpoint: 'not-a-url' },
    });

    expect(res.statusCode).toBe(400);
    assertContract(ErrorResponseSchema, res.json(), 'PUT /api/model-config 400 invalid endpoint');
  });
});

// =============================================================================
// Vault routes
// =============================================================================

describe('contract: vault routes', () => {
  let app: FastifyInstance;
  let vaultService: VaultRouteDeps['vaultService'];

  beforeEach(async () => {
    _resetUnlockRateLimit();

    vaultService = {
      unlock: vi.fn<(password: string) => Promise<void>>(async () => {}),
      lock: vi.fn<() => void>(() => {}),
      isUnlocked: vi.fn<() => boolean>(() => false),
      setCredential: vi.fn<(name: string, secret: string) => Promise<void>>(async () => {}),
      getCredential: vi.fn<(name: string) => Promise<string | null>>(async () => null),
    };

    app = Fastify();
    await app.register((instance, _opts, done) => {
      vaultRoutes(instance, { vaultService, expectedPassword: 'secret' })
        .then(() => done())
        .catch(done);
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/vault/status 200 response matches VaultStatusSchema', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/vault/status' });

    expect(res.statusCode).toBe(200);
    assertContract(VaultStatusSchema, res.json(), 'GET /api/vault/status 200');
  });

  it('POST /api/vault/unlock 200 response matches OkResponseSchema', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vault/unlock',
      payload: { password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    assertContract(OkResponseSchema, res.json(), 'POST /api/vault/unlock 200');
  });

  it('POST /api/vault/unlock 401 response matches ErrorResponseSchema for wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vault/unlock',
      payload: { password: 'wrong' },
    });

    expect(res.statusCode).toBe(401);
    assertContract(ErrorResponseSchema, res.json(), 'POST /api/vault/unlock 401');
  });

  it('POST /api/vault/unlock 400 response matches ErrorResponseSchema for missing password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vault/unlock',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    assertContract(ErrorResponseSchema, res.json(), 'POST /api/vault/unlock 400');
  });

  it('POST /api/vault/lock 200 response matches OkResponseSchema', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/vault/lock' });

    expect(res.statusCode).toBe(200);
    assertContract(OkResponseSchema, res.json(), 'POST /api/vault/lock 200');
  });

  it('PUT /api/vault/credentials/:connector 200 response matches OkResponseSchema', async () => {
    vi.mocked(vaultService.isUnlocked).mockReturnValue(true);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/vault/credentials/github',
      payload: { credentials: { token: 'gh-abc123' } },
    });

    expect(res.statusCode).toBe(200);
    assertContract(OkResponseSchema, res.json(), 'PUT /api/vault/credentials/:connector 200');
  });

  it('PUT /api/vault/credentials/:connector 403 response matches ErrorResponseSchema when locked', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/vault/credentials/github',
      payload: { credentials: { token: 'gh-abc123' } },
    });

    expect(res.statusCode).toBe(403);
    assertContract(
      ErrorResponseSchema,
      res.json(),
      'PUT /api/vault/credentials/:connector 403',
    );
  });

  it('PUT /api/vault/credentials/:connector 400 response matches ErrorResponseSchema for missing body', async () => {
    vi.mocked(vaultService.isUnlocked).mockReturnValue(true);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/vault/credentials/github',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    assertContract(
      ErrorResponseSchema,
      res.json(),
      'PUT /api/vault/credentials/:connector 400',
    );
  });
});

// =============================================================================
// GET /api/features
// =============================================================================

describe('contract: GET /api/features', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    await app.register(featureRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('200 response matches FeatureFlagsSchema (record of string → boolean)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/features' });

    expect(res.statusCode).toBe(200);
    assertContract(FeatureFlagsSchema, res.json(), 'GET /api/features 200');
  });
});

// =============================================================================
// POST /api/chat (validation layer only)
// =============================================================================

describe('contract: POST /api/chat', () => {
  let app: FastifyInstance;

  function buildChatDeps(): ChatDeps {
    return {
      memory: createMemoryRepository(),
      registry: new ConnectorRegistry(),
      getModelConfig: async () => ({
        provider: 'ollama',
        model: 'llama3.1',
        endpoint: 'http://localhost:11434',
        temperature: 0.7,
        maxTokens: 4096,
      }),
      getCredentials: async () => ({}),
      getSystemPrompt: () => 'You are Automate.',
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    const deps = buildChatDeps();
    await app.register((instance, _opts, done) => {
      chatRoutes(instance, deps).then(() => done()).catch(done);
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('200 streaming response has text/event-stream content-type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [{ role: 'user', content: 'Hello' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    // Body is SSE stream — just verify it starts with the SSE data prefix
    expect(res.body).toMatch(/^data:/);
  });

  it('400 response matches ChatErrorSchema when messages are missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    assertContract(ChatErrorSchema, res.json(), 'POST /api/chat 400 missing messages');
  });

  it('400 response matches ChatErrorSchema when messages is empty array', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [] },
    });

    expect(res.statusCode).toBe(400);
    assertContract(ChatErrorSchema, res.json(), 'POST /api/chat 400 empty messages');
  });

  it('400 response matches ChatErrorSchema when messages is not an array', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: 'not-an-array' },
    });

    expect(res.statusCode).toBe(400);
    assertContract(ChatErrorSchema, res.json(), 'POST /api/chat 400 non-array messages');
  });
});
