import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { validateOrReply } from './validate-or-reply.js';

describe('validateOrReply', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
  });

  it('returns parsed data when validation succeeds', async () => {
    const schema = z.object({ name: z.string() });
    
    app.post('/test', async (req, reply) => {
      const body = await validateOrReply(schema, req, reply);
      if (!body) return;
      return { received: body.name };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/test',
      payload: { name: 'test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: 'test' });
  });

  it('returns null and sends 400 when validation fails', async () => {
    const schema = z.object({ name: z.string() });
    
    app.post('/test', async (req, reply) => {
      const body = await validateOrReply(schema, req, reply);
      if (!body) return;
      return { received: body.name };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/test',
      payload: { name: 123 }, // Invalid type
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty('error');
    expect(response.json().error).toContain('name');
  });

  it('sends formatted validation error message', async () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    
    app.post('/test', async (req, reply) => {
      const body = await validateOrReply(schema, req, reply);
      if (!body) return;
      return body;
    });

    const response = await app.inject({
      method: 'POST',
      url: '/test',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const json = response.json();
    expect(json.error).toBeDefined();
    expect(typeof json.error).toBe('string');
  });

  it('handles deeply nested schema validation', async () => {
    const schema = z.object({
      user: z.object({
        profile: z.object({
          email: z.string().email(),
        }),
      }),
    });
    
    app.post('/test', async (req, reply) => {
      const body = await validateOrReply(schema, req, reply);
      if (!body) return;
      return { email: body.user.profile.email };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/test',
      payload: { user: { profile: { email: 'test@example.com' } } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ email: 'test@example.com' });
  });

  it('preserves type safety in parsed data', async () => {
    const schema = z.object({ count: z.number(), enabled: z.boolean() });
    
    app.post('/test', async (req, reply) => {
      const body = await validateOrReply(schema, req, reply);
      if (!body) return;
      
      // TypeScript should infer correct types
      const doubled: number = body.count * 2;
      const status: boolean = body.enabled;
      
      return { doubled, status };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/test',
      payload: { count: 5, enabled: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ doubled: 10, status: true });
  });
});
