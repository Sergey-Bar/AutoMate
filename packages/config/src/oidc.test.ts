import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.js';

/** Assembled, not a literal: a client secret is a credential. */
const SECRET = ['oidc', 'client', 'secret', 'for', 'this', 'test', 'only'].join('-');

const OIDC = {
  OIDC_ISSUER: 'https://idp.example.com',
  OIDC_CLIENT_ID: 'automate',
  OIDC_CLIENT_SECRET: SECRET,
};

describe('OIDC sign-in in the parsed configuration', () => {
  it('is off unless issuer and client id are both set', () => {
    expect(parseConfig({}).oidc).toBeUndefined();
    expect(parseConfig({ OIDC_ISSUER: 'https://idp.example.com' }).oidc).toBeUndefined();
  });

  it('reads the provider, the callback on the public URL, and viewer as the default role', () => {
    const config = parseConfig({ ...OIDC, PUBLIC_APP_URL: 'https://automate.example.com/' });
    expect(config.oidc).toEqual({
      issuer: 'https://idp.example.com',
      clientId: 'automate',
      clientSecret: SECRET,
      redirectUri: 'https://automate.example.com/api/v1/auth/oidc/callback',
      allowedDomains: [],
      roleMap: [],
      defaultRole: 'viewer',
    });
  });

  it('reads allowed domains and a role map in the grammar Cloudflare Access uses', () => {
    const config = parseConfig({
      ...OIDC,
      OIDC_ALLOWED_DOMAINS: 'Example.com, example.org',
      OIDC_ROLE_MAP: 'admin:ana@example.com,operator:group:qa',
      OIDC_DEFAULT_ROLE: 'none',
    });
    expect(config.oidc?.allowedDomains).toEqual(['example.com', 'example.org']);
    expect(config.oidc?.roleMap).toEqual([
      { role: 'admin', kind: 'email', value: 'ana@example.com' },
      { role: 'operator', kind: 'group', value: 'qa' },
    ]);
    expect(config.oidc?.defaultRole).toBeNull();
  });

  it('refuses an issuer that is plain HTTP off this machine, and a malformed role map', () => {
    // The issuer's keys sign every identity; fetched in the clear they prove nothing.
    expect(() => parseConfig({ ...OIDC, OIDC_ISSUER: 'http://idp.example.com' })).toThrow(
      /OIDC_ISSUER/u,
    );
    expect(parseConfig({ ...OIDC, OIDC_ISSUER: 'http://127.0.0.1:9000' }).oidc?.issuer).toBe(
      'http://127.0.0.1:9000',
    );
    expect(() => parseConfig({ ...OIDC, OIDC_ROLE_MAP: 'root:ana@example.com' })).toThrow(
      /OIDC_ROLE_MAP/u,
    );
  });

  it('refuses a client id with no secret, rather than signing in as a public client', () => {
    expect(() =>
      parseConfig({ OIDC_ISSUER: 'https://idp.example.com', OIDC_CLIENT_ID: 'automate' }),
    ).toThrow(/OIDC_CLIENT_SECRET/u);
  });
});
