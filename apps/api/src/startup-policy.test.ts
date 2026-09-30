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
import {
  syntheticApiKey,
  syntheticCookieSecret,
  syntheticReporterSecret,
  syntheticRunnerRegistrationSecret,
  syntheticVaultSecret,
} from './test-support/synthetic-credentials.js';

/**
 * Values the production policy actually accepts.
 *
 * Assembled rather than written, and audited by
 * `src/test-support/synthetic-credentials.test.ts`. These used to be 16- to
 * 23-character hand-written strings, which meant a test standing in for a deployment
 * credential was exercising a configuration the production policy refuses — a fixture
 * that could not fail, because it was never checked against the thing it claimed to
 * stand for.
 */
const VALID_COOKIE_SECRET = syntheticCookieSecret();
const VALID_REPORTER_SECRET = syntheticReporterSecret();
const VALID_API_KEY = syntheticApiKey();
const VALID_VAULT_SECRET = syntheticVaultSecret();
const VALID_RUNNER_REGISTRATION_SECRET = syntheticRunnerRegistrationSecret();
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
      expect(() =>
        assertInMemoryAllowed(config({ nodeEnv }), 'InMemoryRunRepository'),
      ).not.toThrow();
    }
  });

  it('announces the fallback rather than degrading in silence', () => {
    // The half that was missing, and the half that costs something. Refusing in
    // production is the guarantee; a developer whose database is unreachable still
    // gets a working API that is not durable, and nothing in the output says so. The
    // logger is injected so this asserts the announcement rather than reading stdout.
    const messages: string[] = [];
    assertInMemoryAllowed(config({ nodeEnv: 'development' }), 'InMemoryRunRepository', (message) =>
      messages.push(message),
    );

    expect(messages).toHaveLength(1);
    const [message] = messages;
    expect(message).toContain('InMemoryRunRepository');
    expect(message).toMatch(/not durable/i);
    expect(message).toMatch(/DATABASE_URL/);
  });

  it('announces nothing when it refuses', () => {
    // A refusal that also logged a fallback message would tell an operator the
    // opposite of what happened.
    const messages: string[] = [];
    expect(() =>
      assertInMemoryAllowed(config({ nodeEnv: 'production' }), 'InMemoryRunRepository', (message) =>
        messages.push(message),
      ),
    ).toThrow();
    expect(messages).toEqual([]);
  });

  it('names the component, so eight fallback sites produce eight distinguishable lines', () => {
    // One function is the choke point on purpose: eight callers each logging for
    // themselves is eight chances to forget one, and a log that names no component
    // cannot tell you which store is not durable.
    const messages: string[] = [];
    for (const component of ['InMemoryRunRepository', 'dashboard stores', 'vault']) {
      assertInMemoryAllowed(config({ nodeEnv: 'test' }), component, (message) =>
        messages.push(message),
      );
    }
    expect(messages).toHaveLength(3);
    expect(messages[0]).toContain('InMemoryRunRepository');
    expect(messages[1]).toContain('dashboard stores');
    expect(messages[2]).toContain('vault');
  });
});

describe('checkProductionPolicy', () => {
  it('accepts a fully configured production environment', () => {
    expect(() => checkProductionPolicy(config())).not.toThrow();
  });

  it('rejects the development-only cookie secret literal in production', () => {
    expect(() =>
      checkProductionPolicy(config({ cookieSecret: DEVELOPMENT_COOKIE_SECRET })),
    ).toThrow('COOKIE_SECRET must not be a placeholder');
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
      expect(() =>
        checkProductionPolicy(config({ nodeEnv, objectStore: undefined })),
      ).not.toThrow();
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

  it('reaches the committed literals only where they are harmless', () => {
    const bare = (nodeEnv: string) =>
      config({ nodeEnv, cookieSecret: undefined, apiKey: undefined });

    // A test run may use the literal: there is nothing to protect.
    expect(resolveAuthSecrets(bare('test'), {})).toEqual({
      cookieSecret: DEVELOPMENT_COOKIE_SECRET,
      installationKey: DEVELOPMENT_INSTALLATION_KEY,
    });

    // A development machine must ask for it by name. Previously a missing
    // secret silently became the published literal, on any `nodeEnv` that was
    // not the exact string `production`.
    expect(() => resolveAuthSecrets(bare('development'), {})).toThrow(/COOKIE_SECRET is required/);
    expect(resolveAuthSecrets(bare('development'), { AUTOMATE_ALLOW_DEV_SECRETS: '1' })).toEqual({
      cookieSecret: DEVELOPMENT_COOKIE_SECRET,
      installationKey: DEVELOPMENT_INSTALLATION_KEY,
    });

    // And production refuses them even with the opt-in set.
    expect(() =>
      resolveAuthSecrets(bare('production'), { AUTOMATE_ALLOW_DEV_SECRETS: '1' }),
    ).toThrow(/required in production/);
  });

  it('never returns a placeholder secret in production, whatever the env allows', () => {
    const placeholder = config({
      nodeEnv: 'production',
      cookieSecret: DEVELOPMENT_COOKIE_SECRET,
      apiKey: 'a'.repeat(32),
    });
    expect(() => checkProductionPolicy(placeholder)).toThrow(/must not be a placeholder/);
  });
});
