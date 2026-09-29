import { describe, expect, it } from 'vitest';
import { EncryptedSpool } from './spool.js';

/**
 * The `RunnerClient` cases that used to be here are gone with the class.
 *
 * They were green, and they were the only reason anyone believed the file was
 * covered. `src/client.ts` was never imported by the runner binary, which uses
 * `apps/runner/src/client.ts` — a different class with a different name — so the
 * tests exercised a second implementation of a protocol the first one already
 * owned. Two clients and two sets of tests for one endpoint pair is how a
 * protocol change lands in one and silently misses the other.
 */
describe('EncryptedSpool', () => {
  it('round trips records and rejects a different key', () => {
    const key = Buffer.alloc(32, 7);
    const spool = new EncryptedSpool(key);
    const sealed = spool.seal({ sequence: 1, payload: { status: 'succeeded' } });
    expect(spool.open(sealed)).toEqual({ sequence: 1, payload: { status: 'succeeded' } });
    expect(() => new EncryptedSpool(Buffer.alloc(32, 8)).open(sealed)).toThrow();
  });

  it('derives a stable key from a secret and fingerprints it', () => {
    const first = new EncryptedSpool('runner-secret');
    const second = new EncryptedSpool('runner-secret');
    expect(first.keyId()).toBe(second.keyId());
    expect(new EncryptedSpool('other-secret').keyId()).not.toBe(first.keyId());
    expect(() => new EncryptedSpool(Buffer.alloc(16, 7))).toThrow('32 bytes');
    expect(() => new EncryptedSpool('')).toThrow();
  });

  it('fails closed on tampered and incomplete frames', () => {
    const spool = new EncryptedSpool('runner-secret');
    const sealed = spool.seal({ sequence: 2, payload: { status: 'failed' } });
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => spool.open(tampered)).toThrow(/authentication/u);
    expect(() => spool.open(sealed.subarray(0, 8))).toThrow(/envelope/u);
  });
});
