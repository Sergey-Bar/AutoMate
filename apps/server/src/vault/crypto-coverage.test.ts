import { describe, expect, it } from 'vitest';
import { deriveKey, encryptSecret, decryptSecret } from './crypto.js';

describe('vault crypto additional coverage', () => {
  it('deriveKey rejects with error when given invalid parameters', async () => {
    // Passing an empty password and zero iterations will cause pbkdf2 to reject
    await expect(
      deriveKey('valid-pass', Buffer.from('salt'), 0)
    ).rejects.toThrow();
  });

  it('decryptSecret throws when auth tag is tampered (wrong password)', async () => {
    const encrypted = await encryptSecret('correct-password', 'secret-value');
    await expect(
      decryptSecret('wrong-password', encrypted)
    ).rejects.toThrow();
  });

  it('decryptSecret throws when ciphertext is corrupted', async () => {
    const encrypted = await encryptSecret('my-password', 'secret');
    const corrupted = {
      ...encrypted,
      ciphertext: Buffer.from('corrupted-data').toString('base64'),
    };
    await expect(
      decryptSecret('my-password', corrupted)
    ).rejects.toThrow();
  });

  it('encryptSecret produces unique IVs on each call', async () => {
    const enc1 = await encryptSecret('password', 'same-plaintext');
    const enc2 = await encryptSecret('password', 'same-plaintext');
    // IVs are randomly generated so should differ
    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.salt).not.toBe(enc2.salt);
  });

  it('encryptSecret round-trips unicode text', async () => {
    const plaintext = '日本語テスト 🔐';
    const encrypted = await encryptSecret('unicode-pass', plaintext);
    const decrypted = await decryptSecret('unicode-pass', encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('encryptSecret round-trips empty string', async () => {
    const encrypted = await encryptSecret('password', '');
    const decrypted = await decryptSecret('password', encrypted);
    expect(decrypted).toBe('');
  });
});
