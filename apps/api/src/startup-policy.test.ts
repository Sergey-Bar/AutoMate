import { describe, expect, it } from 'vitest';
import {
  DEVELOPMENT_COOKIE_SECRET,
  DEVELOPMENT_INSTALLATION_KEY,
  assertInMemoryAllowed,
  checkExposurePolicy,
  checkProductionPolicy,
  exposureWarning,
  identityWarning,
  isProduction,
  resolveAuthSecrets,
} from './startup-policy.js';
import { parseConfig } from '@automate/config';
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

describe('checkExposurePolicy', () => {
  it('starts an install upgraded from 3.0.0: its compose file lists HOST and never AUTOMATE_BIND', () => {
    // The environment the 3.0.0 compose file gives the api container, through the real config
    // parser. `start update` keeps the old compose file and only changes the image, so this
    // is what the 3.1.x API sees on every upgraded install; v3.1.0 refused it and the
    // release workflow's upgrade job caught it.
    const upgraded = parseConfig(
      { NODE_ENV: 'development', HOST: '0.0.0.0' },
      { requireProductionSecrets: false },
    );
    expect(() => checkExposurePolicy(upgraded as AppConfig)).not.toThrow();
    expect(exposureWarning(upgraded as AppConfig)).toMatch(/AUTOMATE_BIND/u);
  });

  it('still refuses a wildcard the operator declared as the published bind', () => {
    const declared = parseConfig(
      { NODE_ENV: 'development', HOST: '0.0.0.0', AUTOMATE_BIND: '0.0.0.0' },
      { requireProductionSecrets: false },
    );
    expect(() => checkExposurePolicy(declared as AppConfig)).toThrow(/reachable from other/u);
    expect(exposureWarning(declared as AppConfig)).toBeUndefined();
  });

  it('still refuses a concrete listen address with no login and no declared bind', () => {
    const concrete = parseConfig(
      { NODE_ENV: 'development', HOST: '192.168.1.5' },
      { requireProductionSecrets: false },
    );
    expect(() => checkExposurePolicy(concrete as AppConfig)).toThrow(/192\.168\.1\.5/u);
  });

  it('says nothing when the bind is declared or the install is on loopback', () => {
    for (const env of [{ AUTOMATE_BIND: '127.0.0.1', HOST: '0.0.0.0' }, {}]) {
      const parsed = parseConfig(
        { NODE_ENV: 'development', ...env },
        { requireProductionSecrets: false },
      );
      expect(exposureWarning(parsed as AppConfig)).toBeUndefined();
    }
  });

  // A reachable install with no login is the posture `index.ts` describes as wrong for any
  // interface but loopback. It used to be a warning printed by the start scripts; it is a
  // refusal now, in every environment, because the network does not care about NODE_ENV.
  it('passes a loopback install whatever its access control', () => {
    for (const exposedBind of ['127.0.0.1', '127.0.0.2', 'localhost', '::1']) {
      expect(() =>
        checkExposurePolicy(config({ exposedBind, accessControl: 'open', lanMode: false })),
      ).not.toThrow();
    }
  });

  it('refuses a reachable install with no login, and says how to fix it', () => {
    for (const nodeEnv of ['production', 'development']) {
      expect(() =>
        checkExposurePolicy(
          config({ nodeEnv, exposedBind: '0.0.0.0', accessControl: 'open', lanMode: false }),
        ),
      ).toThrow(/AUTOMATE_LAN_MODE=1/);
    }
  });

  it('passes a reachable install that enforces access control', () => {
    expect(() =>
      checkExposurePolicy(
        config({ exposedBind: '192.168.1.10', accessControl: 'enforced', lanMode: true }),
      ),
    ).not.toThrow();
    expect(() =>
      checkExposurePolicy(
        config({ exposedBind: '0.0.0.0', accessControl: 'enforced', lanMode: false }),
      ),
    ).not.toThrow();
  });

  it('refuses LAN mode with access control explicitly opened', () => {
    expect(() =>
      checkExposurePolicy(
        config({ exposedBind: '127.0.0.1', accessControl: 'open', lanMode: true }),
      ),
    ).toThrow(/ACCESS_CONTROL=open/);
  });
});

