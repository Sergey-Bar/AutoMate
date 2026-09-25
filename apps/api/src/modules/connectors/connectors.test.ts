/**
 * connectors.test.ts — Comprehensive tests for the connectors module
 *
 * Covers:
 *  Registry:
 *   1.  GET /api/v1/connectors — returns empty list initially
 *   2.  POST /api/v1/connectors — registers a connector, returns 201 with id
 *   3.  POST /api/v1/connectors — 400 when name is missing
 *   4.  POST /api/v1/connectors — 400 when type is invalid
 *   5.  POST /api/v1/connectors — 400 when type is missing
 *   6.  GET /api/v1/connectors — lists registered connectors
 *   7.  GET /api/v1/connectors/:id/health — returns health for configured connector
 *   8.  GET /api/v1/connectors/:id/health — returns 'not_configured' health
 *   9.  GET /api/v1/connectors/:id/health — 404 for unknown connector
 *  10.  GET /api/v1/connectors/:id/health — health result contains no credentials
 *  11.  DELETE /api/v1/connectors/:id — removes connector
 *  12.  DELETE /api/v1/connectors/:id — 404 for unknown id
 *  13.  Connector has all expected fields (id, name, type, status, createdAt)
 *  14.  All valid connector types accepted (github, jira, slack, sql)
 *
 *  Vault:
 *  15.  GET /api/v1/vault/credentials — returns empty list initially
 *  16.  POST /api/v1/vault/credentials — stores credential, returns 201 metadata only
 *  17.  POST /api/v1/vault/credentials — 400 when connectorId missing
 *  18.  POST /api/v1/vault/credentials — 400 when key missing
 *  19.  POST /api/v1/vault/credentials — 400 when value missing
 *  20.  GET /api/v1/vault/credentials — list never contains plaintext values
 *  21.  GET /api/v1/vault/credentials/:id — returns metadata with [REDACTED] value
 *  22.  GET /api/v1/vault/credentials/:id — 404 for unknown id
 *  23.  DELETE /api/v1/vault/credentials/:id — removes credential
 *  24.  DELETE /api/v1/vault/credentials/:id — 404 for unknown id
 *
 *  Security:
 *  25.  POST response for credential NEVER includes plaintext value
 *  26.  GET list response NEVER includes value or encryptedValue fields
 *  27.  GET single credential response value is always exactly "[REDACTED]"
 *  28.  Health check response contains no credential-related fields
 *  29.  Store multiple credentials — list shows all metadata, no values
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Hono } from 'hono';
import {
  createConnectorRegistryRoutes,
  InMemoryConnectorRegistry,
} from './registry.js';
import { createVaultRoutes, InMemoryVaultStore, decryptValue } from './vault.js';

// ---------------------------------------------------------------------------
// Evidence directory helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// From apps/api/src/modules/connectors/ → repo root is 5 levels up
const REPO_ROOT = path.resolve(__dirname, '../../../../../');
const EVIDENCE_DIR = path.join(REPO_ROOT, '.sisyphus', 'evidence');

function saveEvidence(filename: string, data: unknown): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    path.join(EVIDENCE_DIR, filename),
    JSON.stringify(data, null, 2),
    'utf-8',
  );
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function buildRegistryApp(registry?: InMemoryConnectorRegistry): Hono {
  const app = new Hono();
  const reg = registry ?? new InMemoryConnectorRegistry();
  app.route('/', createConnectorRegistryRoutes({ registry: reg }));
  return app;
}

function buildVaultApp(store?: InMemoryVaultStore): Hono {
  const app = new Hono();
  const s = store ?? new InMemoryVaultStore();
  app.route('/', createVaultRoutes({ store: s }));
  return app;
}

async function post(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function del(app: Hono, path: string): Promise<Response> {
  return app.request(path, { method: 'DELETE' });
}

async function jsonBody(res: Response): Promise<unknown> {
  return res.json();
}

// ---------------------------------------------------------------------------
// Registry routes
// ---------------------------------------------------------------------------

describe('GET /api/v1/connectors', () => {
  it('returns empty list initially', async () => {
    const app = buildRegistryApp();
    const res = await app.request('/api/v1/connectors');
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as unknown[];
    expect(body).toEqual([]);
  });

  it('lists registered connectors', async () => {
    const app = buildRegistryApp();
    await post(app, '/api/v1/connectors', { name: 'GitHub CI', type: 'github' });
    await post(app, '/api/v1/connectors', { name: 'Jira Tickets', type: 'jira' });

    const res = await app.request('/api/v1/connectors');
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    const names = body.map((c) => c['name']);
    expect(names).toContain('GitHub CI');
    expect(names).toContain('Jira Tickets');
  });
});


describe('POST /api/v1/connectors', () => {
  it('registers a connector, returns 201 with id and not_configured status', async () => {
    const app = buildRegistryApp();
    const res = await post(app, '/api/v1/connectors', {
      name: 'My GitHub',
      type: 'github',
    });
    expect(res.status).toBe(201);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['id']).toBe('string');
    expect(body['name']).toBe('My GitHub');
    expect(body['type']).toBe('github');
    expect(body['status']).toBe('not_configured');
    expect(typeof body['createdAt']).toBe('string');
  });

  it('400 when name is missing', async () => {
    const app = buildRegistryApp();
    const res = await post(app, '/api/v1/connectors', { type: 'github' });
    expect(res.status).toBe(400);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });

  it('400 when name is empty string', async () => {
    const app = buildRegistryApp();
    const res = await post(app, '/api/v1/connectors', { name: '', type: 'github' });
    expect(res.status).toBe(400);
  });

  it('400 when type is invalid', async () => {
    const app = buildRegistryApp();
    const res = await post(app, '/api/v1/connectors', { name: 'My Connector', type: 'invalid-type' });
    expect(res.status).toBe(400);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });

  it('400 when type is missing', async () => {
    const app = buildRegistryApp();
    const res = await post(app, '/api/v1/connectors', { name: 'My Connector' });
    expect(res.status).toBe(400);
  });

  it('accepts all valid connector types', async () => {
    const types = ['github', 'jira', 'slack', 'sql'] as const;
    for (const type of types) {
      const app = buildRegistryApp();
      const res = await post(app, '/api/v1/connectors', { name: `${type} connector`, type });
      expect(res.status).toBe(201);
      const body = (await jsonBody(res)) as Record<string, unknown>;
      expect(body['type']).toBe(type);
    }
  });

  it('connector has all expected fields', async () => {
    const app = buildRegistryApp();
    const res = await post(app, '/api/v1/connectors', {
      name: 'Slack Alerts',
      type: 'slack',
      description: 'Posts to #qa-alerts channel',
    });
    const body = (await jsonBody(res)) as Record<string, unknown>;

    expect(typeof body['id']).toBe('string');
    expect(body['name']).toBe('Slack Alerts');
    expect(body['type']).toBe('slack');
    expect(body['status']).toBe('not_configured');
    expect(typeof body['createdAt']).toBe('string');
    expect(body['description']).toBe('Posts to #qa-alerts channel');
  });

  it('description defaults to null when omitted', async () => {
    const app = buildRegistryApp();
    const res = await post(app, '/api/v1/connectors', { name: 'SQL Browser', type: 'sql' });
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['description']).toBeNull();
  });
});

describe('GET /api/v1/connectors/:id/health', () => {
  it('returns health result for not_configured connector', async () => {
    const app = buildRegistryApp();
    const createRes = await post(app, '/api/v1/connectors', { name: 'GitHub', type: 'github' });
    const { id } = (await jsonBody(createRes)) as { id: string };

    const res = await app.request(`/api/v1/connectors/${id}/health`);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['id']).toBe(id);
    expect(body['status']).toBe('not_configured');
    expect(typeof body['checkedAt']).toBe('string');
    expect(typeof body['message']).toBe('string');
  });

  it('returns health result for configured connector', async () => {
    const registry = new InMemoryConnectorRegistry();
    const connector = registry.register({ name: 'Jira', type: 'jira', status: 'configured', description: null });
    const app = buildRegistryApp(registry);

    const res = await app.request(`/api/v1/connectors/${connector.id}/health`);
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['status']).toBe('configured');
  });

  it('returns 404 for unknown connector id', async () => {
    const app = buildRegistryApp();
    const res = await app.request('/api/v1/connectors/does-not-exist/health');
    expect(res.status).toBe(404);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });

  it('health result NEVER contains credential data', async () => {
    const app = buildRegistryApp();
    const createRes = await post(app, '/api/v1/connectors', { name: 'Jira', type: 'jira' });
    const { id } = (await jsonBody(createRes)) as { id: string };

    const res = await app.request(`/api/v1/connectors/${id}/health`);
    const body = (await jsonBody(res)) as Record<string, unknown>;

    // Must NOT contain any credential-related fields
    expect(body).not.toHaveProperty('password');
    expect(body).not.toHaveProperty('token');
    expect(body).not.toHaveProperty('secret');
    expect(body).not.toHaveProperty('apiKey');
    expect(body).not.toHaveProperty('credentials');
    expect(body).not.toHaveProperty('encryptedValue');
    expect(body).not.toHaveProperty('value');

    // Capture evidence for health check
    saveEvidence('task-22-connector-missing-credential.json', {
      scenario: 'health check for unconfigured connector',
      connectorId: id,
      healthResponse: body,
      proof: 'No credential fields in response',
    });
  });
});

describe('DELETE /api/v1/connectors/:id', () => {
  it('removes a connector', async () => {
    const app = buildRegistryApp();
    const createRes = await post(app, '/api/v1/connectors', { name: 'To Delete', type: 'slack' });
    const { id } = (await jsonBody(createRes)) as { id: string };

    const delRes = await del(app, `/api/v1/connectors/${id}`);
    expect(delRes.status).toBe(200);
    const delBody = (await jsonBody(delRes)) as Record<string, unknown>;
    expect(delBody['removed']).toBe(true);

    // Verify gone from list
    const listRes = await app.request('/api/v1/connectors');
    const list = (await jsonBody(listRes)) as unknown[];
    expect(list).toHaveLength(0);
  });

  it('returns 404 for unknown connector id', async () => {
    const app = buildRegistryApp();
    const res = await del(app, '/api/v1/connectors/ghost');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Vault routes
// ---------------------------------------------------------------------------

describe('GET /api/v1/vault/credentials', () => {
  it('returns empty list initially', async () => {
    const app = buildVaultApp();
    const res = await app.request('/api/v1/vault/credentials');
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as unknown[];
    expect(body).toEqual([]);
  });

  it('lists stored credentials without values', async () => {
    const app = buildVaultApp();
    await post(app, '/api/v1/vault/credentials', {
      connectorId: 'conn-1',
      key: 'API_TOKEN',
      value: 'super-secret-token',
    });
    await post(app, '/api/v1/vault/credentials', {
      connectorId: 'conn-2',
      key: 'PASSWORD',
      value: 'another-secret',
    });

    const res = await app.request('/api/v1/vault/credentials');
    expect(res.status).toBe(200);
    const body = (await jsonBody(res)) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    const keys = body.map((c) => c['key']);
    expect(keys).toContain('API_TOKEN');
    expect(keys).toContain('PASSWORD');
  });

  it('list response NEVER contains value or encryptedValue fields', async () => {
    const app = buildVaultApp();
    await post(app, '/api/v1/vault/credentials', {
      connectorId: 'conn-1',
      key: 'SECRET_KEY',
      value: 'plaintext-secret',
    });

    const res = await app.request('/api/v1/vault/credentials');
    const body = (await jsonBody(res)) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);

    const credential = body[0];
    expect(credential).not.toHaveProperty('value');
    expect(credential).not.toHaveProperty('encryptedValue');
    expect(JSON.stringify(credential)).not.toContain('plaintext-secret');
  });
});


describe('POST /api/v1/vault/credentials', () => {
  it('stores credential, returns 201 with metadata (no value)', async () => {
    const app = buildVaultApp();
    const res = await post(app, '/api/v1/vault/credentials', {
      connectorId: 'github-connector-id',
      key: 'GITHUB_TOKEN',
      value: 'ghp_my_secret_token',
    });
    expect(res.status).toBe(201);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['id']).toBe('string');
    expect(body['connectorId']).toBe('github-connector-id');
    expect(body['key']).toBe('GITHUB_TOKEN');
    expect(typeof body['createdAt']).toBe('string');

    // Critical: the response MUST NOT contain the plaintext value
    expect(body).not.toHaveProperty('value');
    expect(body).not.toHaveProperty('encryptedValue');
    expect(JSON.stringify(body)).not.toContain('ghp_my_secret_token');
  });

  it('400 when connectorId is missing', async () => {
    const app = buildVaultApp();
    const res = await post(app, '/api/v1/vault/credentials', {
      key: 'TOKEN',
      value: 'secret',
    });
    expect(res.status).toBe(400);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });

  it('400 when key is missing', async () => {
    const app = buildVaultApp();
    const res = await post(app, '/api/v1/vault/credentials', {
      connectorId: 'conn-1',
      value: 'secret',
    });
    expect(res.status).toBe(400);
  });

  it('400 when value is missing', async () => {
    const app = buildVaultApp();
    const res = await post(app, '/api/v1/vault/credentials', {
      connectorId: 'conn-1',
      key: 'TOKEN',
    });
    expect(res.status).toBe(400);
  });

  it('POST response NEVER includes plaintext credential value', async () => {
    const app = buildVaultApp();
    const secretValue = 'top-secret-api-key-xyz789';
    const res = await post(app, '/api/v1/vault/credentials', {
      connectorId: 'test-connector',
      key: 'API_KEY',
      value: secretValue,
    });

    const responseText = await res.text();
    expect(responseText).not.toContain(secretValue);

    const body = JSON.parse(responseText) as Record<string, unknown>;

    // Save redaction evidence
    saveEvidence('task-22-vault-redaction.json', {
      scenario: 'POST credential — value must not appear in response',
      request: { connectorId: 'test-connector', key: 'API_KEY', value: '[HIDDEN FOR EVIDENCE]' },
      response: body,
      responseContainsSecret: responseText.includes(secretValue),
      proof: 'encryptedValue absent from response, plaintext not in JSON',
    });

    expect(body).not.toHaveProperty('value');
    expect(body).not.toHaveProperty('encryptedValue');
  });
});

describe('GET /api/v1/vault/credentials/:id', () => {
  it('returns metadata with value field showing [REDACTED]', async () => {
    const app = buildVaultApp();
    const createRes = await post(app, '/api/v1/vault/credentials', {
      connectorId: 'conn-github',
      key: 'GITHUB_TOKEN',
      value: 'super-secret-ghp-token',
    });
    const { id } = (await jsonBody(createRes)) as { id: string };

    const res = await app.request(`/api/v1/vault/credentials/${id}`);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(body['id']).toBe(id);
    expect(body['connectorId']).toBe('conn-github');
    expect(body['key']).toBe('GITHUB_TOKEN');
    expect(typeof body['createdAt']).toBe('string');

    // Critical: value MUST be exactly '[REDACTED]'
    expect(body['value']).toBe('[REDACTED]');
    // And MUST NOT contain the actual secret
    expect(JSON.stringify(body)).not.toContain('super-secret-ghp-token');
    expect(body).not.toHaveProperty('encryptedValue');
  });

  it('value is always exactly the string "[REDACTED]"', async () => {
    const app = buildVaultApp();
    const createRes = await post(app, '/api/v1/vault/credentials', {
      connectorId: 'conn-jira',
      key: 'JIRA_API_KEY',
      value: 'jira-secret-password-123',
    });
    const { id } = (await jsonBody(createRes)) as { id: string };

    const res = await app.request(`/api/v1/vault/credentials/${id}`);
    const body = (await jsonBody(res)) as Record<string, unknown>;

    // Must be exactly the sentinel string
    expect(body['value']).toBe('[REDACTED]');
    expect(typeof body['value']).toBe('string');
  });

  it('returns 404 for unknown credential id', async () => {
    const app = buildVaultApp();
    const res = await app.request('/api/v1/vault/credentials/does-not-exist');
    expect(res.status).toBe(404);
    const body = (await jsonBody(res)) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
  });
});

describe('DELETE /api/v1/vault/credentials/:id', () => {
  it('removes a credential', async () => {
    const app = buildVaultApp();
    const createRes = await post(app, '/api/v1/vault/credentials', {
      connectorId: 'conn-to-delete',
      key: 'DELETE_ME',
      value: 'some-value',
    });
    const { id } = (await jsonBody(createRes)) as { id: string };

    const delRes = await del(app, `/api/v1/vault/credentials/${id}`);
    expect(delRes.status).toBe(200);
    const delBody = (await jsonBody(delRes)) as Record<string, unknown>;
    expect(delBody['removed']).toBe(true);

    // Verify it's gone
    const getRes = await app.request(`/api/v1/vault/credentials/${id}`);
    expect(getRes.status).toBe(404);

    const listRes = await app.request('/api/v1/vault/credentials');
    const list = (await jsonBody(listRes)) as unknown[];
    expect(list).toHaveLength(0);
  });

  it('returns 404 for unknown credential id', async () => {
    const app = buildVaultApp();
    const res = await del(app, '/api/v1/vault/credentials/ghost-cred');
    expect(res.status).toBe(404);
  });
});

describe('Security — credential value never leaks', () => {
  it('storing multiple credentials — list shows all metadata, no values', async () => {
    const app = buildVaultApp();
    const secrets = [
      { connectorId: 'c1', key: 'API_KEY', value: 'secret-alpha' },
      { connectorId: 'c2', key: 'PASSWORD', value: 'secret-beta' },
      { connectorId: 'c3', key: 'TOKEN', value: 'secret-gamma' },
    ];

    for (const s of secrets) {
      await post(app, '/api/v1/vault/credentials', s);
    }

    const res = await app.request('/api/v1/vault/credentials');
    const body = (await jsonBody(res)) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(3);

    const responseJson = JSON.stringify(body);
    // None of the secret values should appear
    expect(responseJson).not.toContain('secret-alpha');
    expect(responseJson).not.toContain('secret-beta');
    expect(responseJson).not.toContain('secret-gamma');
    // encryptedValue field must not appear
    expect(responseJson).not.toContain('encryptedValue');
  });

  it('connector list response has no credential data', async () => {
    const app = buildRegistryApp();
    await post(app, '/api/v1/connectors', {
      name: 'GitHub',
      type: 'github',
      description: 'CI connector',
    });

    const res = await app.request('/api/v1/connectors');
    const body = (await jsonBody(res)) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);

    const connector = body[0];
    expect(connector).not.toHaveProperty('token');
    expect(connector).not.toHaveProperty('apiKey');
    expect(connector).not.toHaveProperty('secret');
    expect(connector).not.toHaveProperty('password');
    expect(connector).not.toHaveProperty('credentials');
    expect(connector).not.toHaveProperty('encryptedValue');
  });
});

// ---------------------------------------------------------------------------
// Vault encryption — non-deterministic and non-plaintext
// ---------------------------------------------------------------------------

const TEST_VAULT_SECRET = 'test-vault-secret-32chars-minimum!!';

describe('Vault encryption — non-deterministic and non-plaintext', () => {
  it('same value stored twice produces different ciphertext (non-deterministic)', async () => {
    const store = new InMemoryVaultStore(TEST_VAULT_SECRET);
    await store.store({ connectorId: 'c1', key: 'KEY', value: 'my-secret-value' });
    await store.store({ connectorId: 'c1', key: 'KEY', value: 'my-secret-value' });

    const records = store.list();
    expect(records).toHaveLength(2);

    const r1 = store.get(records[0]!.id)!;
    const r2 = store.get(records[1]!.id)!;

    // Non-deterministic: random IV + salt means same plaintext → different ciphertext
    expect(r1.encryptedValue).not.toBe(r2.encryptedValue);
  });

  it('stored encryptedValue does not contain plaintext anywhere', async () => {
    const store = new InMemoryVaultStore(TEST_VAULT_SECRET);
    const plaintext = 'super-secret-value-xyz-12345';
    await store.store({ connectorId: 'c1', key: 'KEY', value: plaintext });

    const records = store.list();
    const record = store.get(records[0]!.id)!;

    // The stored value must not be the plaintext
    expect(record.encryptedValue).not.toContain(plaintext);
    // Must not use fake enc: prefix
    expect(record.encryptedValue).not.toMatch(/^enc:/);
    // Must not use dev-mode plain: prefix when secret is set
    expect(record.encryptedValue).not.toMatch(/^plain:/);
    // Must be valid JSON blob (AES-256-GCM output)
    const parsed = JSON.parse(record.encryptedValue) as Record<string, unknown>;
    expect(parsed).toHaveProperty('ct');
    expect(parsed).toHaveProperty('iv');
    expect(parsed).toHaveProperty('tag');
    expect(parsed).toHaveProperty('salt');
    expect(parsed).toHaveProperty('iter', 100_000);
  });

  it('decryption with wrong key throws (auth tag validation fails)', async () => {
    const store = new InMemoryVaultStore(TEST_VAULT_SECRET);
    await store.store({ connectorId: 'c1', key: 'KEY', value: 'my-secret' });

    const records = store.list();
    const record = store.get(records[0]!.id)!;

    // Attempting to decrypt with a different password must fail
    await expect(
      decryptValue('wrong-key-completely-different!!', record.encryptedValue),
    ).rejects.toThrow();
  });
});
