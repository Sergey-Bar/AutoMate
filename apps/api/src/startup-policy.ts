import type { AppConfig } from './config.js';

export function checkProductionPolicy(config: AppConfig): void {
  if (config.nodeEnv === 'production') {
    if (!config.cookieSecret) {
      throw new Error('COOKIE_SECRET is required in production');
    }
    if (config.cookieSecret.includes('change-me') || config.cookieSecret === 'automate') {
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
  }
}
