import { randomUUID } from 'node:crypto';
import { and, eq, max } from 'drizzle-orm';
import { vaultEntries, type VaultEntry } from '@automate/db';
import { openSecret, sealSecret, type VaultEnvelope } from '../infrastructure/vault-crypto.js';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { audit } from './access-service.js';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';

/**
 * One named secret per workspace in `vault_entries`, sealed and bound to its row.
 *
 * The one implementation of "store a credential" and "read it back": a project's git token
 * (`git:<projectId>`), a notification channel's token or webhook (`channel:<id>`) and a
 * project's issue tracker token (`tracker:<projectId>:<kind>`) are all rows here. Each
 * envelope is bound to its row by the vault's additional authenticated data — entry id,
 * workspace and name — so an envelope moved into another row, or another workspace, does not
 * open (`vault-crypto.test.ts`).
 *
 * ## Audited, and rotated in the database
 *
 * Every write and every removal is an `audit_events` row naming the entry and never its
 * value. `key_version` records the key generation each envelope was sealed under, and
 * {@link rotateVaultSecrets} re-seals a workspace's entries under a new secret in one
 * transaction — so a rotation either moves every entry or none, and a row always says which
 * generation opens it.
 */
export type VaultOptions = Pick<ProjectRegistryServiceOptions, 'db' | 'workspaceId'> & {
  vaultSecret?: string | undefined;
  /** Who is writing, for the audit row. Absent: `system`. */
  actor?: string;
};

const PBKDF2_ITERATIONS = 100_000;

function requireVaultSecret(options: VaultOptions, what: string): string {
  if (options.vaultSecret === undefined || options.vaultSecret.length < 32) {
    throw new DomainError(
      ErrorCode.NOT_CONFIGURED,
      `${what} can only be stored once VAULT_SECRET is configured.`,
      { callerSafe: true },
    );
  }
  return options.vaultSecret;
}

function rowFor(options: VaultOptions, name: string) {
  return options.db
    .select()
    .from(vaultEntries)
    .where(
      and(eq(vaultEntries.workspaceId, options.workspaceId), eq(vaultEntries.connectorName, name)),
    )
    .limit(1);
}

/** The workspace's current key generation: the highest any entry was sealed under, or 1. */
async function currentKeyVersion(options: VaultOptions): Promise<number> {
  const [row] = await options.db
    .select({ version: max(vaultEntries.keyVersion) })
    .from(vaultEntries)
    .where(eq(vaultEntries.workspaceId, options.workspaceId));
  return row?.version ?? 1;
}

function envelopeOf(row: VaultEntry): VaultEnvelope {
  return {
    version: 2,
    algorithm: 'aes-256-gcm',
    keyVersion: row.keyVersion,
    salt: row.salt,
    iv: row.iv,
    tag: row.authTag,
    ciphertext: row.ciphertext,
  };
}

function sealedColumns(envelope: VaultEnvelope, keyVersion: number, now: Date) {
  return {
    ciphertext: envelope.ciphertext,
    iv: envelope.iv,
    authTag: envelope.tag,
    salt: envelope.salt,
    iterations: PBKDF2_ITERATIONS,
    keyVersion,
    updatedAt: now,
  };
}

/**
 * Seals `value` under `name`, replacing any earlier value.
 *
 * @param what the credential, for the refusal when no vault secret is configured
 */
export async function storeVaultSecret(
  options: VaultOptions,
  name: string,
  value: string,
  what = 'A secret',
): Promise<void> {
  const secret = requireVaultSecret(options, what);
  const [existing] = await rowFor(options, name);
  const id = existing?.id ?? randomUUID();
  const keyVersion = await currentKeyVersion(options);
  const envelope = await sealSecret(
    value,
    secret,
    { entryId: id, workspaceId: options.workspaceId, name },
    keyVersion,
  );
  const now = new Date();
  const values = sealedColumns(envelope, keyVersion, now);
  if (existing === undefined) {
    await options.db.insert(vaultEntries).values({
      id,
      connectorName: name,
      workspaceId: options.workspaceId,
      createdAt: now,
      ...values,
    });
  } else {
    await options.db.update(vaultEntries).set(values).where(eq(vaultEntries.id, id));
  }
  await audit(options, {
    actor: options.actor ?? 'system',
    action: existing === undefined ? 'vault.secret.store' : 'vault.secret.replace',
    resourceType: 'vault_entry',
    resourceId: name,
    details: { keyVersion },
  });
}

