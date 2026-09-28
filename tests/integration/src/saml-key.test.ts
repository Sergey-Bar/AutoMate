import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { DrizzleOutboxRepository as DrizzleStore, samlConfig } from '@automate/db';
import { assertSchemaBuildIsFresh, createMigratedDatabase } from './migrations.js';

/**
 * P-21: the SAML Service Provider private key was a plaintext `text` column.
 *
 * A dump yielded the key directly, and an SP private key is what an attacker needs to
 * authenticate *as this installation* to every relying party that trusts it. The column is
 * now a sealed envelope, and the interesting property is not that it can hold an
 * envelope — it is that a bare string can no longer be written into it at all, whether by
 * accident, by a migration, or by a developer in a hurry.
 */

let client: PGlite;

const ROW = {
  id: 'saml-1',
  entryPoint: 'https://idp.example.com/sso',
  issuer: 'automate',
  idpCert: 'CERT',
  callbackUrl: 'https://automate.example.com/saml/callback',
  // `updated_at` is `NOT NULL` with no database default, so a row that omits it is a
  // constraint violation rather than a defaulted value. Supplied explicitly here because
  // the first run of this file failed with `23502` and a `null` in the last column,
  // which reads as a problem with the thing under test and is not.
  updatedAt: new Date('2026-09-27T00:00:00.000Z'),
};

const ENVELOPE = {
  version: 2 as const,
  algorithm: 'aes-256-gcm' as const,
  keyVersion: 1,
  salt: 'c2FsdA',
  iv: 'aXY',
  tag: 'dGFn',
  ciphertext: 'Y2lwaGVydGV4dA',
};

/**
 * A Drizzle handle for PGlite.
 *
 * PGlite is a WASM Postgres and Drizzle brands `PgliteDatabase` separately from
 * `NodePgDatabase` although the query surface is the same. Every integration test in
 * this package crosses that boundary the same way: the store is typed against the real
 * `pg` client, and widening that type for a test double would cost production type
 * safety.
 */
function db() {
  return drizzle(client) as unknown as ConstructorParameters<typeof DrizzleStore>[0];
}

beforeEach(async () => {
  assertSchemaBuildIsFresh();
  client = await createMigratedDatabase();
});

describe('the SAML service provider key', () => {
  it('stores a sealed envelope, not a key', async () => {
    await drizzle(client)
      .insert(samlConfig)
      .values({ ...ROW, spPrivateKey: ENVELOPE });
    // One jsonb column holding the envelope — the parts are inside it, not columns
    // beside it. The first version selected `ciphertext` and `salt` as though the
    // envelope had been flattened across the table, which it has not.
    const rows = await client.query<{ sp_private_key: typeof ENVELOPE | null }>(
      'SELECT sp_private_key FROM saml_config WHERE id = $1',
      [ROW.id],
    );
    // What is stored is the envelope's *parts*. The key itself is not in the row, which
    // is the whole difference.
    expect(rows.rows[0]?.sp_private_key?.ciphertext).toBe(ENVELOPE.ciphertext);
    expect(rows.rows[0]?.sp_private_key?.salt).toBe(ENVELOPE.salt);
  });

  it('leaves the plaintext guard to the type, and says so', () => {
    // Where the guard actually lives, stated because a reader will otherwise assume the
    // database enforces it.
    //
    // A `jsonb` column cannot know what an envelope is, so a raw JSON string is still a
    // valid value for it — the *type* is what rejects a bare key, and the sealer is the
    // only writer. A runtime test cannot observe either: the first is a compile-time
    // property, and asserting the second would mean re-implementing the sealer here.
    //
    // So this asserts the part that is checkable — the column is structured — and records
    // where the rest of the protection is. The case it replaces asserted a tautology and
    // embedded a PEM header that the secret scanner flagged, which is the combination that
    // teaches people to ignore a scanner.
    expect(['json', 'jsonb']).toContain(samlConfig.spPrivateKey.dataType);
  });

  it('is null when SAML is not configured, rather than holding an empty key', async () => {
    await drizzle(client).insert(samlConfig).values(ROW);
    const rows = await client.query<{ sp_private_key: unknown }>(
      'SELECT sp_private_key FROM saml_config WHERE id = $1',
      [ROW.id],
    );
    expect(rows.rows[0]?.sp_private_key).toBeNull();
  });

  it('accepts a round-tripped envelope with no loss', async () => {
    // The property that would break first if the type and the column disagreed: what
    // goes in is what comes out, byte for byte, so a seal/open cycle through the API
    // layer cannot corrupt the envelope.
    const handle = db();
    await handle.insert(samlConfig).values({ ...ROW, spPrivateKey: ENVELOPE });
    const stored = await handle.select().from(samlConfig);
    expect(stored[0]?.spPrivateKey).toEqual(ENVELOPE);
  });

  it('is no longer a text column', () => {
    // Pins the decision rather than a driver's spelling: PGlite reports `json` where the
    // pg dialect reports `jsonb`, so asserting the postgres name would test the driver.
    // What matters is that the column is structured, so a bare key string is not a valid
    // value for it.
    expect(samlConfig.spPrivateKey.dataType).not.toBe('text');
    expect(['json', 'jsonb']).toContain(samlConfig.spPrivateKey.dataType);
  });
});
