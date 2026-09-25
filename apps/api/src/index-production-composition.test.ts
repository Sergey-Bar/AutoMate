import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Production composition must fail at the policy gate, before any database
// client, in-memory fallback, or secret literal is constructed. The module is
// imported dynamically with a production environment so module scope — not a
// test-visible function — is what is exercised.
const original = { ...process.env };

const VALID_SECRETS = {
  COOKIE_SECRET: 'cookie-secret-long-enough-for-production-1',
  REPORTER_SECRET: 'reporter-secret-long-enough',
  AUTOMATE_API_KEY: 'api-key-long-enough-1',
  VAULT_SECRET: 'vault-secret-long-enough-for-prod-1',
  RUNNER_REGISTRATION_SECRET: 'runner-registration-secret-1',
};

const OBJECT_STORE = {
  OBJECT_STORE_ENDPOINT: 'https://objects.example.com',
  OBJECT_STORE_BUCKET: 'automate-artifacts',
  OBJECT_STORE_REGION: 'eu-central-1',
  OBJECT_STORE_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
  OBJECT_STORE_SECRET_ACCESS_KEY: 'object-store-secret-long-enough',
};

function productionEnv(overrides: Record<string, string | undefined> = {}): void {
  process.env['NODE_ENV'] = 'production';
  for (const key of [
    'COOKIE_SECRET',
    'SESSION_SECRET',
    'REPORTER_SECRET',
    'AUTOMATE_API_KEY',
    'VAULT_SECRET',
    'RUNNER_REGISTRATION_SECRET',
    'DATABASE_URL',
    ...Object.keys(OBJECT_STORE),
  ]) {
    delete process.env[key];
  }
  Object.assign(process.env, VALID_SECRETS);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('production composition', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...original };
    vi.resetModules();
  });

  it('refuses to compose without a cookie secret', async () => {
    productionEnv({ COOKIE_SECRET: undefined });
    await expect(import('./index.js')).rejects.toThrow('COOKIE_SECRET is required in production');
  });

  it('refuses to compose without a database url', async () => {
    productionEnv();
    await expect(import('./index.js')).rejects.toThrow('DATABASE_URL is required in production');
  });

  it('refuses an unreachable database url before any in-memory fallback is used', async () => {
    // If composition ran ahead of the policy gate, the import would fail on the
    // database connection (or fall back to in-memory stores) instead.
    productionEnv({
      DATABASE_URL: 'postgres://127.0.0.1:1/unreachable',
      REPORTER_SECRET: undefined,
    });
    await expect(import('./index.js')).rejects.toThrow('REPORTER_SECRET is required in production');
  });

  it('refuses to compose without a durable artifact object store', async () => {
    // Fully valid secrets and a database url: the only remaining gate is the
    // object store, which must fail before the database is contacted and before
    // any local-filesystem artifact store is composed.
    productionEnv({ DATABASE_URL: 'postgres://127.0.0.1:1/unreachable' });
    await expect(import('./index.js')).rejects.toThrow(
      'artifact bytes must be stored in a durable object store',
    );
  });

  it('refuses a half-configured object store at startup', async () => {
    productionEnv({
      DATABASE_URL: 'postgres://127.0.0.1:1/unreachable',
      ...OBJECT_STORE,
      OBJECT_STORE_SECRET_ACCESS_KEY: undefined,
    });
    await expect(import('./index.js')).rejects.toThrow(
      'Object store configuration is incomplete; set OBJECT_STORE_SECRET_ACCESS_KEY',
    );
  });
});
