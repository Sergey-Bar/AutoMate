import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SESSION_MAX_AGE_MS } from '../constants.js';

const CONFIG_PATH = path.resolve(process.cwd(), '.automate', 'auth.json');

export const SESSION_COOKIE_NAME = 'automate_dashboard_session';

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AuthConfig {
  keys: ApiKey[];
  enabled: boolean;
}

const DEFAULT_AUTH_CONFIG: AuthConfig = {
  keys: [],
  enabled: false,
};

// TODO: Consider caching config in memory with file-watcher invalidation to avoid sync I/O per request
export function loadAuthConfig(): AuthConfig {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return { ...DEFAULT_AUTH_CONFIG, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_AUTH_CONFIG;
    }
  }
  return DEFAULT_AUTH_CONFIG;
}

export function saveAuthConfig(config: AuthConfig): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export function generateApiKey(name: string): ApiKey {
  return {
    id: crypto.randomUUID(),
    name,
    key: crypto.randomBytes(32).toString('hex'),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
}

export function validateApiKey(key: string): boolean {
  const config = loadAuthConfig();
  const keyBuffer = Buffer.from(key);
  const matched = config.keys.find((k) => {
    const storedBuffer = Buffer.from(k.key);
    if (keyBuffer.length !== storedBuffer.length) return false;
    return crypto.timingSafeEqual(keyBuffer, storedBuffer);
  });
  if (!matched) {
    return false;
  }

  matched.lastUsedAt = new Date().toISOString();
  saveAuthConfig(config);
  return true;
}

export function revokeApiKey(id: string): boolean {
  const config = loadAuthConfig();
  const nextKeys = config.keys.filter((k) => k.id !== id);
  if (nextKeys.length === config.keys.length) {
    return false;
  }

  saveAuthConfig({ ...config, keys: nextKeys });
  return true;
}

export function listApiKeys(): Array<Omit<ApiKey, 'key'> & { keyPreview: string }> {
  const config = loadAuthConfig();
  return config.keys.map(({ key, ...rest }) => ({
    ...rest,
    keyPreview: `${key.slice(0, 8)}...`,
  }));
}

export function getCookieSecret(): string {
  const secret = process.env.COOKIE_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('COOKIE_SECRET environment variable is required in production');
  }
  return secret ?? 'automate-dev-secret';
}

export function generateSessionToken(keyId: string): string {
  const timestamp = Date.now();
  const payload = `${keyId}:${timestamp}`;
  const signature = crypto
    .createHmac('sha256', getCookieSecret())
    .update(payload)
    .digest('hex');
  return `${payload}:${signature}`;
}

export function validateSessionToken(token: string): boolean {
  const [keyId, timestampRaw, signature] = token.split(':');
  if (!keyId || !timestampRaw || !signature) {
    return false;
  }

  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  const age = Date.now() - timestamp;
  if (age < 0 || age > SESSION_MAX_AGE_MS) {
    return false;
  }

  const payload = `${keyId}:${timestampRaw}`;
  const expectedSignature = crypto
    .createHmac('sha256', getCookieSecret())
    .update(payload)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature);
  const providedBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  if (!crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return false;
  }

  const config = loadAuthConfig();
  return config.keys.some((key) => key.id === keyId);
}

/**
 * Async variant of validateSessionToken that additionally checks the DB users
 * table. Required for SSO sessions where the session keyId is a user UUID from
 * the users table rather than a file-backed API key ID.
 *
 * Verification order:
 *  1. Signature and expiry (same as sync version)
 *  2. File-config API keys (existing behaviour — covers API key sessions)
 *  3. DB users table lookup (covers SSO user sessions)
 */
export async function validateSessionTokenAsync(token: string): Promise<boolean> {
  const parts = token.split(':');
  if (parts.length < 3) return false;
  // Token format: keyId:timestamp:signature
  // keyId is a UUID (no colons), timestamp is numeric, signature is hex (no colons)
  const [keyId, timestampRaw, signature] = parts;
  if (!keyId || !timestampRaw || !signature) return false;

  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) return false;

  const age = Date.now() - timestamp;
  if (age < 0 || age > SESSION_MAX_AGE_MS) return false;

  const payload = `${keyId}:${timestampRaw}`;
  const expectedSignature = crypto
    .createHmac('sha256', getCookieSecret())
    .update(payload)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature);
  const providedBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  if (!crypto.timingSafeEqual(expectedBuffer, providedBuffer)) return false;

  // 1. File-config API keys (backward compat)
  const config = loadAuthConfig();
  if (config.keys.some((key) => key.id === keyId)) return true;

  // 2. DB users table (SSO sessions)
  try {
    const [{ db }, { users }, { eq }] = await Promise.all([
      import('../db/client.js'),
      import('../db/schema.js'),
      import('drizzle-orm'),
    ]);
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.id, keyId)).limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

