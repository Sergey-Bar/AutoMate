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

/**
 * The largest artifact any store will hand back, in bytes.
 *
 * One number for every tier. The object store already refused anything above 64 MB
 * and the local store refused nothing at all, which meant the same artifact was a
 * stored object on one deployment and an unbounded allocation on the next, decided by
 * configuration rather than by the artifact. The upload body limiter uses this same
 * value, so an artifact the API accepted can always be read back.
 */
export const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;

/** The digest every store compares against when the caller knows what it expected. */
export const DIGEST_MISMATCH = 'Artifact digest mismatch';

function digestOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
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
  constructor(
    private readonly root: string,
    /** The read bound, injectable so a test can assert the check without 64 MB of I/O. */
    readonly maxBytes: number = MAX_ARTIFACT_BYTES,
  ) {}

  async putAt(key: string, bytes: Uint8Array): Promise<void> {
    if (path.isAbsolute(key) || key.includes('..') || key.includes('\\'))
      throw new Error('Artifact key must be relative');
    await writeAtomically(resolveArtifactPath(this.root, key), bytes);
  }

  /**
   * The live reader: bounded, and verified when the caller knows the expected digest.
   *
   * Both checks used to live somewhere else. The bound was absent here, so this read
   * was unbounded while the object-store tier refused anything above 64 MB; the digest
   * comparison lived on `read`, which nothing in production called. The verification
   * is optional because only the caller holding the artifact row knows the digest —
   * a check that could not be given the digest is a check that cannot run.
   */
  async readAt(key: string, expectedDigest?: string): Promise<Uint8Array> {
    const bytes = await readFile(resolveArtifactPath(this.root, key));
    if (bytes.byteLength > this.maxBytes) {
      throw new Error(
        `Artifact is ${bytes.byteLength} bytes, above the ${this.maxBytes}-byte local artifact store limit`,
      );
    }
    if (expectedDigest !== undefined && digestOf(bytes) !== expectedDigest) {
      throw new Error(DIGEST_MISMATCH);
    }
    return new Uint8Array(bytes);
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
      digest: digestOf(input.bytes),
      retention: input.retention ?? 'standard',
    };
  }

  /**
   * Reads by descriptor, so the row's own digest is the one checked.
   *
   * Delegates rather than hashing again: the comparison has one implementation, and
   * this method differs from `readAt` only in that it already holds the digest.
   */
  async read(artifact: StoredArtifact): Promise<Uint8Array> {
    return this.readAt(artifact.key, artifact.digest);
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
   *
   * `expectedDigest` is the sha256 the artifact row recorded. Supply it wherever a
   * row is in hand: the bytes are evidence, and a store that returns whatever is
   * there hands a truncated or rewritten object back as a passing artifact. The
   * store cannot do this on its own, which is why it is the caller's to pass.
   */
  get(storageKey: string, expectedDigest?: string): Promise<Uint8Array | null>;
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

  async get(storageKey: string, expectedDigest?: string): Promise<Uint8Array | null> {
    try {
      return await this.store.readAt(storageKey, expectedDigest);
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

  async get(storageKey: string, expectedDigest?: string): Promise<Uint8Array | null> {
    const primary = await this.primary.get(storageKey, expectedDigest);
    if (primary !== null) return primary;
    this.onFallback?.(storageKey);
    return this.fallback.get(storageKey, expectedDigest);
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
