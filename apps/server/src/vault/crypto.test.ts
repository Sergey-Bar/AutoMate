import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { deriveKey, encryptSecret, decryptSecret } from './crypto.js';

describe('deriveKey', () => {
  it('returns a Buffer of exactly 32 bytes', async () => {
    const salt = randomBytes(16);
    const key = await deriveKey('my-password', salt, 1000);

    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.byteLength).toBe(32);
  });

  it('is deterministic — same inputs produce identical key', async () => {
    const salt = randomBytes(16);
    const key1 = await deriveKey('stable-password', salt, 1000);
    const key2 = await deriveKey('stable-password', salt, 1000);

    expect(key1.equals(key2)).toBe(true);
  });

  it('produces different keys for different salts', async () => {
    const salt1 = randomBytes(16);
    const salt2 = randomBytes(16);
    const key1 = await deriveKey('same-password', salt1, 1000);
    const key2 = await deriveKey('same-password', salt2, 1000);

    expect(key1.equals(key2)).toBe(false);
  });

  it('produces different keys for different passwords', async () => {
    const salt = randomBytes(16);
    const key1 = await deriveKey('password-A', salt, 1000);
    const key2 = await deriveKey('password-B', salt, 1000);

    expect(key1.equals(key2)).toBe(false);
  });

  it('produces different keys for different iteration counts', async () => {
    const salt = randomBytes(16);
    const key1 = await deriveKey('password', salt, 1000);
    const key2 = await deriveKey('password', salt, 2000);

    expect(key1.equals(key2)).toBe(false);
  });
});

describe('encryptSecret', () => {
  it('returns an EncryptedSecret with all required fields populated', async () => {
    const encrypted = await encryptSecret('my-password', 'my plaintext secret');

    expect(encrypted).toHaveProperty('ciphertext');
    expect(encrypted).toHaveProperty('iv');
    expect(encrypted).toHaveProperty('authTag');
    expect(encrypted).toHaveProperty('salt');
    expect(encrypted).toHaveProperty('iterations');
    expect(typeof encrypted.ciphertext).toBe('string');
    expect(encrypted.ciphertext.length).toBeGreaterThan(0);
    expect(typeof encrypted.iv).toBe('string');
    expect(encrypted.iv.length).toBeGreaterThan(0);
    expect(typeof encrypted.authTag).toBe('string');
    expect(encrypted.authTag.length).toBeGreaterThan(0);
    expect(typeof encrypted.salt).toBe('string');
    expect(encrypted.salt.length).toBeGreaterThan(0);
    expect(encrypted.iterations).toBe(100_000);
  });

  it('produces valid base64 strings for ciphertext, iv, authTag, and salt', async () => {
    const encrypted = await encryptSecret('pass', 'data');

    const base64Re = /^[A-Za-z0-9+/]*={0,2}$/;
    expect(encrypted.ciphertext).toMatch(base64Re);
    expect(encrypted.iv).toMatch(base64Re);
    expect(encrypted.authTag).toMatch(base64Re);
    expect(encrypted.salt).toMatch(base64Re);
  });

  it('produces different ciphertexts for the same input on repeated calls (random IV/salt)', async () => {
    const encrypted1 = await encryptSecret('same-password', 'same-plaintext');
    const encrypted2 = await encryptSecret('same-password', 'same-plaintext');

    // IVs and salts are random — they must differ, producing different ciphertexts
    expect(encrypted1.iv).not.toBe(encrypted2.iv);
    expect(encrypted1.salt).not.toBe(encrypted2.salt);
    expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
  });

  it('stores iterations as 100000', async () => {
    const encrypted = await encryptSecret('p', 'data');

    expect(encrypted.iterations).toBe(100_000);
  });

  it('produces a 12-byte IV (base64 of 12 bytes = 16 chars)', async () => {
    const encrypted = await encryptSecret('p', 'x');
    const ivBuf = Buffer.from(encrypted.iv, 'base64');

    expect(ivBuf.byteLength).toBe(12);
  });

  it('produces a 16-byte salt (base64 of 16 bytes = 24 chars)', async () => {
    const encrypted = await encryptSecret('p', 'x');
    const saltBuf = Buffer.from(encrypted.salt, 'base64');

    expect(saltBuf.byteLength).toBe(16);
  });
});

describe('decryptSecret', () => {
  it('round-trips: decryptSecret recovers the original plaintext', async () => {
    const plaintext = 'Hello, vault!';
    const encrypted = await encryptSecret('correct-password', plaintext);

    const recovered = await decryptSecret('correct-password', encrypted);

    expect(recovered).toBe(plaintext);
  });

  it('round-trips with an empty string as plaintext', async () => {
    const encrypted = await encryptSecret('pass', '');

    const recovered = await decryptSecret('pass', encrypted);

    expect(recovered).toBe('');
  });

  it('round-trips with unicode / multi-byte characters', async () => {
    const plaintext = '🔐 שלום world — "quotes" & <brackets>';
    const encrypted = await encryptSecret('unicode-pass', plaintext);

    const recovered = await decryptSecret('unicode-pass', encrypted);

    expect(recovered).toBe(plaintext);
  });

  it('round-trips with a long payload', async () => {
    const plaintext = 'x'.repeat(10_000);
    const encrypted = await encryptSecret('long-pass', plaintext);

    const recovered = await decryptSecret('long-pass', encrypted);

    expect(recovered).toBe(plaintext);
  });

  it('throws when decrypting with the wrong password', async () => {
    const encrypted = await encryptSecret('correct-password', 'secret');

    await expect(decryptSecret('wrong-password', encrypted)).rejects.toThrow();
  });

  it('throws when the ciphertext has been tampered with', async () => {
    const encrypted = await encryptSecret('pass', 'secret data');

    // Flip the first byte of the ciphertext
    const ciphertextBuf = Buffer.from(encrypted.ciphertext, 'base64');
    ciphertextBuf[0] = ciphertextBuf[0]! ^ 0xff;
    const tampered = { ...encrypted, ciphertext: ciphertextBuf.toString('base64') };

    await expect(decryptSecret('pass', tampered)).rejects.toThrow();
  });

  it('throws when the authTag has been tampered with', async () => {
    const encrypted = await encryptSecret('pass', 'secret data');

    // Corrupt the auth tag
    const tagBuf = Buffer.from(encrypted.authTag, 'base64');
    tagBuf[0] = tagBuf[0]! ^ 0xff;
    const tampered = { ...encrypted, authTag: tagBuf.toString('base64') };

    await expect(decryptSecret('pass', tampered)).rejects.toThrow();
  });

  it('throws when the IV has been tampered with', async () => {
    const encrypted = await encryptSecret('pass', 'secret data');

    const ivBuf = Buffer.from(encrypted.iv, 'base64');
    ivBuf[0] = ivBuf[0]! ^ 0xff;
    const tampered = { ...encrypted, iv: ivBuf.toString('base64') };

    await expect(decryptSecret('pass', tampered)).rejects.toThrow();
  });
});
