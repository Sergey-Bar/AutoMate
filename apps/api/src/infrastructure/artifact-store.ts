import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface StoredArtifact {
  id: string;
  key: string;
  contentType: string;
  byteSize: number;
  digest: string;
  retention: 'standard' | 'quarantine' | 'legal_hold';
}

function resolveArtifactPath(root: string, key: string): string {
  if (path.isAbsolute(key) || key.includes('..') || key.includes('\\'))
    throw new Error('Artifact key must be relative');
  const target = path.resolve(root, key);
  if (!target.startsWith(path.resolve(root) + path.sep))
    throw new Error('Artifact path escapes root');
  return target;
}

/** Retries for the publish step only; each attempt re-checks the error kind. */
const RENAME_ATTEMPTS = 5;
const RENAME_BACKOFF_MS = 5;

/**
 * Windows returns a transient `EPERM`/`EBUSY` when a rename races another
 * rename onto the same destination, so a single attempt would drop a real
 * artifact. The retry is bounded: a genuinely unusable destination (a
 * directory, for instance) still fails, which the leak test asserts.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const transient = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      if (!transient || attempt >= RENAME_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, RENAME_BACKOFF_MS * attempt));
    }
  }
}

/**
 * Writes through a unique temporary name and renames into place.
 *
 * A shared `${target}.tmp` meant two concurrent `putAt` calls for the same key
 * interleaved their writes: the loser's rename published a half-written
 * artifact as if it were complete. The temporary is removed if the write fails
 * so a partial file is never left behind.
 */
async function writeAtomically(target: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { mode: 0o600 });
    await renameWithRetry(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export class LocalArtifactStore {
  constructor(private readonly root: string) {}

  async putAt(key: string, bytes: Uint8Array): Promise<void> {
    if (path.isAbsolute(key) || key.includes('..') || key.includes('\\'))
      throw new Error('Artifact key must be relative');
    await writeAtomically(resolveArtifactPath(this.root, key), bytes);
  }

  async readAt(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(resolveArtifactPath(this.root, key)));
  }

  /**
   * Removes the bytes at a key, tolerating an absent one.
   *
   * Idempotent on purpose: this is the compensating half of an artifact write, so it
   * runs on a path where "already gone" is a success and an `ENOENT` surfacing as a
   * failure would turn a cleaned-up write into a 500.
   */
  async removeAt(key: string): Promise<void> {
    await unlink(resolveArtifactPath(this.root, key)).catch((failure: unknown) => {
      const code = (failure as NodeJS.ErrnoException | null)?.code;
      if (code !== 'ENOENT') throw failure;
    });
  }

  async put(input: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
    retention?: StoredArtifact['retention'];
  }): Promise<StoredArtifact> {
    if (path.isAbsolute(input.key) || input.key.includes('..') || input.key.includes('\\'))
      throw new Error('Artifact key must be relative');
    const id = randomUUID();
    const key = `${id}/${input.key}`;
    await writeAtomically(resolveArtifactPath(this.root, key), input.bytes);
    return {
      id,
      key,
      contentType: input.contentType,
      byteSize: input.bytes.byteLength,
      digest: createHash('sha256').update(input.bytes).digest('hex'),
      retention: input.retention ?? 'standard',
    };
  }

  async read(artifact: StoredArtifact): Promise<Uint8Array> {
    const bytes = await readFile(resolveArtifactPath(this.root, artifact.key));
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== artifact.digest) throw new Error('Artifact digest mismatch');
    return bytes;
  }
}

export interface ArtifactBytesStore {
  put(storageKey: string, bytes: Uint8Array): Promise<void>;
  /**
   * The bytes, or `null` when the key is genuinely absent.
   *
   * `null` means "not there" and nothing else. A caller turns `null` into a 404,
   * so returning it for a permissions error, a full disk or a corrupt file
   * reported a storage fault as a missing artifact — the one response that tells
   * the caller to stop asking and tells nobody to go and look.
   */
  get(storageKey: string): Promise<Uint8Array | null>;
  /**
   * Removes the bytes, and resolves when the key is already gone.
   *
   * This exists for the compensating half of `addArtifact`. The bytes are written
   * before the row that references them, because the row needs the checksum and the
   * size — which are only knowable once the bytes exist. So a failure between the
   * two left an object nothing pointed at and nothing could remove, and the store's
   * memory bound counted it against the budget for the life of the process. A
   * `delete` the port cannot express is a compensation that cannot be written, so
   * the port grew the method.
   *
   * It must be idempotent: compensation runs on the failure path, where a second
   * attempt has to be safe.
   */
  delete(storageKey: string): Promise<void>;
}

export class LocalArtifactBytesStore implements ArtifactBytesStore {
  constructor(private readonly store: LocalArtifactStore) {}

  async put(storageKey: string, bytes: Uint8Array): Promise<void> {
    await this.store.putAt(storageKey, bytes);
  }

  async get(storageKey: string): Promise<Uint8Array | null> {
    try {
      return await this.store.readAt(storageKey);
    } catch (failure) {
      // Only "the file is not there" is a miss. Everything else is a fault, and it
      // propagates so the boundary can log it and answer 503.
      const code = (failure as NodeJS.ErrnoException | null)?.code;
      if (code === 'ENOENT') return null;
      throw failure;
    }
  }

  async delete(storageKey: string): Promise<void> {
    await this.store.removeAt(storageKey);
  }
}

export class FallbackArtifactBytesStore implements ArtifactBytesStore {
  constructor(
    private readonly primary: ArtifactBytesStore,
    private readonly fallback: ArtifactBytesStore,
    private readonly onFallback?: (storageKey: string) => void,
  ) {}

  async put(storageKey: string, bytes: Uint8Array): Promise<void> {
    await this.primary.put(storageKey, bytes);
  }

  async get(storageKey: string): Promise<Uint8Array | null> {
    const primary = await this.primary.get(storageKey);
    if (primary !== null) return primary;
    this.onFallback?.(storageKey);
    return this.fallback.get(storageKey);
  }

  /**
   * Deletes from **both**.
   *
   * `put` only writes the primary, so deleting only the primary would be correct
   * today. Deleting both is what makes the compensating call safe if a future write
   * falls back to the secondary: a cleanup that silently misses the tier holding
   * the bytes is a cleanup that leaves the orphan in place.
   */
  async delete(storageKey: string): Promise<void> {
    await this.primary.delete(storageKey);
    await this.fallback.delete(storageKey);
  }
}
