import type { AppConfig } from './config.js';

/**
 * Development/test-only secret fallbacks. These are deliberately named so a
 * reviewer can see they are not production credentials, and startup policy
 * refuses them on a production path (see checkProductionPolicy).
 */
export const DEVELOPMENT_COOKIE_SECRET = 'development-only-cookie-secret-32-chars';
export const DEVELOPMENT_INSTALLATION_KEY = 'development-installation-key';

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
      throw new Error('OBJECT_STORE_ENDPOINT must use https in production unless OBJECT_STORE_ALLOW_INSECURE is enabled');
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
 * Resolves the secrets that sign cookies and installation credentials. In
 * production the configured values are the only acceptable source; the
 * development/test literals are unreachable because checkProductionPolicy
 * rejects both a missing and a placeholder secret first.
 */
export function resolveAuthSecrets(config: AppConfig): AuthSecrets {
  const production = isProduction(config);
  if (production && !config.cookieSecret) {
    throw new Error('COOKIE_SECRET is required in production');
  }
  if (production && !config.apiKey) {
    throw new Error('AUTOMATE_API_KEY is required in production');
  }
  return {
    cookieSecret: config.cookieSecret ?? DEVELOPMENT_COOKIE_SECRET,
    installationKey: config.apiKey ?? DEVELOPMENT_INSTALLATION_KEY,
  };
}
