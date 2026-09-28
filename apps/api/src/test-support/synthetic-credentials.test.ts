import { describe, expect, it } from 'vitest';
import { SECRET_MIN_LENGTH, isSecretPlaceholder, parseConfig } from '@automate/config';
import {
  syntheticApiKey,
  syntheticCookieSecret,
  syntheticReporterSecret,
  syntheticRunnerRegistrationSecret,
  syntheticVaultSecret,
} from './synthetic-credentials.js';

/**
 * The fixture audit, as a gate.
 *
 * Every installation secret a test stands in for has to be usable by the production
 * policy, or the test is asserting a configuration no deployment could run. These
 * fixtures were hand-written per file, 16 to 23 characters long, and a floor of 32
 * broke twenty-two of them — which is a fixture problem, not a floor problem, and one
 * that used to be invisible because nothing checked.
 *
 * The check is against the *policy's own* numbers, imported rather than restated, so
 * raising the floor again does not require finding these tests by hand.
 */
const INSTALLATION_SECRETS = {
  COOKIE_SECRET: syntheticCookieSecret(),
  VAULT_SECRET: syntheticVaultSecret(),
  AUTOMATE_API_KEY: syntheticApiKey(),
  REPORTER_SECRET: syntheticReporterSecret(),
  RUNNER_REGISTRATION_SECRET: syntheticRunnerRegistrationSecret(),
} as const;

describe('synthetic installation secrets', () => {
  it.each(Object.entries(INSTALLATION_SECRETS))('%s clears the length floor', (_name, value) => {
    expect(value.length).toBeGreaterThanOrEqual(SECRET_MIN_LENGTH);
  });

  it.each(Object.entries(INSTALLATION_SECRETS))('%s is not a placeholder', (_name, value) => {
    // Every variable, not just the one the fixture names: a cookie secret that
    // happened to be the reporter's placeholder would still be refused, and the
    // point of the assertion is that the fixture is usable everywhere.
    for (const variable of Object.keys(INSTALLATION_SECRETS) as Array<
      keyof typeof INSTALLATION_SECRETS
    >) {
      expect(isSecretPlaceholder(variable, value)).toBe(false);
    }
  });

  it('is accepted by the configuration schema, which is the floor an operator meets', () => {
    const parsed = parseConfig(
      {
        NODE_ENV: 'production',
        ...INSTALLATION_SECRETS,
        DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/automate',
      },
      { requireProductionSecrets: false },
    );
    expect(parsed.installationApiKey).toBe(INSTALLATION_SECRETS.AUTOMATE_API_KEY);
    expect(parsed.reporterSecret).toBe(INSTALLATION_SECRETS.REPORTER_SECRET);
    expect(parsed.runnerRegistrationSecret).toBe(INSTALLATION_SECRETS.RUNNER_REGISTRATION_SECRET);
    expect(parsed.vaultSecret).toBe(INSTALLATION_SECRETS.VAULT_SECRET);
  });
});
