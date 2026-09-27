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

describe('the duplicate runner tables are gone from the database, not just the schema', () => {
  async function tableExists(name: string): Promise<boolean> {
    const result = await client.query<{ present: boolean | null }>(
      'SELECT to_regclass($1) IS NOT NULL AS present',
      [`public.${name}`],
    );
    return result.rows[0]?.present === true;
  }

  it('dropped runner_identities and runner_enrollment_tokens', async () => {
    // The schema module and the database are two different claims. A Drizzle export
    // removed without a migration leaves the table live, and a migration without the
    // export leaves code that cannot reach a table that still exists — so this asks
    // the catalogue, not the module. `migrations.test.ts` already compares the two in
    // the other direction; this is the "is the row really deleted" half.
    expect(await tableExists('runner_identities'), 'runner_identities still exists').toBe(false);
    expect(
      await tableExists('runner_enrollment_tokens'),
      'runner_enrollment_tokens still exists',
    ).toBe(false);
  });

  it('left execution_jobs pointing at the one live runners table', async () => {
    // The dropped tables were the *other* side of this relationship. After the drop,
    // `lease_owner` must still resolve — a job leased to a runner that the scheduler
    // never consults is the failure this consolidation was filed under, and the
    // foreign key is what prevents it.
    const result = await client.query<{ table_name: string; column_name: string }>(
      `SELECT tc.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = 'execution_jobs'
          AND kcu.column_name = 'lease_owner'`,
    );
    expect(result.rows).toHaveLength(1);
    const foreignKey = await client.query<{ referenced: string | null }>(`
      SELECT ccu.table_name AS referenced
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_name = 'execution_jobs'
         AND tc.constraint_name LIKE '%lease_owner%'`);
    expect(foreignKey.rows[0]?.referenced).toBe('runners');
  });
});
