import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { vaultEntries } from '@automate/db';
import { openSecret, sealSecret, type VaultEnvelope } from '../infrastructure/vault-crypto.js';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';

/**
 * One named secret per workspace in `vault_entries`, sealed and bound to its row.
 *
 * The one implementation of "store a credential" and "read it back": a project's git token
 * (`git:<projectId>`) and a notification channel's token or webhook (`channel:<id>`) are
 * both rows here. Each envelope is bound to its row by the vault's additional authenticated
 * data — entry id, workspace and name — so an envelope moved into another row, or another
 * workspace, does not open (`vault-crypto.test.ts`).
 */
export type VaultOptions = Pick<ProjectRegistryServiceOptions, 'db' | 'workspaceId'> & {
  vaultSecret?: string | undefined;
};

const PBKDF2_ITERATIONS = 100_000;

function requireVaultSecret(options: VaultOptions, what: string): string {
  if (options.vaultSecret === undefined || options.vaultSecret.length < 32) {
    throw new DomainError(
      ErrorCode.NOT_CONFIGURED,
      `${what} can only be stored once VAULT_SECRET is configured.`,
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
  const envelope = await sealSecret(value, secret, {
    entryId: id,
    workspaceId: options.workspaceId,
    name,
  });
  const now = new Date();
  const values = {
    ciphertext: envelope.ciphertext,
    iv: envelope.iv,
    authTag: envelope.tag,
    salt: envelope.salt,
    iterations: PBKDF2_ITERATIONS,
    updatedAt: now,
  };
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
}

/** The value under `name`, or `null` when there is none. */
export async function readVaultSecret(
  options: VaultOptions,
  name: string,
  what = 'A secret',
): Promise<string | null> {
  const [row] = await rowFor(options, name);
  if (row === undefined) return null;
  const envelope: VaultEnvelope = {
    version: 2,
    algorithm: 'aes-256-gcm',
    keyVersion: 1,
    salt: row.salt,
    iv: row.iv,
    tag: row.authTag,
    ciphertext: row.ciphertext,
  };
  return openSecret(envelope, requireVaultSecret(options, what), {
    entryId: row.id,
    workspaceId: options.workspaceId,
    name,
  });
}

/** Removes the value under `name`, if there is one. */
export async function deleteVaultSecret(options: VaultOptions, name: string): Promise<void> {
  await options.db
    .delete(vaultEntries)
    .where(
      and(eq(vaultEntries.workspaceId, options.workspaceId), eq(vaultEntries.connectorName, name)),
    );
}
