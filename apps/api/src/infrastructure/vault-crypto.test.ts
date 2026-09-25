import { describe, expect, it } from 'vitest';
import { openSecret, sealSecret } from './vault-crypto.js';

const secret = 'v'.repeat(32);

describe('versioned vault crypto', () => {
  it('round trips a secret with an explicit envelope version', () => {
    const envelope = sealSecret('connector-token', secret);
    expect(envelope.version).toBe(1);
    expect(envelope.algorithm).toBe('aes-256-gcm');
    expect(openSecret(envelope, secret)).toBe('connector-token');
  });

  it('rejects wrong keys and malformed envelopes', () => {
    const envelope = sealSecret('connector-token', secret);
    expect(() => openSecret(envelope, 'w'.repeat(32))).toThrow();
    expect(() => openSecret({ ...envelope, version: 2 as 1 }, secret)).toThrow();
  });
});
