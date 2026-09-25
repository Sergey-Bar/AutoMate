import { describe, expect, it } from 'vitest';
import {
  DEVELOPMENT_COOKIE_SECRET,
  DEVELOPMENT_INSTALLATION_KEY,
  assertInMemoryAllowed,
  checkProductionPolicy,
  isProduction,
  resolveAuthSecrets,
} from './startup-policy.js';
import type { AppConfig } from './config.js';

const VALID_COOKIE_SECRET = 'valid-cookie-secret-that-is-long-enough';
const VALID_REPORTER_SECRET = 'valid-reporter-secret-x';
const VALID_API_KEY = 'a-valid-api-key-here';
const VALID_VAULT_SECRET = 'a-valid-vault-secret-32chars-min!!';
const VALID_RUNNER_REGISTRATION_SECRET = 'a-valid-runner-registration';
const VALID_OBJECT_STORE = {
  endpoint: 'https://objects.example.com',
  bucket: 'automate-artifacts',
  region: 'eu-central-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'a-valid-object-store-secret',
  forcePathStyle: false,
  allowInsecureHttp: false,
  maxBytes: 1024,
  timeoutMs: 5000,
};

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'production',
    port: 3000,
    databaseUrl: 'postgres://localhost/test',
    cookieSecret: VALID_COOKIE_SECRET,
    reporterSecret: VALID_REPORTER_SECRET,
    apiKey: VALID_API_KEY,
    vaultSecret: VALID_VAULT_SECRET,
    runnerRegistrationSecret: VALID_RUNNER_REGISTRATION_SECRET,
    objectStore: VALID_OBJECT_STORE,
    ...overrides,
  };
}

describe('isProduction', () => {
  it('only treats the production node environment as production', () => {
    expect(isProduction(config())).toBe(true);
    expect(isProduction(config({ nodeEnv: 'development' }))).toBe(false);
    expect(isProduction(config({ nodeEnv: 'test' }))).toBe(false);
  });
});

describe('assertInMemoryAllowed', () => {
  it('refuses an in-memory component in production', () => {
    expect(() => assertInMemoryAllowed(config(), 'InMemoryRunRepository')).toThrow(
      'Refusing in-memory InMemoryRunRepository in production',
    );
  });

  it('keeps explicit in-memory composition in development and test', () => {
    for (const nodeEnv of ['development', 'test']) {
      expect(() => assertInMemoryAllowed(config({ nodeEnv }), 'InMemoryRunRepository')).not.toThrow();
    }
  });
});

describe('checkProductionPolicy', () => {
  it('accepts a fully configured production environment', () => {
    expect(() => checkProductionPolicy(config())).not.toThrow();
  });

  it('rejects the development-only cookie secret literal in production', () => {
    expect(() => checkProductionPolicy(config({ cookieSecret: DEVELOPMENT_COOKIE_SECRET }))).toThrow(
      'COOKIE_SECRET must not be a placeholder',
    );
  });

  it('rejects a placeholder RUNNER_REGISTRATION_SECRET in production', () => {
    expect(() =>
      checkProductionPolicy(config({ runnerRegistrationSecret: 'runner-registration-secret' })),
    ).toThrow('RUNNER_REGISTRATION_SECRET must not be a placeholder');
  });

  it('refuses production without a durable artifact object store', () => {
    expect(() => checkProductionPolicy(config({ objectStore: undefined }))).toThrow(
      'artifact bytes must be stored in a durable object store',
    );
    expect(() => checkProductionPolicy(config({ objectStore: undefined }))).toThrow(
      'OBJECT_STORE_ENDPOINT',
    );
  });

  it('requires an explicit opt-in for an HTTP object-store endpoint', () => {
    const httpStore = { ...VALID_OBJECT_STORE, endpoint: 'http://minio.internal:9000' };
    expect(() => checkProductionPolicy(config({ objectStore: httpStore }))).toThrow(
      'OBJECT_STORE_ALLOW_INSECURE',
    );
    expect(() =>
      checkProductionPolicy(config({ objectStore: { ...httpStore, allowInsecureHttp: true } })),
    ).not.toThrow();
  });

  it('allows the local artifact store outside production', () => {
    for (const nodeEnv of ['development', 'test']) {
      expect(() => checkProductionPolicy(config({ nodeEnv, objectStore: undefined }))).not.toThrow();
    }
  });

  it('stays silent outside production even without secrets', () => {
    for (const nodeEnv of ['development', 'test']) {
      const bare = config({
        nodeEnv,
        databaseUrl: undefined,
        cookieSecret: undefined,
        reporterSecret: undefined,
        apiKey: undefined,
        vaultSecret: undefined,
        runnerRegistrationSecret: undefined,
      });
      expect(() => checkProductionPolicy(bare)).not.toThrow();
    }
  });
});

describe('resolveAuthSecrets', () => {
  it('returns the configured secrets in production', () => {
    expect(resolveAuthSecrets(config())).toEqual({
      cookieSecret: VALID_COOKIE_SECRET,
      installationKey: VALID_API_KEY,
    });
  });

  it('refuses to substitute a literal for a missing production secret', () => {
    expect(() => resolveAuthSecrets(config({ cookieSecret: undefined }))).toThrow(
      'COOKIE_SECRET is required in production',
    );
    expect(() => resolveAuthSecrets(config({ apiKey: undefined }))).toThrow(
      'AUTOMATE_API_KEY is required in production',
    );
  });

  it('uses the named development literals only outside production', () => {
    const bare = (nodeEnv: string) => config({ nodeEnv, cookieSecret: undefined, apiKey: undefined });
    expect(resolveAuthSecrets(bare('development'))).toEqual({
      cookieSecret: DEVELOPMENT_COOKIE_SECRET,
      installationKey: DEVELOPMENT_INSTALLATION_KEY,
    });
    expect(resolveAuthSecrets(bare('test'))).toEqual({
      cookieSecret: DEVELOPMENT_COOKIE_SECRET,
      installationKey: DEVELOPMENT_INSTALLATION_KEY,
    });
  });
});
