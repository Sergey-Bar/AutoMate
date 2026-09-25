/**
 * vault.ts — Vault store with real AES-256-GCM + PBKDF2 encryption
 *
 * GET    /api/v1/vault/credentials        — list credential metadata (NEVER return values)
 * POST   /api/v1/vault/credentials        — store a credential (accept plaintext, store encrypted)
 * GET    /api/v1/vault/credentials/:id    — return metadata only, value shows "[REDACTED]"
 * DELETE /api/v1/vault/credentials/:id    — remove credential
 *
 * Security contract: credential values NEVER appear in any HTTP response.
 * Encryption: AES-256-GCM with PBKDF2 key derivation (100,000 iterations, SHA-256).
 * Dev fallback: when no VAULT_SECRET is provided, stores with "plain:" prefix (dev only).
 */
import { Hono } from 'hono';
import { createCipheriv, createDecipheriv, pbkdf2, randomBytes, randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface CredentialRecord {
  id: string;
  connectorId: string;
  key: string;
  /** AES-256-GCM encrypted value — NEVER expose in responses */
  encryptedValue: string;
  createdAt: string; // ISO-8601
}

/** Safe projection — excludes encryptedValue */
export interface CredentialMetadata {
  id: string;
  connectorId: string;
  key: string;
  createdAt: string;
}

/** Response shape for GET /api/v1/vault/credentials/:id — value is always redacted */
export interface CredentialResponse extends CredentialMetadata {
  value: '[REDACTED]';
}

// ---------------------------------------------------------------------------
// Real AES-256-GCM + PBKDF2 encryption
// ---------------------------------------------------------------------------

interface EncryptedBlob {
  ct: string;   // ciphertext base64
  iv: string;   // 12 random bytes base64
  tag: string;  // auth tag base64
  salt: string; // 16 random bytes base64
  iter: number; // 100_000
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, 100_000, 32, 'sha256', (err, key) => {
      if (err) reject(err); else resolve(key);
    });
  });
}

export async function encryptValue(password: string, plaintext: string): Promise<string> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob: EncryptedBlob = {
    ct: ct.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    salt: salt.toString('base64'),
    iter: 100_000,
  };
  return JSON.stringify(blob);
}

export async function decryptValue(password: string, stored: string): Promise<string> {
  const blob = JSON.parse(stored) as EncryptedBlob;
  const key = await deriveKey(password, Buffer.from(blob.salt, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(blob.ct, 'base64')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}

// ---------------------------------------------------------------------------
// Vault interface + in-memory implementation
// ---------------------------------------------------------------------------

export interface VaultStore {
  list(): CredentialMetadata[];
  get(id: string): CredentialRecord | undefined;
  store(input: { connectorId: string; key: string; value: string }): Promise<CredentialMetadata>;
  remove(id: string): boolean;
}

export class InMemoryVaultStore implements VaultStore {
  private readonly _credentials = new Map<string, CredentialRecord>();
  private readonly _vaultSecret: string | undefined;

  constructor(vaultSecret?: string) {
    this._vaultSecret = vaultSecret;
  }

  list(): CredentialMetadata[] {
    return Array.from(this._credentials.values()).map(({ id, connectorId, key, createdAt }) => ({
      id,
      connectorId,
      key,
      createdAt,
    }));
  }

  get(id: string): CredentialRecord | undefined {
    return this._credentials.get(id);
  }

  async store(input: { connectorId: string; key: string; value: string }): Promise<CredentialMetadata> {
    const id = randomUUID();
    const encryptedValue = this._vaultSecret
      ? await encryptValue(this._vaultSecret, input.value)
      : `plain:${input.value}`;

    const record: CredentialRecord = {
      id,
      connectorId: input.connectorId,
      key: input.key,
      encryptedValue,
      createdAt: new Date().toISOString(),
    };
    this._credentials.set(id, record);
    // Return only metadata — never the encrypted value
    return { id, connectorId: input.connectorId, key: input.key, createdAt: record.createdAt };
  }

  remove(id: string): boolean {
    return this._credentials.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Options + route factory
// ---------------------------------------------------------------------------

export interface VaultRouteOptions {
  store: VaultStore;
}

export function createVaultRoutes(options: VaultRouteOptions): Hono {
  const app = new Hono();

  // ── GET /api/v1/vault/credentials ────────────────────────────────────────
  // Returns metadata only — values are NEVER included
  app.get('/api/v1/vault/credentials', (c) => {
    return c.json(options.store.list());
  });

  // ── POST /api/v1/vault/credentials ───────────────────────────────────────
  // Accepts plaintext value, stores encrypted, returns metadata only
  app.post('/api/v1/vault/credentials', async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const { connectorId, key, value } = body;

    if (typeof connectorId !== 'string' || !connectorId.trim()) {
      return c.json({ error: 'connectorId is required' }, 400);
    }
    if (typeof key !== 'string' || !key.trim()) {
      return c.json({ error: 'key is required' }, 400);
    }
    if (typeof value !== 'string' || !value) {
      return c.json({ error: 'value is required' }, 400);
    }

    const metadata = await options.store.store({
      connectorId: connectorId.trim(),
      key: key.trim(),
      value,
    });

    // 201 Created — metadata only, never the value
    return c.json(metadata, 201);
  });

  // ── GET /api/v1/vault/credentials/:id ────────────────────────────────────
  // Returns metadata + explicit [REDACTED] sentinel for the value field
  app.get('/api/v1/vault/credentials/:id', (c) => {
    const id = c.req.param('id');
    const record = options.store.get(id);

    if (!record) {
      return c.json({ error: 'Credential not found' }, 404);
    }

    const response: CredentialResponse = {
      id: record.id,
      connectorId: record.connectorId,
      key: record.key,
      createdAt: record.createdAt,
      value: '[REDACTED]',
    };

    return c.json(response);
  });

  // ── DELETE /api/v1/vault/credentials/:id ─────────────────────────────────
  app.delete('/api/v1/vault/credentials/:id', (c) => {
    const id = c.req.param('id');
    const removed = options.store.remove(id);
    if (!removed) {
      return c.json({ error: 'Credential not found' }, 404);
    }
    return c.json({ removed: true });
  });

  return app;
}