/** The value under `name`, or `null` when there is none. */
export async function readVaultSecret(
  options: VaultOptions,
  name: string,
  what = 'A secret',
): Promise<string | null> {
  const [row] = await rowFor(options, name);
  if (row === undefined) return null;
  return openSecret(envelopeOf(row), requireVaultSecret(options, what), {
    entryId: row.id,
    workspaceId: options.workspaceId,
    name,
  });
}

/** Whether a value is stored under `name`, without opening it. */
export async function hasVaultSecret(options: VaultOptions, name: string): Promise<boolean> {
  const [row] = await rowFor(options, name);
  return row !== undefined;
}

/** Removes the value under `name`, if there is one. */
export async function deleteVaultSecret(options: VaultOptions, name: string): Promise<void> {
  const removed = await options.db
    .delete(vaultEntries)
    .where(
      and(eq(vaultEntries.workspaceId, options.workspaceId), eq(vaultEntries.connectorName, name)),
    )
    .returning({ id: vaultEntries.id });
  if (removed.length === 0) return;
  await audit(options, {
    actor: options.actor ?? 'system',
    action: 'vault.secret.delete',
    resourceType: 'vault_entry',
    resourceId: name,
  });
}

export interface VaultRotation {
  /** Entries re-sealed under the new secret by this call. */
  rotated: number;
  /** Entries that already opened under the new secret: a rotation that was finished before. */
  current: number;
  /** The generation every entry of the workspace is now sealed under. */
  keyVersion: number;
}

async function opens(row: VaultEntry, secret: string, workspaceId: string): Promise<string | null> {
  try {
    return await openSecret(envelopeOf(row), secret, {
      entryId: row.id,
      workspaceId,
      name: row.connectorName,
    });
  } catch {
    return null;
  }
}

/**
 * Re-seals every entry of the workspace from `previous` to `next`, in one transaction.
 *
 * An entry that already opens under `next` is left alone, so a rotation that is run again —
 * the API restarted with both secrets still set — changes nothing. An entry that opens under
 * neither stops the whole rotation with nothing written: half a vault on the new key and half
 * on a key nobody has is the one outcome a rotation must never leave behind.
 */
export async function rotateVaultSecrets(
  options: Pick<VaultOptions, 'db' | 'workspaceId' | 'actor'>,
  previous: string,
  next: string,
): Promise<VaultRotation> {
  if (previous.length < 32 || next.length < 32 || previous === next) {
    throw new DomainError(
      ErrorCode.INVALID_REQUEST,
      'A vault rotation needs two different secrets of at least 32 characters',
    );
  }
  const outcome = await options.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(vaultEntries)
      .where(eq(vaultEntries.workspaceId, options.workspaceId))
      .for('update');
    const generation = rows.reduce((highest, row) => Math.max(highest, row.keyVersion), 1);
    let rotated = 0;
    let current = 0;
    for (const row of rows) {
      if ((await opens(row, next, options.workspaceId)) !== null) {
        current += 1;
        continue;
      }
      const plaintext = await opens(row, previous, options.workspaceId);
      if (plaintext === null) {
        throw new DomainError(
          ErrorCode.CONFLICT,
          `Vault entry ${row.connectorName} opens under neither secret; nothing was rotated`,
        );
      }
      const envelope = await sealSecret(
        plaintext,
        next,
        { entryId: row.id, workspaceId: options.workspaceId, name: row.connectorName },
        generation + 1,
      );
      await tx
        .update(vaultEntries)
        .set(sealedColumns(envelope, generation + 1, new Date()))
        .where(eq(vaultEntries.id, row.id));
      rotated += 1;
    }
    return { rotated, current, keyVersion: rotated > 0 ? generation + 1 : generation };
  });
  if (outcome.rotated > 0) {
    await audit(options, {
      actor: options.actor ?? 'system',
      action: 'vault.rotate',
      resourceType: 'vault',
      resourceId: options.workspaceId,
      details: { ...outcome },
    });
  }
  return outcome;
}
