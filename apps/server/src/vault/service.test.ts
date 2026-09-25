import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/client.js', () => {
  const data = new Map<string, any>();
  const pgMock = Object.assign(
    (strings: TemplateStringsArray, ...values: any[]) => {
      const query = strings.join('?');
      if (query.includes('INSERT INTO vault_entries')) {
        const [name, ciphertext, iv, authTag, salt, iterations] = values;
        data.set(name, { ciphertext, iv, auth_tag: authTag, salt, iterations });
        return Promise.resolve();
      }
      if (query.includes('SELECT ciphertext')) {
        const name = values[0];
        const row = data.get(name);
        return Promise.resolve(row ? [row] : []);
      }
      return Promise.resolve([]);
    },
    {
      unsafe: vi.fn().mockResolvedValue(undefined),
    }
  );
  return { pgClient: pgMock, db: {}, closeDb: vi.fn() };
});

import { createVaultService } from './service.js';

describe('vault service', () => {
  it('stores and retrieves decrypted connector credential', async () => {
    const svc = createVaultService();
    await svc.unlock('master-pass');
    await svc.setCredential('github', 'token-123');
    await expect(svc.getCredential('github')).resolves.toBe('token-123');
  });

  it('throws descriptive error when decryption fails due to wrong password', async () => {
    const svc = createVaultService();
    await svc.unlock('correct-password');
    await svc.setCredential('github', 'token-abc');
    svc.lock();
    await svc.unlock('wrong-password');
    await expect(svc.getCredential('github')).rejects.toThrow(
      'Failed to decrypt credential for github:',
    );
  });

  it('throws when setCredential is called on a locked vault', async () => {
    const svc = createVaultService();
    await expect(svc.setCredential('github', 'token-xyz')).rejects.toThrow(
      'Vault must be unlocked before setting credentials',
    );
  });

  it('throws when getCredential is called on a locked vault', async () => {
    const svc = createVaultService();
    await expect(svc.getCredential('github')).rejects.toThrow(
      'Vault must be unlocked before getting credentials',
    );
  });

  it('returns null for a non-existent connector credential', async () => {
    const svc = createVaultService();
    await svc.unlock('master-pass');
    await expect(svc.getCredential('nonexistent')).resolves.toBeNull();
  });

  it('can be created with :memory: and closed without error', () => {
    const svc = createVaultService();
    expect(() => svc.close()).not.toThrow();
  });
});
