import { describe, expect, it, afterEach } from 'vitest';
import { getConfig } from './config.js';

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});

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
});
