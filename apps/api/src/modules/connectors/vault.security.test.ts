/**
 * vault.security.test.ts — Vault Security E2E / API Tests
 *
 * Gaps filled (not covered by connectors.test.ts):
 *  1.  Auth enforcement — vault routes through the full app require AUTOMATE_API_KEY
 *  2.  Ciphertext inspection — storage NEVER contains plaintext
 *  3.  Wrong-key decryption — throws, does NOT leak plaintext
 *
 * Auth matrix (via full app):
 *  A1.  GET  /api/v1/vault/credentials          without auth  → 401
 *  A2.  GET  /api/v1/vault/credentials          wrong token   → 401
 *  A3.  GET  /api/v1/vault/credentials          valid token   → 200
 *  A4.  POST /api/v1/vault/credentials          without auth  → 401
 *  A5.  GET  /api/v1/vault/credentials/:id      without auth  → 401
 *  A6.  DELETE /api/v1/vault/credentials/:id    without auth  → 401
 *
 * Encryption unit tests (no HTTP):
 *  E1.  encryptValue output ≠ plaintext
 *  E2.  Encrypting same input twice → different ciphertexts (random IV + salt)
 *  E3.  encrypt → decrypt with correct key → original plaintext recovered
 *  E4.  decrypt with wrong key → throws (GCM auth-tag mismatch)
 *
 * Storage inspection:
 *  S1.  InMemoryVaultStore.store() with vaultSecret → encryptedValue ≠ plaintext
 *  S2.  list() returns no value / encryptedValue fields
 *  S3.  Internal record has all ciphertext blob fields (ct, iv, tag, salt, iter)
 *
 * HTTP redaction (full app, with auth):
 *  R1.  POST response has NO value or encryptedValue field
 *  R2.  GET /:id response has value === '[REDACTED]'
 *  R3.  GET /:id response serialised to string does NOT contain the original secret
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { app } from '../../index.js';
import {
  encryptValue,
  decryptValue,
  InMemoryVaultStore,
} from './vault.js';

// ---------------------------------------------------------------------------
// Evidence helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// apps/api/src/modules/connectors/ → 5 levels up → repo root
const REPO_ROOT = path.resolve(__dirname, '../../../../../');
const EVIDENCE_DIR = path.join(REPO_ROOT, '.sisyphus', 'evidence', 'production-readiness');

function saveEvidence(filename: string, content: string): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(path.join(EVIDENCE_DIR, filename), content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const TEST_API_KEY = 'test-vault-auth-key-32chars';
const TEST_VAULT_SECRET = 'test-vault-secret-for-security-test!!';
const PLAINTEXT = 'super-secret-value-123';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function jsonBody(res: Response): Promise<unknown> {
  return res.json();
}

async function postCredential(
  headers: Record<string, string> = {},
  value = PLAINTEXT,
): Promise<Response> {
  return app.request('/api/v1/vault/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ connectorId: 'test-connector', key: 'SECRET_KEY', value }),
  });
}

// ---------------------------------------------------------------------------
// A. Auth enforcement — vault routes through the full app
// ---------------------------------------------------------------------------

describe('Vault — auth enforcement via full app', () => {
  beforeEach(() => {
    process.env['AUTOMATE_API_KEY'] = TEST_API_KEY;
  });

  afterEach(() => {
    delete process.env['AUTOMATE_API_KEY'];
  });

  it('A1: GET /api/v1/vault/credentials returns 401 without auth', async () => {
    const res = await app.request('/api/v1/vault/credentials');
    expect(res.status).toBe(401);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['error']).toBe('Unauthorized');
  });

  it('A2: GET /api/v1/vault/credentials returns 401 with wrong token', async () => {
    const res = await app.request('/api/v1/vault/credentials', {
      headers: { Authorization: 'Bearer wrong-key-that-will-not-match' },
    });
    expect(res.status).toBe(401);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['error']).toBe('Unauthorized');
  });

  it('A3: GET /api/v1/vault/credentials returns 200 with valid auth', async () => {
    const res = await app.request('/api/v1/vault/credentials', {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    });
    expect(res.status).toBe(200);
    // Empty list is fine — we just need 200, not 401
    const body = await jsonBody(res);
    expect(Array.isArray(body)).toBe(true);
  });

  it('A4: POST /api/v1/vault/credentials returns 401 without auth', async () => {
    const res = await postCredential();
    expect(res.status).toBe(401);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['error']).toBe('Unauthorized');
  });

  it('A5: GET /api/v1/vault/credentials/:id returns 401 without auth', async () => {
    const res = await app.request('/api/v1/vault/credentials/any-id');
    expect(res.status).toBe(401);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['error']).toBe('Unauthorized');
  });

  it('A6: DELETE /api/v1/vault/credentials/:id returns 401 without auth', async () => {
    const res = await app.request('/api/v1/vault/credentials/any-id', {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['error']).toBe('Unauthorized');
  });
});

// ---------------------------------------------------------------------------
// E. Encryption unit tests — no HTTP involved
// ---------------------------------------------------------------------------

describe('Vault — AES-256-GCM encryption unit tests', () => {
  it('E1: encryptValue output is not equal to the plaintext', async () => {
    const encrypted = await encryptValue(TEST_VAULT_SECRET, PLAINTEXT);
    expect(encrypted).not.toBe(PLAINTEXT);
    expect(encrypted).not.toContain(PLAINTEXT);
  });

  it('E2: encrypting the same input twice produces different ciphertexts (random IV + salt)', async () => {
    const enc1 = await encryptValue(TEST_VAULT_SECRET, PLAINTEXT);
    const enc2 = await encryptValue(TEST_VAULT_SECRET, PLAINTEXT);
    expect(enc1).not.toBe(enc2);
    // Both are valid JSON blobs
    const blob1 = JSON.parse(enc1) as Record<string, unknown>;
    const blob2 = JSON.parse(enc2) as Record<string, unknown>;
    // IVs must differ
    expect(blob1['iv']).not.toBe(blob2['iv']);
    // Salts must differ
    expect(blob1['salt']).not.toBe(blob2['salt']);
  });

  it('E3: encrypt then decrypt with correct key recovers original plaintext', async () => {
    const encrypted = await encryptValue(TEST_VAULT_SECRET, PLAINTEXT);
    const decrypted = await decryptValue(TEST_VAULT_SECRET, encrypted);
    expect(decrypted).toBe(PLAINTEXT);
  });

  it('E4: decryptValue with wrong password throws (GCM auth-tag mismatch)', async () => {
    const encrypted = await encryptValue(TEST_VAULT_SECRET, PLAINTEXT);
    await expect(
      decryptValue('completely-wrong-password-that-is-not-the-key', encrypted),
    ).rejects.toThrow();
  });

  it('E4b: wrong-key throw does not produce plaintext as return value', async () => {
    const encrypted = await encryptValue(TEST_VAULT_SECRET, PLAINTEXT);
    let leaked: string | undefined;
    try {
      leaked = await decryptValue('definitely-wrong-key-for-this-test!!', encrypted);
    } catch {
      leaked = undefined;
    }
    // The function MUST throw — it must NOT silently return garbage or the original plaintext
    expect(leaked).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// S. Storage inspection — InMemoryVaultStore internal record
// ---------------------------------------------------------------------------

describe('Vault — storage inspection (InMemoryVaultStore)', () => {
  it('S1: stored encryptedValue is not equal to the plaintext', async () => {
    const store = new InMemoryVaultStore(TEST_VAULT_SECRET);
    await store.store({ connectorId: 'conn-1', key: 'API_KEY', value: PLAINTEXT });

    const records = store.list();
    expect(records).toHaveLength(1);
    const record = store.get(records[0]!.id)!;
    expect(record.encryptedValue).not.toBe(PLAINTEXT);
    expect(record.encryptedValue).not.toContain(PLAINTEXT);
  });

  it('S2: list() returns objects without value or encryptedValue fields', async () => {
    const store = new InMemoryVaultStore(TEST_VAULT_SECRET);
    await store.store({ connectorId: 'conn-1', key: 'API_KEY', value: PLAINTEXT });
    await store.store({ connectorId: 'conn-2', key: 'PASSWORD', value: 'another-secret-xyz' });

    const list = store.list();
    expect(list).toHaveLength(2);

    for (const item of list) {
      expect(item).not.toHaveProperty('value');
      expect(item).not.toHaveProperty('encryptedValue');
    }

    const listJson = JSON.stringify(list);
    expect(listJson).not.toContain(PLAINTEXT);
    expect(listJson).not.toContain('another-secret-xyz');
  });

  it('S3: internal record has all AES-256-GCM blob fields (ct, iv, tag, salt, iter)', async () => {
    const store = new InMemoryVaultStore(TEST_VAULT_SECRET);
    await store.store({ connectorId: 'conn-1', key: 'SECRET', value: PLAINTEXT });

    const record = store.get(store.list()[0]!.id)!;
    const blob = JSON.parse(record.encryptedValue) as Record<string, unknown>;

    expect(blob).toHaveProperty('ct');
    expect(blob).toHaveProperty('iv');
    expect(blob).toHaveProperty('tag');
    expect(blob).toHaveProperty('salt');
    expect(blob).toHaveProperty('iter', 100_000);

    // All string fields are base64 (non-empty)
    expect(typeof blob['ct']).toBe('string');
    expect(typeof blob['iv']).toBe('string');
    expect(typeof blob['tag']).toBe('string');
    expect(typeof blob['salt']).toBe('string');
    expect((blob['ct'] as string).length).toBeGreaterThan(0);
  });

  it('S3b: dev-mode fallback (no vaultSecret) uses plain: prefix', async () => {
    const store = new InMemoryVaultStore(); // no secret → dev mode
    await store.store({ connectorId: 'conn-1', key: 'DEV_KEY', value: 'dev-secret' });

    const record = store.get(store.list()[0]!.id)!;
    expect(record.encryptedValue).toBe('plain:dev-secret');
  });
});

// ---------------------------------------------------------------------------
// R. HTTP redaction — through full app with valid auth
// ---------------------------------------------------------------------------

describe('Vault — HTTP redaction (full app with auth)', () => {
  beforeEach(() => {
    process.env['AUTOMATE_API_KEY'] = TEST_API_KEY;
  });

  afterEach(() => {
    delete process.env['AUTOMATE_API_KEY'];
  });

  const AUTH = { Authorization: `Bearer ${TEST_API_KEY}` };

  it('R1: POST /api/v1/vault/credentials response has no value or encryptedValue field', async () => {
    const res = await postCredential(AUTH);
    expect(res.status).toBe(201);

    const responseText = await res.text();
    expect(responseText).not.toContain(PLAINTEXT);

    const body = JSON.parse(responseText) as Record<string, unknown>;
    expect(body).not.toHaveProperty('value');
    expect(body).not.toHaveProperty('encryptedValue');
    // Must have metadata fields
    expect(typeof body['id']).toBe('string');
    expect(body['key']).toBe('SECRET_KEY');
  });

  it('R2: GET /api/v1/vault/credentials/:id response has value === "[REDACTED]"', async () => {
    // Store first
    const createRes = await postCredential(AUTH);
    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as { id: string };

    // Fetch single credential
    const res = await app.request(`/api/v1/vault/credentials/${id}`, {
      headers: AUTH,
    });
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['value']).toBe('[REDACTED]');
    expect(body).not.toHaveProperty('encryptedValue');
  });

  it('R3: GET /:id response serialised to string does NOT contain the original secret', async () => {
    const createRes = await postCredential(AUTH, PLAINTEXT);
    const { id } = (await createRes.json()) as { id: string };

    const res = await app.request(`/api/v1/vault/credentials/${id}`, {
      headers: AUTH,
    });
    const responseText = await res.text();

    expect(responseText).not.toContain(PLAINTEXT);
    expect(responseText).not.toContain('super-secret-value-123');

    // Verify the sentinel is in the response
    expect(responseText).toContain('[REDACTED]');

    // --- Save evidence ---
    const body = JSON.parse(responseText) as Record<string, unknown>;
    const evidence = [
      'Task-32 Vault Security Evidence — HTTP Redaction',
      '=================================================',
      '',
      'Scenario: GET /api/v1/vault/credentials/:id with valid auth',
      `Stored plaintext: ${PLAINTEXT}`,
      `HTTP response body: ${JSON.stringify(body, null, 2)}`,
      '',
      'Proofs:',
      `  1. response.value === "[REDACTED]": ${body['value'] === '[REDACTED]'}`,
      `  2. responseText.includes(PLAINTEXT): ${responseText.includes(PLAINTEXT)}`,
      `  3. "encryptedValue" absent from response: ${!Object.hasOwn(body, 'encryptedValue')}`,
      '',
      `Generated: ${new Date().toISOString()}`,
    ].join('\n');
    saveEvidence('task-32-vault-security.txt', evidence);
  });
});

// ---------------------------------------------------------------------------
// Combined negative test — save negative evidence
// ---------------------------------------------------------------------------

describe('Vault — negative / wrong-key evidence', () => {
  it('saves wrong-key decryption evidence', async () => {
    const encrypted = await encryptValue(TEST_VAULT_SECRET, PLAINTEXT);

    let threwWithMessage = '';
    try {
      await decryptValue('wrong-key-for-negative-test!!!!!', encrypted);
    } catch (err: unknown) {
      threwWithMessage = (err as Error).message ?? 'Error thrown (no message)';
    }

    expect(threwWithMessage).not.toBe('');

    const evidence = [
      'Task-32 Vault Security Evidence — Wrong-Key Failure',
      '====================================================',
      '',
      'Scenario: AES-256-GCM decryption with incorrect password',
      `Input plaintext: ${PLAINTEXT}`,
      `Encrypted blob fields: ct, iv, tag, salt, iter (AES-256-GCM + PBKDF2/100000)`,
      '',
      'Proofs:',
      `  1. decryptValue with wrong key threw: true`,
      `  2. Error message: "${threwWithMessage}"`,
      `  3. No plaintext was returned — the function threw before returning`,
      '',
      `Generated: ${new Date().toISOString()}`,
    ].join('\n');
    saveEvidence('task-32-vault-negative.txt', evidence);
  });
});
