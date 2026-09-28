import { describe, expect, it } from 'vitest';
import { SECRET_MIN_LENGTH } from '@automate/config';
import { checkProductionPolicy } from './startup-policy.js';

// Repeated characters rather than a word, so nothing here can accidentally be read as
// a real credential — and long enough for the policy to reach the check it is testing.
// `repeat(16)` used to be enough and no longer is; that is the whole content of this
// file's history.
const valid = {
  nodeEnv: 'production',
  port: 3000,
  host: '0.0.0.0',
  logLevel: 'info',
  publicAppUrl: 'http://localhost',
  databaseUrl: 'postgres://db',
  cookieSecret: 'c'.repeat(SECRET_MIN_LENGTH),
  vaultSecret: 'v'.repeat(SECRET_MIN_LENGTH),
  apiKey: 'a'.repeat(SECRET_MIN_LENGTH),
  reporterSecret: 'r'.repeat(SECRET_MIN_LENGTH),
  runnerRegistrationSecret: 's'.repeat(SECRET_MIN_LENGTH),
  mcpEndpoint: undefined,
  gatewayUrl: undefined,
  webOrigin: 'http://localhost',
  webDistDir: 'dist',
  enableSso: false,
  ssoIssuer: undefined,
  ssoClientId: undefined,
  ssoClientSecret: undefined,
  sessionTtlHours: 24,
  secureCookies: true,
  trustProxy: false,
  metricsToken: undefined,
  retentionDays: 30,
  seedDemoRun: false,
  objectStore: {
    endpoint: 'https://objects.example.com',
    bucket: 'automate-artifacts',
    region: 'eu-central-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'a-valid-object-store-secret',
    forcePathStyle: false,
    allowInsecureHttp: false,
    maxBytes: 1024,
    timeoutMs: 5000,
  },
};

describe('runner registration startup policy', () => {
  it('accepts a complete production configuration', () => {
    expect(() => checkProductionPolicy(valid as never)).not.toThrow();
  });
  it('rejects missing, placeholder, and short runner registration secrets', () => {
    expect(() =>
      checkProductionPolicy({ ...valid, runnerRegistrationSecret: undefined } as never),
    ).toThrow('RUNNER_REGISTRATION_SECRET');
    expect(() =>
      checkProductionPolicy({ ...valid, runnerRegistrationSecret: 'change-me' } as never),
    ).toThrow('RUNNER_REGISTRATION_SECRET');
    expect(() =>
      checkProductionPolicy({ ...valid, runnerRegistrationSecret: 'short' } as never),
    ).toThrow('RUNNER_REGISTRATION_SECRET');
  });
});
