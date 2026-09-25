export const vaultEntriesTableSql = `
CREATE TABLE IF NOT EXISTS vault_entries (
  id TEXT PRIMARY KEY,
  connector_name TEXT NOT NULL UNIQUE,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;
