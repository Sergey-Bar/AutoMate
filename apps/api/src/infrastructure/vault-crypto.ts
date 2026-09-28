import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';

export interface VaultEnvelope {
  /**
   * `1` predates row binding and cannot be attributed to a row; `2` is sealed with the
   * row's identity as additional authenticated data.
   *
   * The version is the only thing that distinguishes them, which is why it is checked
   * before anything else: a v1 envelope has no AAD, so opening one with a row's identity
   * would be a claim the ciphertext cannot support. It is refused by name rather than
   * reported as a failed tag check, because the two need completely different responses.
   */
  version: 1 | 2;
  algorithm: 'aes-256-gcm';
  keyVersion: number;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

/**
 * The row an envelope belongs to.
 *
 * Sealing without this is what made the defect: the envelope carried no statement of
 * *which secret it was*, so any envelope could be written into any row and would open
 * there. A vault holding one credential per connector returned GitHub's secret when
 * asked for Jira's, and nothing failed (ledger P-8).
 */
export interface VaultRowBinding {
  entryId: string;
  workspaceId: string;
  name: string;
}

/**
 * Thrown for an envelope sealed before row binding existed.
 *
 * Distinct from a failed authentication check on purpose. A wrong AAD means the
 * ciphertext was moved or the caller asked for the wrong row, and there is nothing to
 * repair. A v1 envelope means the *data* is fine and merely unattributable, and the
 * response is to re-seal it in place — which is possible precisely because it was never
 * bound to anything.
 */
export class VaultRowUnboundError extends Error {
  constructor(readonly entryId: string) {
    super(
      `Vault entry ${entryId} holds a version 1 envelope, which predates row binding and ` +
        'so cannot be attributed to a row. It must be re-sealed in place before it can be ' +
        "used: read it with the legacy path, seal it again with this row's binding, and " +
        'write it back. Do not delete it and do not treat it as corrupt — the plaintext is intact.',
    );
    this.name = 'VaultRowUnboundError';
  }
}

/**
 * How many derived keys are held.
 *
 * The vault secret is per-installation and each envelope has its own salt, so the
 * working set is one entry per envelope the process has touched. Bounded because an
 * unbounded map keyed by salt is a slow memory leak with extra steps: every secret ever
 * opened would stay resident for the process's life.
 */
const KEY_CACHE_CAPACITY = 256;

const keyCache = new Map<string, Buffer>();

/** Derivation cost, as a function of the iteration count, for the test. */
function derive(secret: string, salt: string): Buffer {
  return pbkdf2Sync(secret, salt, 100_000, 32, 'sha256');
}

/**
 * The AES key for an envelope's salt, derived at most once per process.
 *
 * `pbkdf2Sync` at 100 000 SHA-256 iterations blocks the event loop for tens of
 * milliseconds. It sat directly on the request path — every vault read derived a
 * fresh key — so every read stalled every other request on a single-threaded
 * server, and the cost scaled with traffic rather than with the size of the
 * vault.
 *
 * Caching by `secret` and `salt` is exact, not an approximation: both are
 * required to reproduce the key, and both are already in hand. The entry is
 * dropped when the secret rotates, because a different secret is a different
 * cache key — so a rotation cannot be served a key derived from the old one.
 */
export function keyFor(secret: string, salt: string): Buffer {
  if (secret.length < 32) throw new Error('Vault secret must be at least 32 characters');
  const cacheKey = `${salt}:${secret.length}:${hashOf(secret)}`;
  const cached = keyCache.get(cacheKey);
  if (cached !== undefined) {
    // Re-insert so the map keeps insertion order and eviction drops the coldest.
    keyCache.delete(cacheKey);
    keyCache.set(cacheKey, cached);
    return cached;
  }
  const key = derive(secret, salt);
  keyCache.set(cacheKey, key);
  while (keyCache.size > KEY_CACHE_CAPACITY) {
    const coldest = keyCache.keys().next();
    if (coldest.done === true) break;
    keyCache.delete(coldest.value);
  }
  return key;
}

/**
 * A short fingerprint of the secret, so the cache key does not hold the secret
 * itself in memory a second time. A collision would let a rotation be served the
 * previous key, so this is wider than uniqueness strictly needs and narrow
 * enough to be free.
 */
function hashOf(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url').slice(0, 22);
}

/** Empties the cache. For a secret rotation, and for tests. */
export function clearKeyCache(): void {
  keyCache.clear();
}

/** Entries currently held, for the eviction test. */
export function keyCacheSize(): number {
  return keyCache.size;
}

/**
 * The additional authenticated data for a row.
 *
 * **Length-prefixed, and that is the whole design.** GCM authenticates the AAD without
 * reading it, so the only thing standing between two rows is whether their AAD strings
 * differ. A naive join — `workspaceId + name`, or the three fields separated by `:` —
 * collides: workspace `a` / name `b:c` and workspace `a:b` / name `c` produce the same
 * bytes, so one row's ciphertext would open in the other. Prefixing each field with its
 * byte length makes the encoding injective, which is the property the whole fix depends
 * on.
 *
 * @param binding the row the envelope belongs to
 * @returns the canonical AAD bytes
 */
export function aadFor(binding: VaultRowBinding): Buffer {
  const parts = [binding.entryId, binding.workspaceId, binding.name].map((field) => {
    const bytes = Buffer.from(field, 'utf8');
    return `${String(bytes.length)}:${bytes.toString('utf8')}`;
  });
  return Buffer.from(parts.join(''), 'utf8');
}

/**
 * Seal a secret, bound to the row that holds it.
 *
 * @param plaintext the secret
 * @param secret the installation vault secret
 * @param binding the row this envelope will live in — required, and not optional
 * @param keyVersion the vault key version, for rotation
 */
export function sealSecret(
  plaintext: string,
  secret: string,
  binding: VaultRowBinding,
  keyVersion = 1,
): VaultEnvelope {
  if (binding.entryId === '' || binding.workspaceId === '' || binding.name === '') {
    throw new Error('A vault envelope must be bound to a complete row identity');
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret, salt.toString('base64url')), iv);
  // Authenticated, and never encrypted: GCM covers the AAD without spending ciphertext
  // on it, so the row identity is guaranteed to be the row the ciphertext belongs to.
  // Authenticated, and never encrypted: GCM covers the AAD without spending ciphertext
  // on it, so the row identity is guaranteed to be the row the ciphertext belongs to.
  cipher.setAAD(aadFor(binding));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    version: 2,
    algorithm: 'aes-256-gcm',
    keyVersion,
    salt: salt.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
}

