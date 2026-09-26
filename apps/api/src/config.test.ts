import { describe, expect, it, afterEach } from 'vitest';
import { getConfig, readObjectStoreSettings } from './config.js';
import { checkProductionPolicy } from './startup-policy.js';

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});

const OBJECT_STORE_ENV = {
  OBJECT_STORE_ENDPOINT: 'https://objects.example.com',
  OBJECT_STORE_BUCKET: 'automate-artifacts',
  OBJECT_STORE_REGION: 'eu-central-1',
  OBJECT_STORE_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
  OBJECT_STORE_SECRET_ACCESS_KEY: 'secret-access-key-value',
  OBJECT_STORE_FORCE_PATH_STYLE: 'true',
  OBJECT_STORE_MAX_BYTES: '1048576',
  OBJECT_STORE_TIMEOUT_MS: '5000',
};

describe('getConfig', () => {
  it('parses canonical cookie and provider settings', () => {
    process.env.NODE_ENV = 'development';
    process.env.COOKIE_SECRET = 'c'.repeat(32);
    process.env.VAULT_SECRET = 'v'.repeat(32);
    process.env.KILO_GATEWAY_URL = 'https://kilo.example';
    process.env.KILO_API_KEY = 'k'.repeat(16);
    const config = getConfig();
    expect(config.cookieSecret).toBe('c'.repeat(32));
    expect(config.kiloGatewayUrl).toBe('https://kilo.example');
  });

  it('keeps a configured production cookie secret', () => {
    process.env.NODE_ENV = 'production';
    process.env.COOKIE_SECRET = 'c'.repeat(32);
    expect(getConfig().cookieSecret).toBe('c'.repeat(32));
  });

  it('never hands the development-only cookie secret to a production composition', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.COOKIE_SECRET;
    delete process.env.SESSION_SECRET;
    const config = getConfig();
    expect(config.cookieSecret).toBeUndefined();
    // The failure is reported by startup policy, not by a silently forged secret.
    expect(() => checkProductionPolicy(config)).toThrow('COOKIE_SECRET is required in production');
  });

  it('keeps the development-only cookie secret available outside production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.COOKIE_SECRET;
    delete process.env.SESSION_SECRET;
    expect(getConfig().cookieSecret).toBe('development-only-cookie-secret-32-chars');
  });

  it('exposes an explicit legacy artifact read fallback root', () => {
    process.env.NODE_ENV = 'development';
    process.env.ARTIFACT_READ_FALLBACK_ROOT = '/mnt/legacy-artifacts';
    expect(getConfig().artifactReadFallbackRoot).toBe('/mnt/legacy-artifacts');
    delete process.env.ARTIFACT_READ_FALLBACK_ROOT;
  });

  it('exposes the object store settings and keeps development usable without them', () => {
    process.env.NODE_ENV = 'development';
    for (const [key, value] of Object.entries(OBJECT_STORE_ENV)) process.env[key] = value;
    expect(getConfig().objectStore).toEqual({
      endpoint: 'https://objects.example.com',
      bucket: 'automate-artifacts',
      region: 'eu-central-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'secret-access-key-value',
      forcePathStyle: true,
      allowInsecureHttp: false,
      maxBytes: 1048576,
      timeoutMs: 5000,
    });
    for (const key of Object.keys(OBJECT_STORE_ENV)) delete process.env[key];
    expect(getConfig().objectStore).toBeUndefined();
  });
});

describe('readObjectStoreSettings', () => {
  it('returns undefined when no object store variable is set', () => {
    expect(readObjectStoreSettings({})).toBeUndefined();
  });

  it('ignores optional tuning values until a required field is configured', () => {
    expect(
      readObjectStoreSettings({
        OBJECT_STORE_FORCE_PATH_STYLE: 'true',
        OBJECT_STORE_MAX_BYTES: '1048576',
        OBJECT_STORE_TIMEOUT_MS: '5000',
      }),
    ).toBeUndefined();
  });

  it('names the variables a partial configuration is missing', () => {
    expect(() =>
      readObjectStoreSettings({
        OBJECT_STORE_ENDPOINT: 'https://objects.example.com',
        OBJECT_STORE_BUCKET: 'automate-artifacts',
      }),
    ).toThrow(
      'Object store configuration is incomplete; set OBJECT_STORE_REGION, OBJECT_STORE_ACCESS_KEY_ID, OBJECT_STORE_SECRET_ACCESS_KEY',
    );
  });

  it('rejects an unusable endpoint, boolean, or bound', () => {
    const complete = { ...OBJECT_STORE_ENV, OBJECT_STORE_BUCKET: 'Automate' };
    expect(() => readObjectStoreSettings({ ...complete, OBJECT_STORE_BUCKET: 'Automate' })).toThrow(
      'OBJECT_STORE_BUCKET must be a lowercase S3 bucket name',
    );
    expect(() =>
      readObjectStoreSettings({ ...complete, OBJECT_STORE_FORCE_PATH_STYLE: 'yes please' }),
    ).toThrow('OBJECT_STORE_FORCE_PATH_STYLE must be a boolean');
    expect(() => readObjectStoreSettings({ ...complete, OBJECT_STORE_MAX_BYTES: 'lots' })).toThrow(
      'OBJECT_STORE_MAX_BYTES must be a positive integer',
    );
  });

  it('accepts every documented boolean spelling and the byte and timeout bounds', () => {
    for (const [raw, expected] of [
      ['1', true],
      ['true', true],
      ['yes', true],
      ['on', true],
      ['0', false],
      ['false', false],
      ['no', false],
      ['off', false],
    ] as const) {
      expect(
        readObjectStoreSettings({ ...OBJECT_STORE_ENV, OBJECT_STORE_FORCE_PATH_STYLE: raw })
          ?.forcePathStyle,
      ).toBe(expected);
    }
    expect(readObjectStoreSettings(OBJECT_STORE_ENV)?.maxBytes).toBe(1048576);
    expect(readObjectStoreSettings(OBJECT_STORE_ENV)?.timeoutMs).toBe(5000);
    expect(
      readObjectStoreSettings({
        ...OBJECT_STORE_ENV,
        OBJECT_STORE_MAX_BYTES: undefined,
        OBJECT_STORE_TIMEOUT_MS: undefined,
      })?.maxBytes,
    ).toBe(64 * 1024 * 1024);
  });
});
