import { describe, expect, it } from 'vitest';
import { deriveKey } from './crypto.js';

describe('deriveKey', () => {
  it('returns 32-byte key for AES-256-GCM', async () => {
    const key = await deriveKey('master-pass', Buffer.alloc(16, 1), 100_000);
    expect(key.byteLength).toBe(32);
  });
});
