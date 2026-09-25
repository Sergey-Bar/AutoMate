import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { DrizzleInstallationKeyStore, DrizzleSessionStore } from '@automate/db';
import * as schema from '@automate/db';

const CREATE_IDENTITY_TABLES = `
  CREATE TABLE installations (id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE installation_keys (
    id uuid PRIMARY KEY,
    installation_id uuid NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
    name text NOT NULL,
    key_hash text NOT NULL,
    display_prefix text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    expires_at timestamptz,
    revoked_at timestamptz
  );
  CREATE UNIQUE INDEX installation_keys_hash_idx ON installation_keys(key_hash);
  CREATE UNIQUE INDEX installation_keys_installation_name_idx ON installation_keys(installation_id, name);
  CREATE TABLE sessions (
    id uuid PRIMARY KEY,
    installation_id uuid NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
    token_hash text NOT NULL,
    issued_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz
  );
  CREATE UNIQUE INDEX sessions_token_hash_idx ON sessions(token_hash);
`;

type InstallationDatabase = ConstructorParameters<typeof DrizzleInstallationKeyStore>[0];

let client: PGlite;
let database: InstallationDatabase;
let installationStore: DrizzleInstallationKeyStore;
let sessionStore: DrizzleSessionStore;

beforeEach(async () => {
  client = new PGlite();
  await client.exec(CREATE_IDENTITY_TABLES);
  database = drizzle(client, { schema }) as unknown as InstallationDatabase;
  installationStore = new DrizzleInstallationKeyStore(database);
  sessionStore = new DrizzleSessionStore(database);
});

afterEach(async () => {
  await client.close();
});

describe('identity persistence', () => {
  it('bootstraps one installation key and does not overwrite it', async () => {
    const installationId = '00000000-0000-4000-8000-000000000001';
    const firstHash = 'a'.repeat(64);
    const secondHash = 'b'.repeat(64);
    expect(
      await installationStore.ensureBootstrap({
        installationId,
        keyHash: firstHash,
        displayPrefix: 'one',
      }),
    ).toBe(firstHash);
    expect(
      await installationStore.ensureBootstrap({
        installationId,
        keyHash: secondHash,
        displayPrefix: 'two',
      }),
    ).toBe(firstHash);
  });

  it('persists, validates, and revokes a session', async () => {
    const installationId = '00000000-0000-4000-8000-000000000002';
    const tokenHash = 'c'.repeat(64);
    const issuedAt = new Date('2026-01-01T00:00:00.000Z');
    const expiresAt = new Date('2026-01-02T00:00:00.000Z');
    const sessionId = await sessionStore.create({ installationId, tokenHash, issuedAt, expiresAt });
    expect((await sessionStore.findValid(tokenHash, issuedAt))?.id).toBe(sessionId);
    expect(await sessionStore.revoke(sessionId, new Date('2026-01-01T12:00:00.000Z'))).toBe(true);
    expect(await sessionStore.findValid(tokenHash, issuedAt)).toBeUndefined();
  });
});