describe('checkExposurePolicy and the deployment profile (ADR-014)', () => {
  const parsed = (env: Record<string, string>): AppConfig =>
    parseConfig({ NODE_ENV: 'development', ...env }, { requireProductionSecrets: false });

  it('refuses team and enterprise with access control opened, naming both settings', () => {
    for (const profile of ['team', 'enterprise']) {
      expect(() =>
        checkExposurePolicy(parsed({ AUTOMATE_PROFILE: profile, ACCESS_CONTROL: 'open' })),
      ).toThrow(new RegExp(`AUTOMATE_PROFILE=${profile}.*ACCESS_CONTROL=open`, 'u'));
    }
  });

  it('refuses solo on a reachable bind, even with a login, and names the profile that fits', () => {
    expect(() =>
      checkExposurePolicy(
        parsed({ AUTOMATE_PROFILE: 'solo', AUTOMATE_BIND: '0.0.0.0', ACCESS_CONTROL: 'enforced' }),
      ),
    ).toThrow(/AUTOMATE_PROFILE=startup/u);
  });

  it('refuses solo beside LAN mode', () => {
    expect(() =>
      checkExposurePolicy(parsed({ AUTOMATE_PROFILE: 'solo', AUTOMATE_LAN_MODE: '1' })),
    ).toThrow(/AUTOMATE_PROFILE=solo/u);
  });

  it('starts every profile in its own default shape', () => {
    expect(() => checkExposurePolicy(parsed({}))).not.toThrow();
    expect(() => checkExposurePolicy(parsed({ AUTOMATE_PROFILE: 'solo' }))).not.toThrow();
    // Enterprise needs a single sign-on to enforce: the SSO block below covers it.
    for (const profile of ['startup', 'team']) {
      expect(() => checkExposurePolicy(parsed({ AUTOMATE_PROFILE: profile }))).not.toThrow();
      expect(() =>
        checkExposurePolicy(parsed({ AUTOMATE_PROFILE: profile, AUTOMATE_BIND: '0.0.0.0' })),
      ).not.toThrow();
    }
  });

  it('keeps an install from before profiles starting: LAN mode with no profile is startup', () => {
    expect(() =>
      checkExposurePolicy(parsed({ AUTOMATE_LAN_MODE: '1', AUTOMATE_BIND: '0.0.0.0' })),
    ).not.toThrow();
  });
});

describe('checkExposurePolicy and a Cloudflare tunnel (ADR-014)', () => {
  const parsed = (env: Record<string, string>): AppConfig =>
    parseConfig({ NODE_ENV: 'development', ...env }, { requireProductionSecrets: false });
  const remote = {
    AUTOMATE_REMOTE: 'cloudflare',
    CF_ACCESS_TEAM_DOMAIN: 'acme',
    CF_ACCESS_AUD: 'aud-1',
  };

  it('starts a tunnel with both Access settings and a login', () => {
    expect(() => checkExposurePolicy(parsed(remote))).not.toThrow();
    expect(() =>
      checkExposurePolicy(parsed({ ...remote, AUTOMATE_PROFILE: 'team' })),
    ).not.toThrow();
  });

  it('refuses a tunnel with access control opened, though the bind is loopback', () => {
    // The bind check cannot see a tunnel: it dials out, and the bind stays 127.0.0.1.
    expect(() => checkExposurePolicy(parsed({ ...remote, ACCESS_CONTROL: 'open' }))).toThrow(
      /AUTOMATE_REMOTE=cloudflare.*ACCESS_CONTROL=open/u,
    );
  });

  it('refuses a tunnel that cannot verify who Cloudflare let in, naming what is missing', () => {
    expect(() =>
      checkExposurePolicy(parsed({ AUTOMATE_REMOTE: 'cloudflare', CF_ACCESS_TEAM_DOMAIN: 'acme' })),
    ).toThrow(/CF_ACCESS_AUD/u);
    expect(() =>
      checkExposurePolicy(parsed({ AUTOMATE_REMOTE: 'cloudflare', CF_ACCESS_AUD: 'aud-1' })),
    ).toThrow(/CF_ACCESS_TEAM_DOMAIN/u);
  });

  it('refuses a solo install behind a tunnel', () => {
    expect(() => checkExposurePolicy(parsed({ ...remote, AUTOMATE_PROFILE: 'solo' }))).toThrow(
      /AUTOMATE_PROFILE=solo.*AUTOMATE_REMOTE/u,
    );
  });
});

