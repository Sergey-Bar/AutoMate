import type { AppConfig } from './config.js';

/**
 * The cookie secret used when `AUTOMATE_ALLOW_DEV_SECRETS=1` is set outside a
 * test environment.
 *
 * This literal is in git history and in every clone, so it is a *publicly known
 * signing key* for any install that uses it. That is acceptable only for a
 * developer's own machine, and only when the operator asked for it by name.
 * It is never used in a test (tests may pass an explicit secret) and never in
 * production.
 */
export const DEVELOPMENT_COOKIE_SECRET = 'development-only-cookie-secret-32-chars';
export const DEVELOPMENT_INSTALLATION_KEY = 'development-installation-key';

/**
 * The environment variable an operator must set to accept the committed
 * development secrets outside a test run. Grep for it to find every place the
 * development path is reachable.
 */
export const ALLOW_DEV_SECRETS_ENV = 'AUTOMATE_ALLOW_DEV_SECRETS';

export function devSecretsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[ALLOW_DEV_SECRETS_ENV]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

export function isProduction(config: AppConfig): boolean {
  return config.nodeEnv === 'production';
}

/**
 * Process-local (in-memory) stand-ins are an explicit development/test
 * convenience, never a production composition. Production callers must fail
 * closed instead of silently degrading to process-local state.
 */
export function assertInMemoryAllowed(config: AppConfig, component: string): void {
  if (isProduction(config)) {
    throw new Error(
      `Refusing in-memory ${component} in production; configure the durable backend instead`,
    );
  }
}

export function checkProductionPolicy(config: AppConfig): void {
  if (isProduction(config)) {
    if (!config.cookieSecret) {
      throw new Error('COOKIE_SECRET is required in production');
    }
    if (
      config.cookieSecret.includes('change-me') ||
      config.cookieSecret === 'automate' ||
      config.cookieSecret.includes('development-only')
    ) {
      throw new Error('COOKIE_SECRET must not be a placeholder');
    }
    if (config.cookieSecret.length < 32) {
      throw new Error('COOKIE_SECRET must be at least 32 characters');
    }
    if (!config.reporterSecret) {
      throw new Error('REPORTER_SECRET is required in production');
    }
    if (config.reporterSecret === 'change-me' || config.reporterSecret === 'reporter-secret') {
      throw new Error('REPORTER_SECRET must not be a placeholder');
    }
    if (config.reporterSecret.length < 16) {
      throw new Error('REPORTER_SECRET must be at least 16 characters');
    }
    if (!config.apiKey) {
      throw new Error('AUTOMATE_API_KEY is required in production');
    }
    if (config.apiKey === 'change-me' || config.apiKey === 'automate') {
      throw new Error('AUTOMATE_API_KEY must not be a placeholder');
    }
    if (config.apiKey.length < 16) {
      throw new Error('AUTOMATE_API_KEY must be at least 16 characters');
    }
    if (!config.vaultSecret) {
      throw new Error('VAULT_SECRET is required in production');
    }
    if (config.vaultSecret === 'change-me') {
      throw new Error('VAULT_SECRET must not be a placeholder');
    }
    if (config.vaultSecret.length < 32) {
      throw new Error('VAULT_SECRET must be at least 32 characters');
    }
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL is required in production');
    }
    if (!config.objectStore) {
      // Artifact bytes are evidence. Without a durable object store they would
      // live on one process's filesystem and disappear with it, so production
      // fails closed instead of composing the local store.
      throw new Error(
        'OBJECT_STORE_ENDPOINT, OBJECT_STORE_BUCKET, OBJECT_STORE_REGION, OBJECT_STORE_ACCESS_KEY_ID, and OBJECT_STORE_SECRET_ACCESS_KEY are required in production; artifact bytes must be stored in a durable object store',
      );
    }
    if (config.objectStore.endpoint.startsWith('http:') && !config.objectStore.allowInsecureHttp) {
      throw new Error(
        'OBJECT_STORE_ENDPOINT must use https in production unless OBJECT_STORE_ALLOW_INSECURE is enabled',
      );
    }
    if (!config.runnerRegistrationSecret) {
      throw new Error('RUNNER_REGISTRATION_SECRET is required in production');
    }
    if (
      config.runnerRegistrationSecret === 'change-me' ||
      config.runnerRegistrationSecret === 'runner-registration-secret'
    ) {
      throw new Error('RUNNER_REGISTRATION_SECRET must not be a placeholder');
    }
    if (config.runnerRegistrationSecret.length < 16) {
      throw new Error('RUNNER_REGISTRATION_SECRET must be at least 16 characters');
    }
  }
}

export interface AuthSecrets {
  cookieSecret: string;
  installationKey: string;
}

/**
 * Resolves the secrets that sign cookies and installation credentials.
 *
 * Previously this returned the committed development literal whenever
 * `nodeEnv` was anything other than the exact string `production`, and
 * `getConfig` passed `requireProductionSecrets: false` unconditionally. The
 * result was that a deployment started without `NODE_ENV=production` signed
 * its sessions with a key published in this repository — and the login page
 * was still reachable.
 *
 * Now the literal is reachable only where it is harmless: a test run, or a
 * developer's own machine with `AUTOMATE_ALLOW_DEV_SECRETS=1`. Everywhere else
 * a missing secret is a startup failure, not a silent fallback.
 */
export function resolveAuthSecrets(
  config: AppConfig,
  env: NodeJS.ProcessEnv = process.env,
): AuthSecrets {
  if (isProduction(config)) {
    if (!config.cookieSecret) {
      throw new Error('COOKIE_SECRET is required in production');
    }
    if (!config.apiKey) {
      throw new Error('AUTOMATE_API_KEY is required in production');
    }
  }
  const allowLiterals = config.nodeEnv === 'test' || devSecretsAllowed(env);
  if (!config.cookieSecret && !allowLiterals) {
    throw new Error(
      'COOKIE_SECRET is required. There is no fallback: the development ' +
        `literal is a publicly known signing key. Set COOKIE_SECRET (at least ` +
        `32 characters), or set ${ALLOW_DEV_SECRETS_ENV}=1 on a development ` +
        'machine to accept it deliberately.',
    );
  }
  if (!config.apiKey && !allowLiterals) {
    throw new Error(
      `AUTOMATE_API_KEY is required. Set it, or set ${ALLOW_DEV_SECRETS_ENV}=1 ` +
        'on a development machine to accept the development installation key.',
    );
  }
  return {
    cookieSecret: config.cookieSecret ?? DEVELOPMENT_COOKIE_SECRET,
    installationKey: config.apiKey ?? DEVELOPMENT_INSTALLATION_KEY,
  };
}
