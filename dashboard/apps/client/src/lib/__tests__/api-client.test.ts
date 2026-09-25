import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { apiFetch, ApiFetchError } from '../api-client';

describe('apiFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('performs basic GET request and returns JSON', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: '123', name: 'Test' }),
    });

    const result = await apiFetch('/api/test');

    expect(result).toEqual({ id: '123', name: 'Test' });
    expect(fetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({ headers: expect.any(Headers) }));
  });

  it('validates response with Zod schema when provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: '123', value: 42 }),
    });

    const schema = z.object({ id: z.string(), value: z.number() });
    const result = await apiFetch('/api/test', { schema });

    expect(result).toEqual({ id: '123', value: 42 });
  });

  it('throws validation error when response does not match schema', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: '123', value: 'not-a-number' }),
    });

    const schema = z.object({ id: z.string(), value: z.number() });

    await expect(apiFetch('/api/test', { schema })).rejects.toThrow('Response validation failed');
  });

  it('appends query parameters to URL', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await apiFetch('/api/test', { params: { limit: 10, offset: 0, active: true } });

    expect(fetch).toHaveBeenCalledWith(
      '/api/test?limit=10&offset=0&active=true',
      expect.any(Object),
    );
  });

  it('ignores undefined query parameters', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await apiFetch('/api/test', { params: { limit: 10, offset: undefined } });

    expect(fetch).toHaveBeenCalledWith('/api/test?limit=10', expect.any(Object));
  });

  it('appends params to existing query string', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await apiFetch('/api/test?foo=bar', { params: { baz: 'qux' } });

    expect(fetch).toHaveBeenCalledWith('/api/test?foo=bar&baz=qux', expect.any(Object));
  });

  it('sets Content-Type header for POST with body', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await apiFetch('/api/test', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test' }),
    });

    const [, options] = vi.mocked(fetch).mock.calls[0];
    expect((options as RequestInit & { headers: Headers }).headers.get('Content-Type')).toBe('application/json');
  });

  it('does not override existing Content-Type header', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await apiFetch('/api/test', {
      method: 'POST',
      body: 'plain text',
      headers: { 'Content-Type': 'text/plain' },
    });

    const [, options] = vi.mocked(fetch).mock.calls[0];
    expect((options as RequestInit & { headers: Headers }).headers.get('Content-Type')).toBe('text/plain');
  });

  it('throws ApiFetchError on HTTP 4xx errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid request' }),
    });

    await expect(apiFetch('/api/test')).rejects.toThrow(ApiFetchError);
    await expect(apiFetch('/api/test')).rejects.toMatchObject({
      status: 400,
      body: { error: 'Invalid request' },
      message: 'Invalid request',
    });
  });

  it('throws ApiFetchError on HTTP 5xx errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    });

    await expect(apiFetch('/api/test')).rejects.toThrow(ApiFetchError);
    await expect(apiFetch('/api/test')).rejects.toMatchObject({
      status: 500,
      body: { error: 'Server error' },
    });
  });

  it('handles errors with non-JSON response body', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => {
        throw new Error('Not JSON');
      },
    });

    await expect(apiFetch('/api/test')).rejects.toMatchObject({
      status: 404,
      body: null,
      message: 'HTTP 404',
    });
  });

  it('uses custom error message when provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    });

    await expect(apiFetch('/api/test', { errorMessage: 'Access denied' })).rejects.toMatchObject({
      message: 'Access denied',
    });
  });

  it('handles DELETE requests', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await apiFetch('/api/test/123', { method: 'DELETE' });

    expect(fetch).toHaveBeenCalledWith('/api/test/123', expect.objectContaining({ method: 'DELETE' }));
  });

  it('handles PUT requests with body and validation', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: '123', updated: true }),
    });

    const schema = z.object({ id: z.string(), updated: z.boolean() });

    const result = await apiFetch('/api/test/123', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Updated' }),
      schema,
    });

    expect(result).toEqual({ id: '123', updated: true });
  });

  it('logs validation errors to console', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ invalid: 'data' }),
    });

    const schema = z.object({ id: z.string() });

    await expect(apiFetch('/api/test', { schema })).rejects.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[apiFetch] Schema validation failed:',
      expect.any(Object),
    );

    consoleSpy.mockRestore();
  });
});
