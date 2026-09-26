import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';

export interface VaultEnvelope {
  version: 1;
  algorithm: 'aes-256-gcm';
  keyVersion: number;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

/**
 * How many derived keys are held.
 *
 * The vault secret is per-installation and each envelope has its own salt, so
 * the working set is one entry per envelope the process has touched. Bounded
 * because an unbounded map keyed by salt is a slow memory leak with extra
 * steps: every secret ever opened would stay resident for the process's life.
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

export function sealSecret(plaintext: string, secret: string, keyVersion = 1): VaultEnvelope {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret, salt.toString('base64url')), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    keyVersion,
    salt: salt.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
}

export function openSecret(envelope: VaultEnvelope, secret: string): string {
  if (envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm')
    throw new Error('Unsupported vault envelope');
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
