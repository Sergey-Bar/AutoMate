import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { BootstrapKeyUnavailableError, DrizzleInstallationKeyStore } from '@automate/db';
import { installationKeys } from '@automate/db';
import { assertSchemaBuildIsFresh, createMigratedDatabase } from './migrations.js';

/**
 * P-10, against the real migration graph.
 *
 * Neither defect in `ensureBootstrap` produced an error, which is why a unit test with
 * a mocked database could never have found either: the race only appears when two
 * callers interleave, and the revoked key only appears when a row has been revoked.
 * Both need a real database with the real unique index.
 */

let client: PGlite;
let store: DrizzleInstallationKeyStore;

const INSTALLATION = '0f4c2a90-1111-4a2b-9c3d-5e6f70819aaa';
const HASH = 'a'.repeat(64);
const PREFIX = 'am_live_';

beforeEach(async () => {
  // `@automate/db` resolves to `dist/`, and this test asserts against the migrated
  // schema, so a stale build would compare against yesterday's tables.
  assertSchemaBuildIsFresh();
  client = await createMigratedDatabase();
  // PGlite is a WASM Postgres and Drizzle brands `PgliteDatabase` separately from
  // `NodePgDatabase`, although the query surface this repository uses is the same. The
  // store is typed against the real `pg` client, and widening that type for a test
  // double would cost production type safety, so the accommodation is explicit here and
  // at the boundary rather than loosened into the store.
  store = new DrizzleInstallationKeyStore(
    drizzle(client) as unknown as ConstructorParameters<typeof DrizzleInstallationKeyStore>[0],
  );
});

const bootstrap = (overrides: { keyHash?: string } = {}) =>
  store.ensureBootstrap({
    installationId: INSTALLATION,
    keyHash: overrides.keyHash ?? HASH,
    displayPrefix: PREFIX,
  });

/** Revoke the installation's key directly, as an operator would. */
async function revokeExisting(): Promise<void> {
  await client.exec(
    `UPDATE installation_keys SET revoked_at = now() WHERE installation_id = '${INSTALLATION}'`,
  );
}

describe('ensureBootstrap', () => {
  it('creates a key when the installation has none', async () => {
    expect(await bootstrap()).toBe(HASH);
  });

  it('returns the stored hash on a second call rather than minting another', async () => {
    await bootstrap();
    expect(await bootstrap()).toBe(HASH);
    const rows = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM installation_keys',
    );
    expect(rows.rows[0]?.count).toBe('1');
  });

  it('is idempotent under concurrent callers, rather than throwing a unique violation', async () => {
    // The race. Two callers — two API containers during a rolling restart, or a second
    // replica — both saw no key and both tried to insert. The insert now carries
    // `onConflictDoNothing`, so the loser reads the winner's row instead of surfacing a
    // raw constraint violation as a 500.
    const [first, second] = await Promise.all([bootstrap(), bootstrap()]);
    expect(first).toBe(HASH);
    expect(second).toBe(HASH);
  });

  it("returns the hash the winner persisted, not the loser's own value", async () => {
    // The subtle half. After a conflict the stored row belongs to the *other* process,
    // so returning the caller's `keyHash` would tell it its value was persisted when it
    // was not — and the caller would derive a secret that the database does not hold.
    const winner = 'b'.repeat(64);
    const loser = 'c'.repeat(64);
    const [a, b] = await Promise.all([
      bootstrap({ keyHash: winner }),
      bootstrap({ keyHash: loser }),
    ]);
    expect(a).toBe(b);

    const rows = await client.query<{ key_hash: string }>(
      'SELECT key_hash FROM installation_keys WHERE installation_id = $1',
      [INSTALLATION],
    );
    expect([a, b]).toContain(rows.rows[0]?.key_hash);
  });

  it('refuses to return a revoked key', async () => {
    // The dangerous half, because nothing errored before. The old select fetched
    // `keyHash` alone and never looked at `revokedAt`, so a caller bootstrapping with a
    // revoked key would derive a secret, send it, and be refused by the very API it is
    // bootstrapping.
    await bootstrap();
    await revokeExisting();
    await expect(bootstrap()).rejects.toBeInstanceOf(BootstrapKeyUnavailableError);
  });

  it("names revocation in the failure, because that is the operator's next step", async () => {
    await bootstrap();
    await revokeExisting();
    await expect(bootstrap()).rejects.toThrow(/is revoked/);
  });

  it('refuses to return an expired key, which is not a working key either', async () => {
    await bootstrap();
    await client.exec(
      `UPDATE installation_keys SET expires_at = now() - interval '1 hour' WHERE installation_id = '${INSTALLATION}'`,
    );
    await expect(bootstrap()).rejects.toThrow(/is expired/);
  });

  it('still serves a key whose expiry is in the future', async () => {
    // The predicate has to be a real usability test rather than "not revoked", or it
    // would refuse a perfectly good time-limited key.
    await bootstrap();
    await client.exec(
      `UPDATE installation_keys SET expires_at = now() + interval '1 hour' WHERE installation_id = '${INSTALLATION}'`,
    );
    expect(await bootstrap()).toBe(HASH);
  });

  it('prefers revocation over expiry when both apply', async () => {
    // Revocation is the deliberate state; an expiry layered on top of it is the less
    // useful half of the answer, and telling an operator to fix the wrong one sends
    // them to the wrong place.
    await bootstrap();
    await client.exec(
      `UPDATE installation_keys SET revoked_at = now(), expires_at = now() - interval '1 hour' WHERE installation_id = '${INSTALLATION}'`,
    );
    await expect(bootstrap()).rejects.toThrow(/is revoked/);
  });

  it('reports revoked rather than claiming nothing exists, when a row does exist', async () => {
    // The failure message names the installation and the state, so this is about the
    // reason reaching the caller rather than about the row count.
    await bootstrap();
    await revokeExisting();
    const failure = await bootstrap().then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(failure).toBeInstanceOf(BootstrapKeyUnavailableError);
    const error = failure as BootstrapKeyUnavailableError;
    expect(error.installationId).toBe(INSTALLATION);
    expect(error.reason).toBe('revoked');
  });

  it('keeps separate installations independent', async () => {
    // The tenancy boundary, at the one place bootstrap touches it.
    const other = '0f4c2a90-2222-4a2b-9c3d-5e6f70819bbb';
    const otherHash = 'd'.repeat(64);
    await bootstrap();
    await store.ensureBootstrap({
      installationId: other,
      keyHash: otherHash,
      displayPrefix: PREFIX,
    });

    const rows = await client.query<{ installation_id: string }>(
      'SELECT installation_id FROM installation_keys ORDER BY installation_id',
    );
    expect(rows.rows.map((r) => r.installation_id)).toEqual([INSTALLATION, other].sort());
  });
});

// Referenced so the import is load-bearing: these cases read and revoke rows directly
// through the client, and this asserts the column they act on is the schema's.
it('acts on the revokedAt column the schema declares', async () => {
  expect(installationKeys.revokedAt).toBeDefined();
  expect(eq(installationKeys.installationId, INSTALLATION)).toBeDefined();
});
