/**
 * Tests for generateSessionToken and validateSessionToken in services/auth.ts
 * These functions were previously uncovered (lines 94-138).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn<(filePath: string) => boolean>(),
  readFileSync: vi.fn<(filePath: string, encoding: BufferEncoding) => string>(),
  writeFileSync: vi.fn<(filePath: string, data: string, encoding: BufferEncoding) => void>(),
  mkdirSync: vi.fn<(dirPath: string, options?: { recursive?: boolean }) => void>(),
}));

vi.mock('node:fs', () => ({
  default: fsMocks,
  existsSync: fsMocks.existsSync,
  readFileSync: fsMocks.readFileSync,
  writeFileSync: fsMocks.writeFileSync,
  mkdirSync: fsMocks.mkdirSync,
}));

import {
  generateSessionToken,
  validateSessionToken,
  generateApiKey,
  getCookieSecret,
  type AuthConfig,
} from '../auth.js';

describe('generateSessionToken', () => {
  it('returns a token in keyId:timestamp:signature format', () => {
    const token = generateSessionToken('test-key-id');
    const parts = token.split(':');
    // keyId can contain colons but signature is last hex, timestamp second-to-last
    expect(parts.length).toBeGreaterThanOrEqual(3);
  });

  it('token starts with the provided keyId', () => {
    const keyId = 'my-key-id';
    const token = generateSessionToken(keyId);
    expect(token.startsWith(`${keyId}:`)).toBe(true);
  });

  it('token contains a numeric timestamp', () => {
    // eslint-disable-next-line test-flakiness/no-random-data
    const before = Date.now();
    const token = generateSessionToken('some-id');
    // eslint-disable-next-line test-flakiness/no-random-data
    const after = Date.now();

    const parts = token.split(':');
    // format: keyId:timestamp:signature
    const timestamp = Number(parts[1]);
    expect(Number.isFinite(timestamp)).toBe(true);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  it('token contains a hex HMAC signature', () => {
    const token = generateSessionToken('key-id');
    const parts = token.split(':');
    const signature = parts[parts.length - 1];
    expect(/^[a-f0-9]{64}$/.test(signature)).toBe(true);
  });

  it('generates different tokens for different keyIds', () => {
    const token1 = generateSessionToken('key-1');
    const token2 = generateSessionToken('key-2');
    expect(token1).not.toBe(token2);
  });

  it('generates different tokens for consecutive calls (different timestamps)', async () => {
    const token1 = generateSessionToken('same-key');
    await new Promise((resolve) => setTimeout(resolve, 2));
    const token2 = generateSessionToken('same-key');
    // Timestamp portion will differ
    expect(token1).not.toBe(token2);
  });

  it('uses COOKIE_SECRET env var for signing when set', () => {
    const originalSecret = process.env.COOKIE_SECRET;
    process.env.COOKIE_SECRET = 'custom-secret-for-test';
    const tokenWithCustom = generateSessionToken('k1');

    process.env.COOKIE_SECRET = 'different-secret';
    const tokenWithDifferent = generateSessionToken('k1');

    // Tokens will have different signatures due to different secrets
    const sig1 = tokenWithCustom.split(':').pop();
    const sig2 = tokenWithDifferent.split(':').pop();
    expect(sig1).not.toBe(sig2);

    process.env.COOKIE_SECRET = originalSecret;
  });
});

describe('validateSessionToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns false for empty string token', () => {
    expect(validateSessionToken('')).toBe(false);
  });

  it('returns false for token missing parts (no colons)', () => {
    expect(validateSessionToken('invalid')).toBe(false);
  });

  it('returns false for token with only two parts', () => {
    expect(validateSessionToken('keyId:timestamp')).toBe(false);
  });

  it('returns false for token with non-numeric timestamp', () => {
    expect(validateSessionToken('keyId:not-a-number:signature')).toBe(false);
  });

  it('returns false for expired session (older than 7 days)', () => {
    // eslint-disable-next-line test-flakiness/no-random-data
    const oldTimestamp = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 days ago
    const payload = `test-key:${oldTimestamp}`;
    const sig = crypto
      .createHmac('sha256', process.env.COOKIE_SECRET ?? 'automate-dev-secret')
      .update(payload)
      .digest('hex');
    const token = `${payload}:${sig}`;

    expect(validateSessionToken(token)).toBe(false);
  });

  it('returns false for future timestamp (negative age)', () => {
    // eslint-disable-next-line test-flakiness/no-random-data
    const futureTimestamp = Date.now() + 60 * 60 * 1000; // 1 hour future
    const payload = `test-key:${futureTimestamp}`;
    const sig = crypto
      .createHmac('sha256', process.env.COOKIE_SECRET ?? 'automate-dev-secret')
      .update(payload)
      .digest('hex');
    const token = `${payload}:${sig}`;

    expect(validateSessionToken(token)).toBe(false);
  });

  it('returns false for tampered signature', () => {
    // eslint-disable-next-line test-flakiness/no-random-data
    const timestamp = Date.now();
    const token = `some-key:${timestamp}:tampered-signature-that-is-wrong`;
    expect(validateSessionToken(token)).toBe(false);
  });

  it('returns false for valid signature but key not in config', () => {
    // Set up fs mock with empty config
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue(JSON.stringify({ keys: [], enabled: true }));

    const token = generateSessionToken('nonexistent-key-id');
    const result = validateSessionToken(token);
    expect(result).toBe(false);
  });

  it('returns true for valid token with matching key in config', () => {
    const key = generateApiKey('test-key');
    const config: AuthConfig = {
      keys: [key],
      enabled: true,
    };
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));

    const token = generateSessionToken(key.id);
    const result = validateSessionToken(token);
    expect(result).toBe(true);
  });

  it('returns false for wrong signature length (buffer length mismatch)', () => {
    // eslint-disable-next-line test-flakiness/no-random-data
    const timestamp = Date.now();
    // Short signature that doesn't match expected 64-char hex
    const token = `key:${timestamp}:short`;
    expect(validateSessionToken(token)).toBe(false);
  });

  it('round-trip: generate then validate returns true when key is in config', () => {
    const key = generateApiKey('round-trip-key');
    const config: AuthConfig = {
      keys: [key],
      enabled: true,
    };
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));

    const token = generateSessionToken(key.id);
    expect(validateSessionToken(token)).toBe(true);
  });
});

describe('getCookieSecret', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalCookieSecret = process.env.COOKIE_SECRET;

  afterEach(() => {
    // Restore original env values
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalCookieSecret === undefined) {
      delete process.env.COOKIE_SECRET;
    } else {
      process.env.COOKIE_SECRET = originalCookieSecret;
    }
  });

  it('throws in production when COOKIE_SECRET not set', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.COOKIE_SECRET;

    expect(() => getCookieSecret()).toThrow(
      'COOKIE_SECRET environment variable is required in production',
    );
  });

  it('returns dev secret in non-production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.COOKIE_SECRET;

    const secret = getCookieSecret();
    expect(secret).toBe('automate-dev-secret');
  });

  it('returns COOKIE_SECRET when set', () => {
    process.env.NODE_ENV = 'production';
    process.env.COOKIE_SECRET = 'my-super-secure-production-secret';

    const secret = getCookieSecret();
    expect(secret).toBe('my-super-secure-production-secret');
  });
});
