import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { vaultEntries } from '@automate/db';
import { openSecret, sealSecret, type VaultEnvelope } from '../infrastructure/vault-crypto.js';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';

/**
 * A project's git access token, sealed in the vault and handed only to the runner that holds
 * the job's lease.
 *
 * ## Never on the project row, never in a job's configuration
 *
 * A run's configuration is stored, listed and returned by the API; a token written there
 * would be readable by anyone who can read a run. So the job carries only the URL, and the
 * runner asks for the token over its own authenticated channel at the moment it clones —
 * see `GET /api/v1/jobs/:jobId/checkout`.
 *
 * One entry per project, under `git:<projectId>`, bound to its row by the vault's AAD so an
 * envelope moved into another project's row does not open there.
 */
type Options = Pick<ProjectRegistryServiceOptions, 'db' | 'workspaceId'> & {
  vaultSecret?: string | undefined;
};

const PBKDF2_ITERATIONS = 100_000;

function nameFor(projectId: string): string {
  return `git:${projectId}`;
}

function requireSecret(options: Options): string {
  if (options.vaultSecret === undefined || options.vaultSecret.length < 32) {
    throw new DomainError(
      ErrorCode.NOT_CONFIGURED,
      'A git token can only be stored once VAULT_SECRET is configured.',
    );
  }
  return options.vaultSecret;
}

export async function storeGitToken(
  options: Options,
  projectId: string,
  token: string,
): Promise<void> {
  const secret = requireSecret(options);
  const name = nameFor(projectId);
  const existing = await options.db
    .select({ id: vaultEntries.id })
    .from(vaultEntries)
    .where(
      and(eq(vaultEntries.workspaceId, options.workspaceId), eq(vaultEntries.connectorName, name)),
    )
    .limit(1);
  const id = existing[0]?.id ?? randomUUID();
  const envelope = await sealSecret(token, secret, {
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
  if (existing[0] === undefined) {
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

/** The token, or `null` when the project has none — a public repository. */
export async function readGitToken(options: Options, projectId: string): Promise<string | null> {
  const name = nameFor(projectId);
  const rows = await options.db
    .select()
    .from(vaultEntries)
    .where(
      and(eq(vaultEntries.workspaceId, options.workspaceId), eq(vaultEntries.connectorName, name)),
    )
    .limit(1);
  const row = rows[0];
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
  return openSecret(envelope, requireSecret(options), {
    entryId: row.id,
    workspaceId: options.workspaceId,
    name,
  });
}
