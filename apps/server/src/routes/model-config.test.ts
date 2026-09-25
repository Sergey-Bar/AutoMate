import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockWhere,
  mockSet,
  mockFrom,
  mockSelect,
  mockUpdate,
  mockModelConfig,
  mockEq,
} = vi.hoisted(() => {
  const where = vi.fn().mockResolvedValue([]);
  const set = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const update = vi.fn(() => ({ set }));
  const schemaModelConfig = { id: 'id-column' };
  const eq = vi.fn(() => 'eq-clause');

  return {
    mockWhere: where,
    mockSet: set,
    mockFrom: from,
    mockSelect: select,
    mockUpdate: update,
    mockModelConfig: schemaModelConfig,
    mockEq: eq,
  };
});

vi.mock('drizzle-orm', () => ({
  eq: mockEq,
}));

vi.mock('../db/schema.js', () => ({
  modelConfig: mockModelConfig,
}));

vi.mock('../db/client.js', () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
  },
  sqlite: { prepare: vi.fn() },
  poolConnection: { query: vi.fn() },
  isPostgres: false,
}));

import { modelConfigRoutes, maskApiKey } from './model-config.js';

describe('maskApiKey', () => {
  it('masks middle of key, showing first 4 and last 4 chars', () => {
    expect(maskApiKey('sk-1234567890abcdef')).toBe('sk-1***********cdef');
  });

  it('returns "****" for short keys (< 8 chars)', () => {
    expect(maskApiKey('short')).toBe('****');
  });

  it('returns "****" for empty string', () => {
    expect(maskApiKey('')).toBe('****');
  });

  it('handles exactly 8-char key', () => {
    expect(maskApiKey('12345678')).toBe('12345678');
  });

  it('returns "****" for undefined/null coerced to empty', () => {
    expect(maskApiKey('')).toBe('****');
  });
});

describe('modelConfigRoutes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    mockWhere.mockReset();
    mockWhere.mockResolvedValue([]);
    mockSet.mockClear();
    mockFrom.mockClear();
    mockSelect.mockClear();
    mockUpdate.mockClear();
    mockEq.mockClear();

    app = Fastify();
    await app.register((instance, _opts, done) => {
      modelConfigRoutes(instance).then(() => done()).catch(done);
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/model-config returns defaults when no DB row exists', async () => {
    mockWhere.mockResolvedValueOnce([]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/model-config',
    });

    expect(response.statusCode).toBe(200);
    expect(mockEq).toHaveBeenCalledWith(mockModelConfig.id, 'default');
    expect(response.json()).toEqual({
      provider: 'ollama',
      model: 'llama3.1',
      endpoint: 'http://localhost:11434',
      temperature: 0.7,
      maxTokens: 4096,
    });
  });

  it('GET /api/model-config returns DB values when row exists', async () => {
    mockWhere.mockResolvedValueOnce([{
      provider: 'openai',
      model: 'gpt-4o-mini',
      endpoint: 'https://api.openai.com/v1',
      temperature: 0.2,
      maxTokens: 1024,
      apiKey: 'should-not-be-returned',
    }]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/model-config',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      endpoint: 'https://api.openai.com/v1',
      temperature: 0.2,
      maxTokens: 1024,
    });
  });

  it('PUT /api/model-config with full body updates all provided fields', async () => {
    const payload = {
      provider: 'ollama',
      model: 'llama3.1',
      endpoint: 'http://localhost:11434',
      temperature: 0.35,
      maxTokens: 2048,
    };

    const response = await app.inject({
      method: 'PUT',
      url: '/api/model-config',
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(mockModelConfig);
    expect(mockEq).toHaveBeenCalledWith(mockModelConfig.id, 'default');
    expect(mockSet).toHaveBeenCalledTimes(1);

    const setCalls = (mockSet as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(setCalls.length).toBeGreaterThan(0);
    const updates = setCalls[0][0] as Record<string, unknown>;
    expect(updates).toMatchObject(payload);
    expect(updates).toHaveProperty('updatedAt');
    expect(typeof updates.updatedAt).toBe('string');
    expect(Object.keys(updates).sort()).toEqual([
      'endpoint',
      'maxTokens',
      'model',
      'provider',
      'temperature',
      'updatedAt',
    ]);
  });

  it('PUT /api/model-config with partial body updates only that field and updatedAt', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/model-config',
      payload: { temperature: 0.9 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(mockModelConfig);
    expect(mockSet).toHaveBeenCalledTimes(1);

    const setCalls = (mockSet as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(setCalls.length).toBeGreaterThan(0);
    const updates = setCalls[0][0] as Record<string, unknown>;
    expect(updates).toEqual({
      updatedAt: expect.any(String),
      temperature: 0.9,
    });
    expect(updates).not.toHaveProperty('provider');
    expect(updates).not.toHaveProperty('model');
    expect(updates).not.toHaveProperty('endpoint');
    expect(updates).not.toHaveProperty('maxTokens');
    expect(Object.keys(updates).sort()).toEqual(['temperature', 'updatedAt']);
  });

  it('PUT /api/model-config with empty body updates only updatedAt', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/model-config',
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(mockModelConfig);
    expect(mockSet).toHaveBeenCalledTimes(1);

    const setCalls = (mockSet as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(setCalls.length).toBeGreaterThan(0);
    const updates = setCalls[0][0] as Record<string, unknown>;
    expect(updates).toEqual({
      updatedAt: expect.any(String),
    });
  });

  it('PUT /api/model-config rejects invalid temperature (string)', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/model-config',
      payload: { temperature: '0.7' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: expect.any(String),
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('PUT /api/model-config rejects temperature out of range', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/model-config',
      payload: { temperature: 2.5 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: expect.any(String),
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('PUT /api/model-config rejects invalid endpoint URL', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/model-config',
      payload: { endpoint: 'not-a-url' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: expect.any(String),
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('PUT /api/model-config rejects unsupported provider with helpful message', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/model-config',
      payload: { provider: 'unknown-llm' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: expect.stringContaining('Unsupported provider'),
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('PUT /api/model-config rejects negative maxTokens', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/model-config',
      payload: { maxTokens: -1 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: expect.any(String),
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