/**
 * Open a secret, proving the envelope belongs to the row being read.
 *
 * @param envelope the stored envelope
 * @param secret the installation vault secret
 * @param binding the row the envelope is expected to be in
 * @throws VaultRowUnboundError for a version 1 envelope, which cannot support the claim
 */
export function openSecret(
  envelope: VaultEnvelope,
  secret: string,
  binding: VaultRowBinding,
): string {
  if (envelope.version === 1) throw new VaultRowUnboundError(binding.entryId);
  if (envelope.version !== 2 || envelope.algorithm !== 'aes-256-gcm') {
    throw new Error('Unsupported vault envelope');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFor(secret, envelope.salt),
    Buffer.from(envelope.iv, 'base64url'),
  );
  decipher.setAAD(aadFor(binding));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Read a version 1 envelope, which predates row binding.
 *
 * Deliberately separate from {@link openSecret} and deliberately not a fallback inside
 * it. A caller that can silently fall back will do so, and then a bound vault is
 * weakened by an unbound path that nobody chose deliberately. This is for the repair
 * tool alone. It takes no row identity, because it cannot: a version 1 envelope has
 * none to take, and accepting one would be a claim the data does not support.
 *
 * @param envelope a version 1 envelope
 * @param secret the installation vault secret
 */
export function openLegacySecret(envelope: VaultEnvelope, secret: string): string {
  if (envelope.version !== 1) {
    throw new Error('openLegacySecret is for version 1 envelopes only; this one is bound');
  }
  if (envelope.algorithm !== 'aes-256-gcm') throw new Error('Unsupported vault envelope');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFor(secret, envelope.salt),
    Buffer.from(envelope.iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export interface SecretProvider {
  getSecret(reference: string, signal?: AbortSignal): Promise<string>;
}
