import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { validateOrReply } from './validate-or-reply.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

describe('validateOrReply', () => {
  it('returns parsed data when validation succeeds', async () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const mockReq = { body: { name: 'Alice', age: 30 } } as FastifyRequest;
    const mockReply = {} as FastifyReply;

    const result = await validateOrReply(schema, mockReq, mockReply);

    expect(result).toEqual({ name: 'Alice', age: 30 });
  });

  it('sends 400 with flattened error when validation fails', async () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const mockReq = { body: { name: 'Bob', age: 'not-a-number' } } as FastifyRequest;
    
    const sendSpy = vi.fn().mockReturnThis();
    const codeSpy = vi.fn().mockReturnValue({ send: sendSpy });
    const mockReply = { code: codeSpy } as unknown as FastifyReply;

    const result = await validateOrReply(schema, mockReq, mockReply);

    expect(result).toBeNull();
    expect(codeSpy).toHaveBeenCalledWith(400);
    expect(sendSpy).toHaveBeenCalledWith({
      error: expect.objectContaining({
        formErrors: expect.any(Array),
        fieldErrors: expect.any(Object),
      }),
    });
  });

  it('includes field-specific errors in flattened format', async () => {
    const schema = z.object({ email: z.string().email(), count: z.number().min(1) });
    const mockReq = { body: { email: 'invalid', count: 0 } } as FastifyRequest;
    
    const sendSpy = vi.fn().mockReturnThis();
    const codeSpy = vi.fn().mockReturnValue({ send: sendSpy });
    const mockReply = { code: codeSpy } as unknown as FastifyReply;

    await validateOrReply(schema, mockReq, mockReply);

    const sentError = sendSpy.mock.calls[0][0].error;
    expect(sentError.fieldErrors).toHaveProperty('email');
    expect(sentError.fieldErrors).toHaveProperty('count');
  });

  it('returns null after sending error response', async () => {
    const schema = z.object({ required: z.string() });
    const mockReq = { body: {} } as FastifyRequest;
    
    const sendSpy = vi.fn().mockReturnThis();
    const codeSpy = vi.fn().mockReturnValue({ send: sendSpy });
    const mockReply = { code: codeSpy } as unknown as FastifyReply;

    const result = await validateOrReply(schema, mockReq, mockReply);

    expect(result).toBeNull();
    expect(sendSpy).toHaveBeenCalled();
  });

  it('handles complex nested schema validation', async () => {
    const schema = z.object({
      user: z.object({
        name: z.string().min(2),
        address: z.object({
          street: z.string(),
          zip: z.string().length(5),
        }),
      }),
    });
    
    const mockReq = {
      body: {
        user: {
          name: 'A',
          address: { street: '123 Main', zip: '123' },
        },
      },
    } as FastifyRequest;
    
    const sendSpy = vi.fn().mockReturnThis();
    const codeSpy = vi.fn().mockReturnValue({ send: sendSpy });
    const mockReply = { code: codeSpy } as unknown as FastifyReply;

    const result = await validateOrReply(schema, mockReq, mockReply);

    expect(result).toBeNull();
    expect(codeSpy).toHaveBeenCalledWith(400);
  });

  // ── Mutation-killing: exact status code 400 ──────────────────────────────

  it('sends exactly status code 400 (not 401, 404, or 500) — kills NumberLiteral mutation', async () => {
    const schema = z.object({ name: z.string() });
    const mockReq = { body: { name: 123 } } as FastifyRequest;

    const sendSpy = vi.fn().mockReturnThis();
    const codeSpy = vi.fn().mockReturnValue({ send: sendSpy });
    const mockReply = { code: codeSpy } as unknown as FastifyReply;

    await validateOrReply(schema, mockReq, mockReply);

    expect(codeSpy).toHaveBeenCalledWith(400);
    expect(codeSpy).not.toHaveBeenCalledWith(401);
    expect(codeSpy).not.toHaveBeenCalledWith(404);
    expect(codeSpy).not.toHaveBeenCalledWith(500);
  });

  it('returns null (not undefined or a value) on validation failure — kills BlockStatement return mutation', async () => {
    const schema = z.object({ x: z.number() });
    const mockReq = { body: { x: 'not-a-number' } } as FastifyRequest;

    const sendSpy = vi.fn().mockReturnThis();
    const codeSpy = vi.fn().mockReturnValue({ send: sendSpy });
    const mockReply = { code: codeSpy } as unknown as FastifyReply;

    const result = await validateOrReply(schema, mockReq, mockReply);

    expect(result).toBeNull();
    expect(result).not.toBeUndefined();
  });

  it('returns parsed data (not null or undefined) on successful validation — kills ConditionalExpression inversion mutation', async () => {
    const schema = z.object({ count: z.number() });
    const mockReq = { body: { count: 42 } } as FastifyRequest;
    const mockReply = {} as FastifyReply;

    const result = await validateOrReply(schema, mockReq, mockReply);

    expect(result).not.toBeNull();
    expect(result).not.toBeUndefined();
    expect(result?.count).toBe(42);
  });

  it('error object contains "error" key (not "errors" or "message") — kills ObjectLiteral key mutation', async () => {
    const schema = z.object({ val: z.string() });
    const mockReq = { body: { val: 99 } } as FastifyRequest;

    const sendSpy = vi.fn().mockReturnThis();
    const codeSpy = vi.fn().mockReturnValue({ send: sendSpy });
    const mockReply = { code: codeSpy } as unknown as FastifyReply;

    await validateOrReply(schema, mockReq, mockReply);

    const sentPayload = sendSpy.mock.calls[0][0] as Record<string, unknown>;
    // Key must be "error" not "errors", "message", or other
    expect(Object.keys(sentPayload)).toContain('error');
    expect(Object.keys(sentPayload)).not.toContain('errors');
    expect(Object.keys(sentPayload)).not.toContain('message');
  });

  it('uses flatten() to format errors — kills MethodExpression .flatten() removal mutation', async () => {
    const schema = z.object({ age: z.number().min(18) });
    const mockReq = { body: { age: 5 } } as FastifyRequest;

    const sendSpy = vi.fn().mockReturnThis();
    const codeSpy = vi.fn().mockReturnValue({ send: sendSpy });
    const mockReply = { code: codeSpy } as unknown as FastifyReply;

    await validateOrReply(schema, mockReq, mockReply);

    const sentError = (sendSpy.mock.calls[0][0] as Record<string, unknown>).error as Record<string, unknown>;
    // flatten() returns an object with formErrors and fieldErrors keys
    // If .flatten() were removed, the raw ZodError object would be sent
    expect(sentError).toHaveProperty('formErrors');
    expect(sentError).toHaveProperty('fieldErrors');
    expect(Array.isArray(sentError.formErrors)).toBe(true);
    expect(typeof sentError.fieldErrors).toBe('object');
  });

  it('does NOT send error response on successful validation — kills ConditionalExpression true mutation', async () => {
    const schema = z.object({ username: z.string() });
    const mockReq = { body: { username: 'alice' } } as FastifyRequest;

    const sendSpy = vi.fn().mockReturnThis();
    const codeSpy = vi.fn().mockReturnValue({ send: sendSpy });
    const mockReply = { code: codeSpy } as unknown as FastifyReply;

    await validateOrReply(schema, mockReq, mockReply);

    // No error should be sent on success
    expect(codeSpy).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
