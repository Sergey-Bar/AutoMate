import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto.js';

describe('vault encryption', () => {
  it('round-trips plaintext with auth tag', async () => {
    const encrypted = await encryptSecret('master-pass', 'token-value');
    const decrypted = await decryptSecret('master-pass', encrypted);
    expect(decrypted).toBe('token-value');
  });
});
