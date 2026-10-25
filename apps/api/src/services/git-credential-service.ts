import { readVaultSecret, storeVaultSecret, type VaultOptions } from './vault-secrets.js';

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
 * envelope moved into another project's row does not open there. The sealing itself is
 * `vault-secrets.ts`, shared with the notification channels.
 */
function nameFor(projectId: string): string {
  return `git:${projectId}`;
}

const WHAT = 'A git token';

export async function storeGitToken(
  options: VaultOptions,
  projectId: string,
  token: string,
): Promise<void> {
  await storeVaultSecret(options, nameFor(projectId), token, WHAT);
}

/** The token, or `null` when the project has none — a public repository. */
export async function readGitToken(
  options: VaultOptions,
  projectId: string,
): Promise<string | null> {
  return readVaultSecret(options, nameFor(projectId), WHAT);
}
