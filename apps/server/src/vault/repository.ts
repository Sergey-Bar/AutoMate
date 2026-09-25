import { pgClient } from '../db/client.js';

interface StoredRecord {
  ciphertext: string;
  iv: string;
  authTag: string;
  salt: string;
  iterations: number;
}

export function createVaultRepository() {
  // Note: we now use the shared pgClient for the vault as well.
  // In a real migration, we might want to ensure the table is created.
  
  const initPromise = pgClient.unsafe(
    'CREATE TABLE IF NOT EXISTS vault_entries (connector_name TEXT PRIMARY KEY, ciphertext TEXT NOT NULL, iv TEXT NOT NULL, auth_tag TEXT NOT NULL, salt TEXT NOT NULL, iterations INTEGER NOT NULL);',
  );

  return {
    async upsert(connectorName: string, r: StoredRecord) {
      await initPromise;
      await pgClient`
        INSERT INTO vault_entries (connector_name, ciphertext, iv, auth_tag, salt, iterations)
        VALUES (${connectorName}, ${r.ciphertext}, ${r.iv}, ${r.authTag}, ${r.salt}, ${r.iterations})
        ON CONFLICT(connector_name) DO UPDATE SET
          ciphertext=EXCLUDED.ciphertext,
          iv=EXCLUDED.iv,
          auth_tag=EXCLUDED.auth_tag,
          salt=EXCLUDED.salt,
          iterations=EXCLUDED.iterations
      `;
    },
    async get(connectorName: string): Promise<StoredRecord | null> {
      await initPromise;
      const rows = await pgClient<Array<{
        ciphertext: string;
        iv: string;
        auth_tag: string;
        salt: string;
        iterations: number;
      }>>`
        SELECT ciphertext, iv, auth_tag, salt, iterations
        FROM vault_entries
        WHERE connector_name = ${connectorName}
      `;

      const row = rows[0];
      return row
        ? {
            ciphertext: row.ciphertext,
            iv: row.iv,
            authTag: row.auth_tag,
            salt: row.salt,
            iterations: row.iterations,
          }
        : null;
    },
    async close() {
      // In Postgres version, we might not want to close the shared client here
      // but for the sake of the existing API:
      // await pgClient.end();
    },
  };
}
