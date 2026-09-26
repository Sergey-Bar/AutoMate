import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { DrizzleInstallationKeyStore, DrizzleSessionStore } from '@automate/db';
import * as schema from '@automate/db';
import { assertSchemaBuildIsFresh, createMigratedDatabase } from './migrations.js';

type InstallationDatabase = ConstructorParameters<typeof DrizzleInstallationKeyStore>[0];

/**
 * Identity persistence against the real schema.
 *
 * This test used to open a PGlite instance and execute three hand-written
 * `CREATE TABLE` statements. That is the bug the plan calls out: none of the
 * seven migrations were ever applied by any test, so a rename, a dropped
 * constraint, or a column the stores write but no migration creates was
 * undetectable until a deployment hit it. The DDL here is now the real migration
 * graph, and `migrations.test.ts` compares that graph against the Drizzle
 * schema in both directions.
 */
let client: PGlite;
let database: InstallationDatabase;
let installationStore: DrizzleInstallationKeyStore;
let sessionStore: DrizzleSessionStore;

beforeAll(async () => {
  assertSchemaBuildIsFresh();
  client = await createMigratedDatabase();
  database = drizzle(client, { schema }) as unknown as InstallationDatabase;
  installationStore = new DrizzleInstallationKeyStore(database);
  sessionStore = new DrizzleSessionStore(database);
});

afterAll(async () => {
  // Defensive: when `beforeAll` throws, `client` is undefined, and a teardown
  // that then throws on `client.close()` buries the real failure.
  if (client) await client.close();
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

  it('refuses a session with no expiry, which the schema requires', async () => {
    const installationId = '00000000-0000-4000-8000-000000000003';
    await expect(
      sessionStore.create({
        installationId,
        tokenHash: 'd'.repeat(64),
        issuedAt: new Date('2026-01-01T00:00:00.000Z'),
        // `expires_at` is `NOT NULL` in the real schema. Under the old
        // hand-written DDL the test could not tell the difference, because the
        // DDL was whatever the test happened to write.
        expiresAt: undefined as unknown as Date,
      }),
    ).rejects.toThrow();
  });
});
