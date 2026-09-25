import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.js';

describe('parseConfig', () => {
  it('uses COOKIE_SECRET before the compatibility alias', () => {
    const config = parseConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/automate',
      COOKIE_SECRET: 'c'.repeat(32),
      SESSION_SECRET: 's'.repeat(32),
      VAULT_SECRET: 'v'.repeat(32),
    });
    expect(config.cookieSecret).toBe('c'.repeat(32));
  });

  it('treats empty optional development values as absent', () => {
    const config = parseConfig({ DATABASE_URL: '', COOKIE_SECRET: '' });
    expect(config.databaseUrl).toBeUndefined();
    expect(config.cookieSecret).toContain('development');
  });

  it('fails production startup without required secrets', () => {
    expect(() => parseConfig({ NODE_ENV: 'production' })).toThrow('COOKIE_SECRET');
  });

  it('validates ports, URLs, and production vault requirements', () => {
    expect(() => parseConfig({ PORT: '70000' })).toThrow();
    expect(() => parseConfig({ DATABASE_URL: 'not-a-url' })).toThrow();
    expect(() =>
      parseConfig({
        NODE_ENV: 'production',
        COOKIE_SECRET: 'c'.repeat(32),
        DATABASE_URL: 'postgresql://localhost/db',
      }),
    ).toThrow('VAULT_SECRET');
  });

  it('rejects a Kilo URL without an API key', () => {
    expect(() => parseConfig({ KILO_GATEWAY_URL: 'https://kilo.example' })).toThrow('KILO_API_KEY');
  });
});
