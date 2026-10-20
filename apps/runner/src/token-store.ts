import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The runner's current credential, kept beside its spool so a restart can prove it is the
 * runner it says it is.
 *
 * Re-registering an existing runner id is a credential rotation, and the API only allows a
 * rotation against the token the runner already holds (`RUNNER_ID_TAKEN` otherwise). A process
 * that restarts holds nothing, so before this file a crash or a `docker compose restart` left
 * the runner unable to come back (ledger RNR-1).
 *
 * This covers a restart inside the token's lifetime, which the registration refresh keeps
 * short-dated but always ahead of the clock while the runner is up. It deliberately does not
 * widen who may rotate a credential: the token is proof of possession exactly as before, it is
 * only remembered across a restart. A runner down for longer than the token lives still has to
 * be given a new instance id.
 */
const FILE_NAME = 'runner-token.json';

interface StoredToken {
  runnerId: string;
  token: string;
}

/** The token last issued to `runnerId`, or `''` when there is none to present. */
export async function readStoredToken(directory: string, runnerId: string): Promise<string> {
  let raw: string;
  try {
    raw = await readFile(join(directory, FILE_NAME), 'utf8');
  } catch {
    return '';
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return '';
  }
  if (typeof parsed !== 'object' || parsed === null) return '';
  const stored = parsed as Partial<StoredToken>;
  if (stored.runnerId !== runnerId || typeof stored.token !== 'string') return '';
  return stored.token;
}

/** Replace the stored token. Written to a sibling and renamed, so a crash never leaves half a file. */
export async function writeStoredToken(
  directory: string,
  runnerId: string,
  token: string,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const target = join(directory, FILE_NAME);
  const staging = `${target}.${String(process.pid)}.tmp`;
  const body: StoredToken = { runnerId, token };
  await writeFile(staging, JSON.stringify(body), { encoding: 'utf8', mode: 0o600 });
  await rename(staging, target);
}
