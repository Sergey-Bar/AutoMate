import { afterEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import * as schema from '@automate/db';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import { syntheticVaultSecret } from '../test-support/synthetic-credentials.js';
import {
  deleteVaultSecret,
  hasVaultSecret,
  readVaultSecret,
  rotateVaultSecrets,
  storeVaultSecret,
  type VaultOptions,
} from './vault-secrets.js';

/**
 * `vault.persistence`: the vault as the database holds it, not as one process remembers it.
 *
 * "Across a restart" is stated literally: every read below goes through a **new** options
 * object over the same PGlite database, carrying only the configured secret — nothing the
 * writer held survives except the rows. Rotation is proved the same way, and so is the audit
 * trail every write leaves.
 */

const OLD = syntheticVaultSecret();
const NEW = `${syntheticVaultSecret()}-rotated-generation-2`;
const VALUE = ['tracker', '-token-', 'for-a-test'].join('');
const WHAT = 'A test token';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function database(): Promise<MigratedDb> {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  return db;
}

/** A fresh composition: what a restarted API builds from configuration and nothing else. */
const boot = (db: MigratedDb, workspaceId: string, vaultSecret?: string): VaultOptions => ({
  db: db as never,
  workspaceId,
  ...(vaultSecret === undefined ? {} : { vaultSecret }),
});

async function rows(db: MigratedDb, workspaceId: string) {
  return db
    .select()
    .from(schema.vaultEntries)
    .where(eq(schema.vaultEntries.workspaceId, workspaceId));
}

async function audits(db: MigratedDb, workspaceId: string) {
  return db
    .select()
    .from(schema.auditEvents)
    .where(
      and(
        eq(schema.auditEvents.workspaceId, workspaceId),
        eq(schema.auditEvents.resourceType, 'vault_entry'),
      ),
    );
}

describe('vault persistence', () => {
  it('reads back after a restart what an earlier composition sealed, at key generation 1', async () => {
    const db = await database();
    await storeVaultSecret(
      { ...boot(db, 'ws-1', OLD), actor: 'session' },
      'tracker:p:jira',
      VALUE,
      WHAT,
    );
    const restarted = boot(db, 'ws-1', OLD);
    expect(await readVaultSecret(restarted, 'tracker:p:jira', WHAT)).toBe(VALUE);
    expect(await hasVaultSecret(restarted, 'tracker:p:jira')).toBe(true);
    const [row] = await rows(db, 'ws-1');
    expect(row?.keyVersion).toBe(1);
    // Sealed, never stored as written.
    expect(JSON.stringify(row)).not.toContain(VALUE);
  });

  it('refuses to seal without VAULT_SECRET, and writes nothing', async () => {
    const db = await database();
    const error = await storeVaultSecret(boot(db, 'ws-1'), 'tracker:p:jira', VALUE, WHAT).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(ErrorCode.NOT_CONFIGURED);
    expect(await rows(db, 'ws-1')).toHaveLength(0);
  });

  it('audits every store, replace and delete by name, never by value', async () => {
    const db = await database();
    const options = { ...boot(db, 'ws-1', OLD), actor: 'token:admin' };
    await storeVaultSecret(options, 'channel:c', VALUE, WHAT);
    await storeVaultSecret(options, 'channel:c', `${VALUE}-2`, WHAT);
    await deleteVaultSecret(options, 'channel:c');
    // A delete of nothing is not an event.
    await deleteVaultSecret(options, 'channel:c');
    const trail = await audits(db, 'ws-1');
    expect(trail.map((row) => row.action)).toEqual([
      'vault.secret.store',
      'vault.secret.replace',
      'vault.secret.delete',
    ]);
    expect(
      trail.every((row) => row.actorId === 'token:admin' && row.resourceId === 'channel:c'),
    ).toBe(true);
    expect(JSON.stringify(trail)).not.toContain(VALUE);
    expect(await hasVaultSecret(options, 'channel:c')).toBe(false);
  });

  it('keeps one workspace’s entry out of another’s reach', async () => {
    const db = await database();
    await storeVaultSecret(boot(db, 'ws-1', OLD), 'git:p', VALUE, WHAT);
    expect(await readVaultSecret(boot(db, 'ws-2', OLD), 'git:p', WHAT)).toBeNull();
    expect(await hasVaultSecret(boot(db, 'ws-2', OLD), 'git:p')).toBe(false);
    await deleteVaultSecret(boot(db, 'ws-2', OLD), 'git:p');
    expect(await readVaultSecret(boot(db, 'ws-1', OLD), 'git:p', WHAT)).toBe(VALUE);
  });
});

describe('vault key rotation', () => {
  it('re-seals every entry under the new secret, raises the generation, and survives a restart', async () => {
    const db = await database();
    const before = boot(db, 'ws-1', OLD);
    await storeVaultSecret(before, 'git:a', `${VALUE}-a`, WHAT);
    await storeVaultSecret(before, 'tracker:b:jira', `${VALUE}-b`, WHAT);

    expect(await rotateVaultSecrets({ ...before, actor: 'operator' }, OLD, NEW)).toEqual({
      rotated: 2,
      current: 0,
      keyVersion: 2,
    });

    const after = boot(db, 'ws-1', NEW);
    expect(await readVaultSecret(after, 'git:a', WHAT)).toBe(`${VALUE}-a`);
    expect(await readVaultSecret(after, 'tracker:b:jira', WHAT)).toBe(`${VALUE}-b`);
    expect((await rows(db, 'ws-1')).map((row) => row.keyVersion)).toEqual([2, 2]);
    // The old secret opens nothing any more.
    await expect(readVaultSecret(boot(db, 'ws-1', OLD), 'git:a', WHAT)).rejects.toThrow();
    // A secret stored after the rotation is sealed at the current generation.
    await storeVaultSecret(after, 'channel:c', VALUE, WHAT);
    const sealed = (await rows(db, 'ws-1')).find((row) => row.connectorName === 'channel:c');
    expect(sealed?.keyVersion).toBe(2);
    const [rotation] = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, 'vault.rotate'));
    expect(rotation).toMatchObject({ actorId: 'operator', resourceId: 'ws-1' });
  });

  it('changes nothing when run again with both secrets still configured', async () => {
    const db = await database();
    const options = boot(db, 'ws-1', OLD);
    await storeVaultSecret(options, 'git:a', VALUE, WHAT);
    await rotateVaultSecrets(options, OLD, NEW);
    const sealed = await rows(db, 'ws-1');
    expect(await rotateVaultSecrets(options, OLD, NEW)).toEqual({
      rotated: 0,
      current: 1,
      keyVersion: 2,
    });
    expect(await rows(db, 'ws-1')).toEqual(sealed);
  });

  it('rotates nothing when one entry opens under neither secret', async () => {
    const db = await database();
    const options = boot(db, 'ws-1', OLD);
    await storeVaultSecret(options, 'git:a', VALUE, WHAT);
    await storeVaultSecret(boot(db, 'ws-1', `${OLD}-a-secret-nobody-has`), 'git:z', VALUE, WHAT);
    const sealed = await rows(db, 'ws-1');
    const error = await rotateVaultSecrets(options, OLD, NEW).catch((caught: unknown) => caught);
    expect((error as DomainError).code).toBe(ErrorCode.CONFLICT);
    // One transaction: the entry that would have rotated is still on the old key.
    expect(await rows(db, 'ws-1')).toEqual(sealed);
    expect(await readVaultSecret(options, 'git:a', WHAT)).toBe(VALUE);
  });

  it('refuses two equal or short secrets before reading anything', async () => {
    const db = await database();
    const options = boot(db, 'ws-1', OLD);
    for (const [previous, next] of [
      [OLD, OLD],
      ['short', NEW],
      [OLD, 'short'],
    ] as const) {
      const error = await rotateVaultSecrets(options, previous, next).catch(
        (caught: unknown) => caught,
      );
      expect((error as DomainError).code).toBe(ErrorCode.INVALID_REQUEST);
    }
  });

  it('rotates one workspace and leaves the other on its own key', async () => {
    const db = await database();
    await storeVaultSecret(boot(db, 'ws-1', OLD), 'git:a', VALUE, WHAT);
    await storeVaultSecret(boot(db, 'ws-2', OLD), 'git:a', VALUE, WHAT);
    await rotateVaultSecrets(boot(db, 'ws-1'), OLD, NEW);
    expect(await readVaultSecret(boot(db, 'ws-2', OLD), 'git:a', WHAT)).toBe(VALUE);
    expect((await rows(db, 'ws-2'))[0]?.keyVersion).toBe(1);
    expect((await rows(db, 'ws-1'))[0]?.keyVersion).toBe(2);
  });
});
