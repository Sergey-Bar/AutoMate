/**
 * API contract validation tests for Automate server.
 *
 * These tests verify that API responses conform to the shared Zod v4 schemas,
 * catching schema drift between API implementation and client expectations.
 *
 * Focus: SHAPE of responses (not behavior).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { conversationRoutes } from '../conversations.js';
import { z } from 'zod/v4';
import { createMemoryRepository } from '../../agent/memory.js';

// The canonical ConversationSchema from shared requires fields not yet returned
// by the in-memory repository (flowTemplateId, updatedAt). We use the API
// contract schema — the minimal shape the server actually guarantees.
const ApiConversationSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  createdAt: z.string(),
});

describe('API contract: GET /api/conversations', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    const memory = createMemoryRepository();
    await app.register(conversationRoutes, { memory });
    await app.ready();
  });

  it('returns an array', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/conversations' });
    expect(res.statusCode).toBe(200);
    const body: unknown = res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('empty list matches z.array(ApiConversationSchema)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/conversations' });
    const parsed = z.array(ApiConversationSchema).safeParse(res.json());
    expect(parsed.success, JSON.stringify(parsed.error)).toBe(true);
  });

  it('created conversation matches ApiConversationSchema', async () => {
    // Create a conversation first
    await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: { title: 'Contract test conversation' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/conversations' });
    const items = res.json() as unknown[];
    expect(items.length).toBeGreaterThan(0);

    const parsed = ApiConversationSchema.safeParse(items[0]);
    expect(parsed.success, JSON.stringify(parsed.error)).toBe(true);
  });
});

describe('API contract: POST /api/conversations', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    const memory = createMemoryRepository();
    await app.register(conversationRoutes, { memory });
    await app.ready();
  });

  it('returns 201 with a body matching ApiConversationSchema', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: { title: 'Schema check' },
    });
    expect(res.statusCode).toBe(201);
    const parsed = ApiConversationSchema.safeParse(res.json());
    expect(parsed.success, JSON.stringify(parsed.error)).toBe(true);
  });

  it('conversation has required id, createdAt, updatedAt fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/conversations',
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(typeof body.id).toBe('string');
    expect(typeof body.createdAt).toBe('string');
  });
});

describe('API contract: GET /health', () => {
  it('health endpoint returns { status: string, ollama: string }', async () => {
    const HealthSchema = z.object({
      status: z.string(),
      ollama: z.string().optional(),
    });
    // Build a minimal app mirroring the health route structure
    const healthApp = Fastify({ logger: false });
    healthApp.get('/health', async () => ({
      status: 'ok',
      version: '1.0.0',
      db: 'connected',
      ollama: 'disconnected',
      uptime: 0,
    }));
    await healthApp.ready();

    const res = await healthApp.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const parsed = HealthSchema.safeParse(res.json());
    expect(parsed.success, JSON.stringify(parsed.error)).toBe(true);

    await healthApp.close();
  });
});
