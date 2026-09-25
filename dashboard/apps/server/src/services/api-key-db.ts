/**
 * api-key-db.ts — DB-backed API key service with dual-read migration support.
 *
 * Keys are stored as SHA-256 hashes; plaintext is never written to the DB.
 * Dual-read: DB lookup first → file-based auth.json fallback.
 *
 * Feature flag 'rbac' gates the migration endpoint (see routes/auth.ts).
 */
import crypto from 'node:crypto';
import { db } from '../db/client.js';
import { apiKeys } from '../db/schema.js';
import { isNull, eq } from 'drizzle-orm';
import { loadAuthConfig, validateApiKey } from './auth.js';

/**
 * Hash an API key with SHA-256. Returns 64-char hex string.
 * Used for DB storage — never store plaintext keys.
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Validate an API key against DB-stored hashes (active keys only).
 * Uses timing-safe comparison to prevent timing attacks.
 */
export async function validateApiKeyFromDb(key: string): Promise<boolean> {
  const hash = hashApiKey(key);
  const hashBuffer = Buffer.from(hash);

  const rows = await db
    .select({ keyHash: apiKeys.keyHash })
    .from(apiKeys)
    .where(isNull(apiKeys.revokedAt));

  for (const row of rows) {
    const storedBuffer = Buffer.from(row.keyHash);
    if (hashBuffer.length !== storedBuffer.length) continue;
    if (crypto.timingSafeEqual(hashBuffer, storedBuffer)) {
      return true;
    }
  }
  return false;
}

/**
 * Dual-read: check DB first, fall back to file-backed auth.json.
 * Additive — never breaks existing file-based auth.
 */
export async function validateApiKeyDualRead(key: string): Promise<boolean> {
  const inDb = await validateApiKeyFromDb(key);
  if (inDb) return true;
  return validateApiKey(key);
}

/**
 * Create a new API key in the database.
 * Generates a random key, stores its SHA-256 hash, and returns the plaintext key once.
 */
export async function createApiKeyInDb(name: string): Promise<{
  id: string;
  name: string;
  key: string;
  createdAt: string;
  lastUsedAt: string | null;
}> {
  const id = crypto.randomUUID();
  const key = crypto.randomBytes(32).toString('hex');
  const hash = hashApiKey(key);
  const createdAt = new Date().toISOString();

  await db.insert(apiKeys).values({
    id,
    name,
    keyHash: hash,
    userId: null,
    role: 'admin',
    scopes: null,
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    tenantId: null,
    createdAt,
  });

  return { id, name, key, createdAt, lastUsedAt: null };
}

/**
 * Migrate all keys from auth.json to DB.
 * Idempotent — skips keys already in DB by ID.
 * Returns count of newly migrated keys.
 */
export async function migrateFileKeysToDb(): Promise<number> {
  const config = loadAuthConfig();
  let migrated = 0;

  for (const fileKey of config.keys) {
    const existing = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(eq(apiKeys.id, fileKey.id));

    if (existing.length > 0) continue;

    const hash = hashApiKey(fileKey.key);
    await db.insert(apiKeys).values({
      id: fileKey.id,
      name: fileKey.name,
      keyHash: hash,
      userId: null,
      role: 'admin',
      scopes: null,
      lastUsedAt: fileKey.lastUsedAt,
      expiresAt: null,
      revokedAt: null,
      tenantId: null,
      createdAt: fileKey.createdAt,
    });
    migrated++;
  }

  return migrated;
}
