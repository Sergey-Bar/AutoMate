import { describe, expect, it } from 'vitest';
import { vaultEntriesTableSql } from './schema.js';

describe('vault schema', () => {
  it('creates vault_entries table', () => {
    expect(vaultEntriesTableSql).toContain('CREATE TABLE IF NOT EXISTS vault_entries');
  });
});
