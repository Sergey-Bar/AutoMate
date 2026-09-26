import { describe, expect, it } from 'vitest';
import {
  clearKeyCache,
  keyCacheSize,
  openSecret,
  sealSecret,
  type VaultEnvelope,
} from './vault-crypto.js';

/**
 * The vault key derivation was on the request path.
 *
 * `pbkdf2Sync` at 100 000 SHA-256 iterations blocks the event loop for tens of
 * milliseconds, and it ran on *every* `openSecret` — which is every vault read. On
 * a single-threaded server that stalls every other request, and the cost scaled
 * with traffic rather than with the size of the vault.
 *
 * These tests assert the cache is exact (a rotated secret is never served the
 * previous key), bounded (a cache keyed by salt is otherwise a slow memory leak),
 * and actually effective (the second read of the same envelope is measurably
 * cheaper — a claim about a cache that only proves a value is cached is not a
 * claim about it being worth having).
 */
const SECRET_A = 'a'.repeat(48);
const SECRET_B = 'b'.repeat(48);

describe('the derived vault key is cached', () => {
  it('round-trips a secret', () => {
    clearKeyCache();
    const envelope = sealSecret('the credential', SECRET_A);
    expect(openSecret(envelope, SECRET_A)).toBe('the credential');
  });

  it('is bounded, so it is not a slow memory leak', () => {
    clearKeyCache();
    // 300 distinct envelopes against a 256-entry cache.
    for (let index = 0; index < 300; index += 1) {
      openSecret(sealSecret(`value-${index}`, SECRET_A), SECRET_A);
    }
    expect(keyCacheSize()).toBeLessThanOrEqual(256);
    clearKeyCache();
    expect(keyCacheSize()).toBe(0);
  });

  it('never serves a key derived from a previous secret', () => {
    clearKeyCache();
    const envelope = sealSecret('the credential', SECRET_A);
    // Warm the cache with secret A, then try to open it with secret B. A cache
    // keyed on anything other than both the secret and the salt would return A's
    // key here and either produce garbage or, worse, decrypt with the old key.
    expect(openSecret(envelope, SECRET_A)).toBe('the credential');
    expect(() => openSecret(envelope, SECRET_B)).toThrow();
  });

  it('makes a repeated read materially cheaper than the first', () => {
    clearKeyCache();
    const envelope = sealSecret('the credential', SECRET_A);

    const firstStart = process.hrtime.bigint();
    openSecret(envelope, SECRET_A);
    const first = Number(process.hrtime.bigint() - firstStart) / 1e6;

    const secondStart = process.hrtime.bigint();
    for (let index = 0; index < 20; index += 1) openSecret(envelope, SECRET_A);
    const twenty = Number(process.hrtime.bigint() - secondStart) / 1e6;

    // Twenty warm reads must cost less than two cold ones, with a wide margin so
    // this is not a coin flip on a loaded machine. The point is the order of
    // magnitude, not a microbenchmark.
    expect(twenty).toBeLessThan(Math.max(first * 2, 5));
  });

  it('still refuses a secret that is too short, before touching the cache', () => {
    clearKeyCache();
    expect(() => sealSecret('x', 'short')).toThrow(/at least 32 characters/);
  });

  it('rejects an envelope it does not understand', () => {
    const envelope = sealSecret('the credential', SECRET_A) as VaultEnvelope;
    expect(() => openSecret({ ...envelope, version: 2 as 1 }, SECRET_A)).toThrow(
      /Unsupported vault envelope/,
    );
    expect(() =>
      openSecret({ ...envelope, algorithm: 'aes-128-cbc' as 'aes-256-gcm' }, SECRET_A),
    ).toThrow(/Unsupported vault envelope/);
  });

  it('rejects a tampered ciphertext rather than returning corrupt plaintext', () => {
    clearKeyCache();
    const envelope = sealSecret('the credential', SECRET_A);
    const tampered: VaultEnvelope = {
      ...envelope,
      ciphertext: Buffer.from('not the ciphertext').toString('base64url'),
    };
    // GCM authenticates: a modified ciphertext fails the tag check, so tampering
    // is detected rather than decrypted into plausible nonsense.
    expect(() => openSecret(tampered, SECRET_A)).toThrow();
  });
});
