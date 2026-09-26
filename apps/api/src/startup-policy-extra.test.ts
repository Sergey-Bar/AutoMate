import { describe, expect, it } from 'vitest';
import { checkProductionPolicy } from './startup-policy.js';

const valid = {
  nodeEnv: 'production',
  port: 3000,
  host: '0.0.0.0',
  logLevel: 'info',
  publicAppUrl: 'http://localhost',
  databaseUrl: 'postgres://db',
  cookieSecret: 'c'.repeat(32),
  vaultSecret: 'v'.repeat(32),
  apiKey: 'a'.repeat(16),
  reporterSecret: 'r'.repeat(16),
  runnerRegistrationSecret: 's'.repeat(16),
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
