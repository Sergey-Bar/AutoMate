import { checkProductionPolicy } from './startup-policy.js';

describe('checkProductionPolicy', () => {
  it('throws containing COOKIE_SECRET when cookieSecret is missing in production', () => {
    expect(() =>
      checkProductionPolicy({
        nodeEnv: 'production',
        reporterSecret: 'reporter-secret',
      }),
    ).toThrow('COOKIE_SECRET');
  });

  it('throws containing REPORTER_SECRET when reporterSecret is missing in production', () => {
    expect(() =>
      checkProductionPolicy({
        nodeEnv: 'production',
        cookieSecret: 'cookie-secret',
      }),
    ).toThrow('REPORTER_SECRET');
  });

  it('does not throw when both secrets are set in production', () => {
    expect(() =>
      checkProductionPolicy({
        nodeEnv: 'production',
        cookieSecret: 'cookie-secret',
        reporterSecret: 'reporter-secret',
      }),
    ).not.toThrow();
  });

  it('does not throw in development even without secrets', () => {
    expect(() =>
      checkProductionPolicy({
        nodeEnv: 'development',
      }),
    ).not.toThrow();
  });

  it('does not throw when nodeEnv is undefined', () => {
    expect(() => checkProductionPolicy({})).not.toThrow();
  });
});
