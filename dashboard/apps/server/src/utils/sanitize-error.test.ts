import { describe, it, expect } from 'vitest';
import { sanitizeError } from './sanitize-error.js';

describe('sanitizeError', () => {
  it('extracts only name, message, and stack from Error instances', () => {
    const err = new TypeError('boom');
    const result = sanitizeError(err) as Record<string, unknown>;
    expect(result).toEqual({
      name: 'TypeError',
      message: 'boom',
      stack: err.stack,
    });
    // No extra Error properties leak through
    expect(Object.keys(result)).toEqual(['name', 'message', 'stack']);
  });

  it('redacts sensitive keys from plain objects', () => {
    const obj = {
      url: 'https://example.com',
      apiKey: 'sk-secret-123',
      password: 'hunter2',
      token: 'jwt.value',
      safe: 'visible',
    };
    const result = sanitizeError(obj) as Record<string, unknown>;
    expect(result.url).toBe('https://example.com');
    expect(result.safe).toBe('visible');
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.password).toBe('[REDACTED]');
    expect(result.token).toBe('[REDACTED]');
  });

  it('redacts case-insensitively', () => {
    const obj = { Authorization: 'Bearer xyz', Cookie: 'session=abc', api_key: 'k' };
    const result = sanitizeError(obj) as Record<string, unknown>;
    expect(result.Authorization).toBe('[REDACTED]');
    expect(result.Cookie).toBe('[REDACTED]');
    expect(result.api_key).toBe('[REDACTED]');
  });

  it('does not recurse into nested objects (top-level only)', () => {
    const obj = { nested: { apiKey: 'leak' }, credential: 'top-secret' };
    const result = sanitizeError(obj) as Record<string, unknown>;
    // Nested object passes through as-is — no deep scrubbing
    expect((result.nested as Record<string, unknown>).apiKey).toBe('leak');
    // Top-level sensitive key is redacted
    expect(result.credential).toBe('[REDACTED]');
  });

  it('passes through primitive strings', () => {
    expect(sanitizeError('simple error')).toBe('simple error');
  });

  it('passes through primitive numbers', () => {
    expect(sanitizeError(42)).toBe(42);
  });

  it('passes through null and undefined', () => {
    expect(sanitizeError(null)).toBeNull();
    expect(sanitizeError(undefined)).toBeUndefined();
  });
});
