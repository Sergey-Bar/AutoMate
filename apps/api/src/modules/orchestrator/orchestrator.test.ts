/**
 * orchestrator.test.ts — Comprehensive tests for the orchestrator module
 *
 * Covers:
 *  Conversations:
 *   1.  POST /api/v1/orchestrator/conversations — creates conversation, returns 201 with id
 *   2.  POST /api/v1/orchestrator/conversations — 400 when title is missing
 *   3.  POST /api/v1/orchestrator/conversations — 400 when title is empty string
 *   4.  GET /api/v1/orchestrator/conversations  — returns empty list initially
 *   5.  GET /api/v1/orchestrator/conversations  — lists created conversations
 *   6.  GET /api/v1/orchestrator/conversations/:id — returns single conversation
 *   7.  GET /api/v1/orchestrator/conversations/:id — 404 for unknown id
 *   8.  DELETE /api/v1/orchestrator/conversations/:id — deletes conversation
 *   9.  DELETE /api/v1/orchestrator/conversations/:id — 404 for unknown id
 *   10. Conversation object has all expected fields (id, title, createdAt, updatedAt)
 *
 *  Model Config:
 *   11. GET /api/v1/orchestrator/model-config — returns sensible defaults
 *   12. PUT /api/v1/orchestrator/model-config — updates model name
 *   13. PUT /api/v1/orchestrator/model-config — updates temperature
 *   14. PUT /api/v1/orchestrator/model-config — partial update preserves unchanged fields
 *   15. PUT /api/v1/orchestrator/model-config — 400 for invalid provider
 *   16. PUT /api/v1/orchestrator/model-config — 400 for temperature out of range
 *   17. PUT /api/v1/orchestrator/model-config — 400 for invalid endpoint URL
 *   18. PUT /api/v1/orchestrator/model-config — 400 for non-integer maxTokens
 *
 *  Chat (JSON endpoint):
 *   19. POST /api/v1/orchestrator/chat — valid request returns 201 with JSON Message object
 *   20. POST /api/v1/orchestrator/chat — 400 when conversationId missing
 *   21. POST /api/v1/orchestrator/chat — 400 when message missing
 *   22. POST /api/v1/orchestrator/chat — 400 when message is empty string
 *   23. POST /api/v1/orchestrator/chat — 404 when conversationId not in store
 *
 *  Chat (SSE streaming endpoint):
 *   19b. POST /api/v1/orchestrator/chat/stream — valid request returns 200 with text/event-stream
 *   19c. POST /api/v1/orchestrator/chat/stream — SSE stream contains text events and done event
 *
 *  Test Generation:
 *   24. POST /api/v1/orchestrator/test-gen — mode 'requirement' returns testCode
 *   25. POST /api/v1/orchestrator/test-gen — mode 'diff' returns testCode
 *   26. POST /api/v1/orchestrator/test-gen — 400 when source missing
 *   27. POST /api/v1/orchestrator/test-gen — 400 when mode is invalid
 *   28. POST /api/v1/orchestrator/test-gen — 400 when mode missing
 *   29. Response includes mode and warnings fields
 *
 *  Messages:
 *   30. GET /api/v1/orchestrator/conversations/:id/messages — 200 empty array before any messages
 *   31. GET /api/v1/orchestrator/conversations/:id/messages — 404 when conversation unknown
 *   32. After chat POST, GET messages returns user + assistant messages in order
 *   33. Messages from conversation A do not appear in conversation B list
 *   34. Restart-survival simulation — InMemoryMessageStore contract via direct API
 *   35. Message objects have all expected fields (id, conversationId, role, content, createdAt)
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  createOrchestratorConversationRoutes,
  InMemoryConversationStore,
} from './conversations.js';
import {
  createOrchestratorModelConfigRoutes,
  InMemoryModelConfigStore,
  validateModelConfigUpdate,
} from './model-config.js';
import { createOrchestratorChatRoutes } from './chat.js';
import { createOrchestratorTestGenRoutes } from './test-gen.js';
import {
  createOrchestratorMessageRoutes,
  InMemoryMessageStore,
} from './messages.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function buildOrchestratorApp(): {
  app: Hono;
  convStore: InMemoryConversationStore;
  configStore: InMemoryModelConfigStore;
  msgStore: InMemoryMessageStore;
} {
  const app = new Hono();
  const convStore = new InMemoryConversationStore();
  const configStore = new InMemoryModelConfigStore();
  const msgStore = new InMemoryMessageStore();

  app.route('/', createOrchestratorConversationRoutes({ store: convStore }));
  app.route('/', createOrchestratorModelConfigRoutes({ store: configStore }));
  app.route('/', createOrchestratorChatRoutes({ conversationStore: convStore, messageStore: msgStore }));
  app.route('/', createOrchestratorTestGenRoutes());
  app.route('/', createOrchestratorMessageRoutes({ conversationStore: convStore, messageStore: msgStore }));

  return { app, convStore, configStore, msgStore };
}

async function post(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function put(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function del(app: Hono, path: string): Promise<Response> {
  return app.request(path, { method: 'DELETE' });
}

async function jsonBody(res: Response): Promise<unknown> {
  return res.json();
}

/** Helper: create a conversation and return its id */
async function createConversation(app: Hono, title: string): Promise<string> {
  const res = await post(app, '/api/v1/orchestrator/conversations', { title });
  const body = (await jsonBody(res)) as { id: string };
  return body.id;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

describe('POST /api/v1/orchestrator/conversations', () => {
  it('creates conversation and returns 201 with all fields', async () => {
    const { app } = buildOrchestratorApp();

    const res = await post(app, '/api/v1/orchestrator/conversations', {
      title: 'Test run analysis',
    });
    expect(res.status).toBe(201);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['id']).toBe('string');
    expect(body['title']).toBe('Test run analysis');
    expect(typeof body['createdAt']).toBe('string');
    expect(typeof body['updatedAt']).toBe('string');
  });

  it('returns 400 when title is missing', async () => {
    const { app } = buildOrchestratorApp();

    const res = await post(app, '/api/v1/orchestrator/conversations', {});
    expect(res.status).toBe(400);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });

  it('returns 400 when title is an empty string', async () => {
    const { app } = buildOrchestratorApp();

    const res = await post(app, '/api/v1/orchestrator/conversations', {
      title: '   ',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when title is not a string', async () => {
    const { app } = buildOrchestratorApp();

    const res = await post(app, '/api/v1/orchestrator/conversations', {
      title: 42,
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/orchestrator/conversations', () => {
  it('returns empty array when no conversations exist', async () => {
    const { app } = buildOrchestratorApp();

    const res = await app.request('/api/v1/orchestrator/conversations');
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as unknown[];
    expect(body).toEqual([]);
  });

  it('lists all created conversations', async () => {
    const { app } = buildOrchestratorApp();

    await post(app, '/api/v1/orchestrator/conversations', { title: 'Conversation A' });
    await post(app, '/api/v1/orchestrator/conversations', { title: 'Conversation B' });

    const res = await app.request('/api/v1/orchestrator/conversations');
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    const titles = body.map((c) => c['title']);
    expect(titles).toContain('Conversation A');
    expect(titles).toContain('Conversation B');
  });
});

describe('GET /api/v1/orchestrator/conversations/:id', () => {
  it('returns single conversation by id', async () => {
    const { app } = buildOrchestratorApp();

    const createRes = await post(app, '/api/v1/orchestrator/conversations', {
      title: 'Specific conversation',
    });
    const { id } = (await jsonBody(createRes)) as { id: string };

    const res = await app.request(`/api/v1/orchestrator/conversations/${id}`);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['id']).toBe(id);
    expect(body['title']).toBe('Specific conversation');
  });

  it('returns 404 for unknown id', async () => {
    const { app } = buildOrchestratorApp();

    const res = await app.request('/api/v1/orchestrator/conversations/does-not-exist');
    expect(res.status).toBe(404);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });
});

describe('DELETE /api/v1/orchestrator/conversations/:id', () => {
  it('deletes conversation and confirms with deleted: true', async () => {
    const { app } = buildOrchestratorApp();

    const createRes = await post(app, '/api/v1/orchestrator/conversations', {
      title: 'To be deleted',
    });
    const { id } = (await jsonBody(createRes)) as { id: string };

    const delRes = await del(app, `/api/v1/orchestrator/conversations/${id}`);
    expect(delRes.status).toBe(200);

    const delBody = (await jsonBody(delRes)) as Record<string, unknown>;
    expect(delBody['deleted']).toBe(true);

    // Verify it is gone
    const getRes = await app.request(`/api/v1/orchestrator/conversations/${id}`);
    expect(getRes.status).toBe(404);
  });

  it('returns 404 when conversation does not exist', async () => {
    const { app } = buildOrchestratorApp();

    const res = await del(app, '/api/v1/orchestrator/conversations/ghost-id');
    expect(res.status).toBe(404);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });

  it('removed conversation no longer appears in list', async () => {
    const { app } = buildOrchestratorApp();

    const r1 = await post(app, '/api/v1/orchestrator/conversations', { title: 'Keep' });
    const r2 = await post(app, '/api/v1/orchestrator/conversations', { title: 'Delete me' });
    const { id: deleteId } = (await jsonBody(r2)) as { id: string };

    await del(app, `/api/v1/orchestrator/conversations/${deleteId}`);

    const listRes = await app.request('/api/v1/orchestrator/conversations');
    const list = (await jsonBody(listRes)) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0]?.['title']).toBe('Keep');

    // Suppress unused variable warning for r1
    void r1;
  });
});

// ---------------------------------------------------------------------------
// Model Config
// ---------------------------------------------------------------------------

describe('GET /api/v1/orchestrator/model-config', () => {
  it('returns sensible default config', async () => {
    const { app } = buildOrchestratorApp();

    const res = await app.request('/api/v1/orchestrator/model-config');
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['model']).toBe('string');
    expect(typeof body['provider']).toBe('string');
    expect(typeof body['endpoint']).toBe('string');
    expect(typeof body['temperature']).toBe('number');
    expect(typeof body['maxTokens']).toBe('number');
  });

  it('defaults include ollama provider and llama3.1 model', async () => {
    const { app } = buildOrchestratorApp();

    const res = await app.request('/api/v1/orchestrator/model-config');
    const body = (await jsonBody(res)) as Record<string, unknown>;

    expect(body['provider']).toBe('ollama');
    expect(body['model']).toBe('llama3.1');
    expect(body['temperature']).toBe(0.7);
    expect(body['maxTokens']).toBe(4096);
  });
});

describe('PUT /api/v1/orchestrator/model-config', () => {
  it('updates model name and returns updated config', async () => {
    const { app } = buildOrchestratorApp();

    const res = await put(app, '/api/v1/orchestrator/model-config', {
      model: 'llama3.2',
    });
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['model']).toBe('llama3.2');
  });

  it('updates temperature', async () => {
    const { app } = buildOrchestratorApp();

    const res = await put(app, '/api/v1/orchestrator/model-config', {
      temperature: 1.5,
    });
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['temperature']).toBe(1.5);
  });

  it('partial update preserves unchanged fields', async () => {
    const { app } = buildOrchestratorApp();

    // First update model only
    await put(app, '/api/v1/orchestrator/model-config', { model: 'gemma2' });

    // Then update temperature only
    const res = await put(app, '/api/v1/orchestrator/model-config', { temperature: 0.2 });
    const body = (await jsonBody(res)) as Record<string, unknown>;

    // Both should be present
    expect(body['model']).toBe('gemma2');
    expect(body['temperature']).toBe(0.2);
    // Original defaults still there
    expect(body['provider']).toBe('ollama');
  });

  it('accepts valid provider', async () => {
    const { app } = buildOrchestratorApp();

    const res = await put(app, '/api/v1/orchestrator/model-config', {
      provider: 'openai',
    });
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['provider']).toBe('openai');
  });

  it('returns 400 for invalid provider', async () => {
    const { app } = buildOrchestratorApp();

    const res = await put(app, '/api/v1/orchestrator/model-config', {
      provider: 'unknown-ai-company',
    });
    expect(res.status).toBe(400);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });

  it('returns 400 when temperature is above 2', async () => {
    const { app } = buildOrchestratorApp();

    const res = await put(app, '/api/v1/orchestrator/model-config', {
      temperature: 2.1,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when temperature is below 0', async () => {
    const { app } = buildOrchestratorApp();

    const res = await put(app, '/api/v1/orchestrator/model-config', {
      temperature: -0.1,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid endpoint URL', async () => {
    const { app } = buildOrchestratorApp();

    const res = await put(app, '/api/v1/orchestrator/model-config', {
      endpoint: 'not-a-url',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-positive maxTokens', async () => {
    const { app } = buildOrchestratorApp();

    const res = await put(app, '/api/v1/orchestrator/model-config', {
      maxTokens: 0,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for null temperature', async () => {
    const { app } = buildOrchestratorApp();

    const res = await put(app, '/api/v1/orchestrator/model-config', {
      temperature: null,
    });
    expect(res.status).toBe(400);
  });

  it('rejects non-finite temperature values in the validator', () => {
    expect(validateModelConfigUpdate({ temperature: Number.NaN })).toBe('temperature must be a finite number');
    expect(validateModelConfigUpdate({ temperature: Number.POSITIVE_INFINITY })).toBe('temperature must be a finite number');
    expect(validateModelConfigUpdate({ temperature: Number.NEGATIVE_INFINITY })).toBe('temperature must be a finite number');
  });

  it('rejects non-finite maxTokens values in the validator', () => {
    expect(validateModelConfigUpdate({ maxTokens: Number.NaN })).toBe('maxTokens must be a finite integer');
    expect(validateModelConfigUpdate({ maxTokens: Number.POSITIVE_INFINITY })).toBe('maxTokens must be a finite integer');
    expect(validateModelConfigUpdate({ maxTokens: Number.NEGATIVE_INFINITY })).toBe('maxTokens must be a finite integer');
  });

  it('accepts boundary temperature values 0 and 2', async () => {
    const { app } = buildOrchestratorApp();

    const res0 = await put(app, '/api/v1/orchestrator/model-config', { temperature: 0 });
    expect(res0.status).toBe(200);

    const res2 = await put(app, '/api/v1/orchestrator/model-config', { temperature: 2 });
    expect(res2.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Chat — JSON endpoint
// ---------------------------------------------------------------------------

describe('POST /api/v1/orchestrator/chat', () => {
  it('returns 201 with JSON Message object for a valid request', async () => {
    const { app } = buildOrchestratorApp();
    const convId = await createConversation(app, 'JSON chat test');

    const res = await post(app, '/api/v1/orchestrator/chat', {
      conversationId: convId,
      message: 'What tests should I write?',
    });
    expect(res.status).toBe(201);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['id']).toBe('string');
    expect(body['conversationId']).toBe(convId);
    expect(body['role']).toBe('assistant');
    expect(typeof body['content']).toBe('string');
    expect((body['content'] as string).length).toBeGreaterThan(0);
    expect(typeof body['createdAt']).toBe('string');
  });

  it('returns 400 when conversationId is missing', async () => {
    const { app } = buildOrchestratorApp();

    const res = await post(app, '/api/v1/orchestrator/chat', {
      message: 'Hello',
    });
    expect(res.status).toBe(400);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });

  it('returns 400 when message is missing', async () => {
    const { app } = buildOrchestratorApp();
    const convId = await createConversation(app, 'Missing message test');

    const res = await post(app, '/api/v1/orchestrator/chat', {
      conversationId: convId,
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when message is an empty string', async () => {
    const { app } = buildOrchestratorApp();
    const convId = await createConversation(app, 'Empty message test');

    const res = await post(app, '/api/v1/orchestrator/chat', {
      conversationId: convId,
      message: '   ',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when conversationId is empty string', async () => {
    const { app } = buildOrchestratorApp();

    const res = await post(app, '/api/v1/orchestrator/chat', {
      conversationId: '',
      message: 'Hello',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when conversationId is not found in the conversation store', async () => {
    const { app } = buildOrchestratorApp();

    const res = await post(app, '/api/v1/orchestrator/chat', {
      conversationId: 'non-existent-id',
      message: 'Hello',
    });
    expect(res.status).toBe(404);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Chat — SSE streaming endpoint
// ---------------------------------------------------------------------------

describe('POST /api/v1/orchestrator/chat/stream', () => {
  it('returns 200 with text/event-stream content-type', async () => {
    const { app } = buildOrchestratorApp();
    const convId = await createConversation(app, 'SSE test conversation');

    const res = await post(app, '/api/v1/orchestrator/chat/stream', {
      conversationId: convId,
      message: 'What tests should I write?',
    });
    expect(res.status).toBe(200);

    const contentType = res.headers.get('content-type') ?? '';
    expect(contentType).toContain('text/event-stream');
  });

  it('SSE stream contains text events and done event', async () => {
    const { app } = buildOrchestratorApp();
    const convId = await createConversation(app, 'SSE stream test');

    const res = await post(app, '/api/v1/orchestrator/chat/stream', {
      conversationId: convId,
      message: 'Hello',
    });
    expect(res.status).toBe(200);

    const text = await res.text();
    expect(text).toContain('event: text');
    expect(text).toContain('event: done');
    expect(text).toContain(convId);
  });
});

// ---------------------------------------------------------------------------
// Test Generation
// ---------------------------------------------------------------------------

describe('POST /api/v1/orchestrator/test-gen', () => {
  it('mode requirement returns testCode and metadata', async () => {
    const { app } = buildOrchestratorApp();

    const res = await post(app, '/api/v1/orchestrator/test-gen', {
      source: 'Users should be able to log in with email and password',
      mode: 'requirement',
    });
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['testCode']).toBe('string');
    expect((body['testCode'] as string).length).toBeGreaterThan(0);
    expect(body['mode']).toBe('requirement');
    expect(Array.isArray(body['warnings'])).toBe(true);
  });

  it('mode diff returns testCode', async () => {
    const { app } = buildOrchestratorApp();

    const res = await post(app, '/api/v1/orchestrator/test-gen', {
      source: '+ const isValid = input.length > 0;',
      mode: 'diff',
    });
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['testCode']).toBe('string');
    expect(body['mode']).toBe('diff');
  });

  it('returns 400 when source is missing', async () => {
    const { app } = buildOrchestratorApp();

    const res = await post(app, '/api/v1/orchestrator/test-gen', {
      mode: 'requirement',
    });
    expect(res.status).toBe(400);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });

  it('returns 400 when source is empty string', async () => {
    const { app } = buildOrchestratorApp();

    const res = await post(app, '/api/v1/orchestrator/test-gen', {
      source: '   ',
      mode: 'requirement',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when mode is invalid', async () => {
    const { app } = buildOrchestratorApp();

    const res = await post(app, '/api/v1/orchestrator/test-gen', {
      source: 'some source code',
      mode: 'openapi',
    });
    expect(res.status).toBe(400);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
    expect(body['error'] as string).toContain('mode');
  });

  it('returns 400 when mode is missing', async () => {
    const { app } = buildOrchestratorApp();

    const res = await post(app, '/api/v1/orchestrator/test-gen', {
      source: 'some source code',
    });
    expect(res.status).toBe(400);
  });

  it('requirement mode testCode includes describe/it pattern', async () => {
    const { app } = buildOrchestratorApp();

    const res = await post(app, '/api/v1/orchestrator/test-gen', {
      source: 'User authentication requirement',
      mode: 'requirement',
    });
    const body = (await jsonBody(res)) as Record<string, unknown>;
    const code = body['testCode'] as string;

    expect(code).toContain('describe(');
    expect(code).toContain('it(');
  });

  it('diff mode testCode includes describe/it pattern', async () => {
    const { app } = buildOrchestratorApp();

    const res = await post(app, '/api/v1/orchestrator/test-gen', {
      source: '+ function newFeature() {}',
      mode: 'diff',
    });
    const body = (await jsonBody(res)) as Record<string, unknown>;
    const code = body['testCode'] as string;

    expect(code).toContain('describe(');
    expect(code).toContain('it(');
  });
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

describe('GET /api/v1/orchestrator/conversations/:id/messages', () => {
  it('returns empty array before any messages are sent', async () => {
    const { app } = buildOrchestratorApp();
    const convId = await createConversation(app, 'Empty messages test');

    const res = await app.request(`/api/v1/orchestrator/conversations/${convId}/messages`);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as unknown[];
    expect(body).toEqual([]);
  });

  it('returns 404 when conversation is unknown', async () => {
    const { app } = buildOrchestratorApp();

    const res = await app.request('/api/v1/orchestrator/conversations/unknown-conv-id/messages');
    expect(res.status).toBe(404);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });

  it('returns user and assistant messages after chat POST, ordered by createdAt', async () => {
    const { app } = buildOrchestratorApp();
    const convId = await createConversation(app, 'Persistence test');

    // Send a chat message — JSON endpoint returns 201 and the assistant message directly
    const chatRes = await post(app, '/api/v1/orchestrator/chat', {
      conversationId: convId,
      message: 'What is the test coverage?',
    });
    expect(chatRes.status).toBe(201);
    await chatRes.text(); // consume body

    // Fetch messages
    const msgRes = await app.request(`/api/v1/orchestrator/conversations/${convId}/messages`);
    expect(msgRes.status).toBe(200);

    const messages = (await jsonBody(msgRes)) as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(2);
    expect(messages[0]?.['role']).toBe('user');
    expect(messages[0]?.['content']).toBe('What is the test coverage?');
    expect(messages[1]?.['role']).toBe('assistant');
    expect(typeof messages[1]?.['content']).toBe('string');
    expect((messages[1]?.['content'] as string).length).toBeGreaterThan(0);
  });

  it('message objects have all expected fields', async () => {
    const { app } = buildOrchestratorApp();
    const convId = await createConversation(app, 'Field check test');

    const chatRes = await post(app, '/api/v1/orchestrator/chat', {
      conversationId: convId,
      message: 'Check fields',
    });
    await chatRes.text();

    const msgRes = await app.request(`/api/v1/orchestrator/conversations/${convId}/messages`);
    const messages = (await jsonBody(msgRes)) as Array<Record<string, unknown>>;

    expect(messages.length).toBeGreaterThan(0);
    const msg = messages[0]!;
    expect(typeof msg['id']).toBe('string');
    expect(msg['conversationId']).toBe(convId);
    expect(typeof msg['role']).toBe('string');
    expect(typeof msg['content']).toBe('string');
    expect(typeof msg['createdAt']).toBe('string');
  });

  it('messages from conversation A do not appear in conversation B list', async () => {
    const { app } = buildOrchestratorApp();
    const convIdA = await createConversation(app, 'Conversation A');
    const convIdB = await createConversation(app, 'Conversation B');

    // Send message to conversation A only
    const chatRes = await post(app, '/api/v1/orchestrator/chat', {
      conversationId: convIdA,
      message: 'Message for A only',
    });
    await chatRes.text();

    // Conversation B should have no messages
    const msgResB = await app.request(`/api/v1/orchestrator/conversations/${convIdB}/messages`);
    expect(msgResB.status).toBe(200);
    const msgsB = (await jsonBody(msgResB)) as unknown[];
    expect(msgsB).toHaveLength(0);

    // Conversation A should have messages
    const msgResA = await app.request(`/api/v1/orchestrator/conversations/${convIdA}/messages`);
    const msgsA = (await jsonBody(msgResA)) as unknown[];
    expect(msgsA.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// InMemoryMessageStore — restart-survival simulation (interface contract)
// ---------------------------------------------------------------------------

describe('InMemoryMessageStore — interface contract', () => {
  it('addMessage and listMessages work on same store instance (restart-survival simulation)', () => {
    // Simulate creating a fresh store (as would happen after a restart with DB-backed impl)
    const store = new InMemoryMessageStore();

    const msg1 = store.addMessage({
      conversationId: 'conv-restart-test',
      role: 'user',
      content: 'First message',
    });
    const msg2 = store.addMessage({
      conversationId: 'conv-restart-test',
      role: 'assistant',
      content: 'First response',
    });

    const messages = store.listMessages('conv-restart-test');
    expect(messages).toHaveLength(2);
    expect(messages[0]?.['id']).toBe(msg1.id);
    expect(messages[1]?.['id']).toBe(msg2.id);
  });

  it('addMessage assigns unique ids and ISO-8601 createdAt', () => {
    const store = new InMemoryMessageStore();

    const msg = store.addMessage({
      conversationId: 'conv-abc',
      role: 'user',
      content: 'Hello',
    });

    expect(typeof msg.id).toBe('string');
    expect(msg.id.length).toBeGreaterThan(0);
    expect(msg.conversationId).toBe('conv-abc');
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello');
    // ISO-8601 format check
    expect(() => new Date(msg.createdAt)).not.toThrow();
    expect(new Date(msg.createdAt).toISOString()).toBe(msg.createdAt);
  });

  it('listMessages returns empty array for unknown conversationId', () => {
    const store = new InMemoryMessageStore();
    store.addMessage({ conversationId: 'conv-1', role: 'user', content: 'hi' });

    const result = store.listMessages('conv-does-not-exist');
    expect(result).toEqual([]);
  });

  it('listMessages isolates messages by conversationId', () => {
    const store = new InMemoryMessageStore();

    store.addMessage({ conversationId: 'conv-A', role: 'user', content: 'For A' });
    store.addMessage({ conversationId: 'conv-B', role: 'user', content: 'For B' });
    store.addMessage({ conversationId: 'conv-A', role: 'assistant', content: 'Reply for A' });

    const msgsA = store.listMessages('conv-A');
    const msgsB = store.listMessages('conv-B');

    expect(msgsA).toHaveLength(2);
    expect(msgsB).toHaveLength(1);
    expect(msgsB[0]?.content).toBe('For B');
  });

  it('listMessages returns messages sorted by createdAt ascending', () => {
    const store = new InMemoryMessageStore();

    // Add in sequence — createdAt will naturally be ascending
    store.addMessage({ conversationId: 'conv-sort', role: 'user', content: 'First' });
    store.addMessage({ conversationId: 'conv-sort', role: 'assistant', content: 'Second' });
    store.addMessage({ conversationId: 'conv-sort', role: 'user', content: 'Third' });

    const messages = store.listMessages('conv-sort');
    expect(messages).toHaveLength(3);
    expect(messages[0]?.content).toBe('First');
    expect(messages[2]?.content).toBe('Third');
  });
});

// ---------------------------------------------------------------------------
// ModelConfigStore restart-survival contract
// ---------------------------------------------------------------------------

describe('ModelConfigStore restart-survival contract', () => {
  it('updated config is readable from same store instance (in-memory contract)', () => {
    const store = new InMemoryModelConfigStore();
    store.update({ model: 'llama3.2', temperature: 0.4 });
    // Simulate "restart" by just re-reading from the same store
    // In-memory contract: data survives within the process lifetime
    const config = store.get();
    expect(config.model).toBe('llama3.2');
    expect(config.temperature).toBe(0.4);
  });

  it('default config is returned for a freshly constructed store', () => {
    const store = new InMemoryModelConfigStore();
    const config = store.get();
    expect(config.model).toBe('llama3.1');
    expect(config.provider).toBe('ollama');
  });
});