describe('checkExposurePolicy and enforced single sign-on (ADR-014)', () => {
  const parsed = (env: Record<string, string>): AppConfig =>
    parseConfig({ NODE_ENV: 'development', ...env }, { requireProductionSecrets: false });

  it('refuses enforced SSO with no single sign-on to enforce, naming both ways to add one', () => {
    // Otherwise the only browser sign-in left would be break-glass.
    expect(() => checkExposurePolicy(parsed({ AUTOMATE_PROFILE: 'enterprise' }))).toThrow(
      /AUTH_SSO_ENFORCED.*OIDC_ISSUER.*AUTOMATE_REMOTE=cloudflare/u,
    );
  });

  it('starts enterprise with OIDC, or with Cloudflare Access, or with SSO turned off', () => {
    const oidc = {
      OIDC_ISSUER: 'https://idp.example.com',
      OIDC_CLIENT_ID: 'automate',
      OIDC_CLIENT_SECRET: ['s', 'e', 'c', 'r', 'e', 't'].join(''),
    };
    expect(() =>
      checkExposurePolicy(parsed({ AUTOMATE_PROFILE: 'enterprise', ...oidc })),
    ).not.toThrow();
    expect(() =>
      checkExposurePolicy(
        parsed({
          AUTOMATE_PROFILE: 'enterprise',
          AUTOMATE_REMOTE: 'cloudflare',
          CF_ACCESS_TEAM_DOMAIN: 'acme',
          CF_ACCESS_AUD: 'aud-1',
        }),
      ),
    ).not.toThrow();
    expect(() =>
      checkExposurePolicy(parsed({ AUTOMATE_PROFILE: 'enterprise', AUTH_SSO_ENFORCED: '0' })),
    ).not.toThrow();
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
  it('signs the installation credential with AUTOMATE_INSTALLATION_KEY when it is set (MNT-20)', () => {
    // Production refuses to boot without AUTOMATE_INSTALLATION_KEY and then never read it:
    // the credential was derived from AUTOMATE_API_KEY, so an operator who set the key the
    // boot error asked for could not sign in with it.
    const presented = 'i'.repeat(40);
    expect(
      resolveAuthSecrets(config(), { AUTOMATE_INSTALLATION_KEY: presented }).installationKey,
    ).toBe(presented);
    // Blank is absent, so the configured API key is still the fallback.
    expect(resolveAuthSecrets(config(), { AUTOMATE_INSTALLATION_KEY: '  ' }).installationKey).toBe(
      VALID_API_KEY,
    );
  });

  it('returns the configured secrets in production', () => {
    expect(resolveAuthSecrets(config(), {})).toEqual({
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

describe('identityWarning (ADR-014)', () => {
  const parsed = (env: Record<string, string>): AppConfig =>
    parseConfig(
      {
        NODE_ENV: 'development',
        OIDC_ISSUER: 'https://idp.example.com',
        OIDC_CLIENT_ID: 'automate',
        OIDC_CLIENT_SECRET: ['s', 'e', 'c', 'r', 'e', 't'].join(''),
        ...env,
      },
      { requireProductionSecrets: false },
    );

  it('names OIDC that admits anyone the provider signs in, with the two settings that narrow it', () => {
    // A Google client open to outside users, with no allowed domains and the default role,
    // makes every Google account a viewer of the default workspace.
    expect(identityWarning(parsed({}))).toMatch(/OIDC_ALLOWED_DOMAINS.*OIDC_DEFAULT_ROLE=none/u);
  });

  it('is quiet when a domain allowlist or a default role of none narrows who gets in', () => {
    expect(identityWarning(parsed({ OIDC_ALLOWED_DOMAINS: 'example.com' }))).toBeUndefined();
    expect(identityWarning(parsed({ OIDC_DEFAULT_ROLE: 'none' }))).toBeUndefined();
    expect(
      identityWarning(
        parseConfig({ NODE_ENV: 'development' }, { requireProductionSecrets: false }),
      ),
    ).toBeUndefined();
  });
});
