import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/client.js', () => {
  const data = new Map<string, any>();
  const pgMock = Object.assign(
    (strings: TemplateStringsArray, ...values: any[]) => {
      // Very simple mock for the vault queries
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

import { createVaultRepository } from './repository.js';

describe('vault repository', () => {
  it('stores and loads encrypted record by connector name', async () => {
    const repo = createVaultRepository();
    await repo.upsert('github', { ciphertext: 'a', iv: 'b', authTag: 'c', salt: 'd', iterations: 100000 });
    const result = await repo.get('github');
    expect(result?.ciphertext).toBe('a');
  });
});
