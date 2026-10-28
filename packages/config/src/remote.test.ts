import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.js';
import { normalizeCloudflareTeamDomain, parseCloudflareRoleMap } from './remote.js';

describe('normalizeCloudflareTeamDomain', () => {
  it('accepts the team name, the domain, or the URL, and returns the domain', () => {
    for (const value of [
      'acme',
      'acme.cloudflareaccess.com',
      'https://acme.cloudflareaccess.com',
      'https://acme.cloudflareaccess.com/',
      ' ACME.cloudflareaccess.com ',
    ]) {
      expect(normalizeCloudflareTeamDomain(value), value).toBe('acme.cloudflareaccess.com');
    }
  });

  it('refuses anything that is not a Cloudflare Access team', () => {
    // The result is both the issuer a token must name and the host keys are fetched from.
    for (const value of [
      '',
      'acme.example.com',
      'https://acme.cloudflareaccess.com.evil.com',
      'acme.cloudflareaccess.com/path',
      'a b',
      'https://user@acme.cloudflareaccess.com',
      'http://acme.cloudflareaccess.com',
    ]) {
      expect(() => normalizeCloudflareTeamDomain(value), value).toThrow(/CF_ACCESS_TEAM_DOMAIN/u);
    }
  });
});

describe('parseCloudflareRoleMap', () => {
  it('reads people, email domains, groups and service tokens', () => {
    expect(
      parseCloudflareRoleMap(
        'admin:Ana@Example.com, operator:*@example.com,operator:group:qa,viewer:service:ci.access',
      ),
    ).toEqual([
      { role: 'admin', kind: 'email', value: 'ana@example.com' },
      { role: 'operator', kind: 'domain', value: 'example.com' },
      { role: 'operator', kind: 'group', value: 'qa' },
      { role: 'viewer', kind: 'service', value: 'ci.access' },
    ]);
    expect(parseCloudflareRoleMap(undefined)).toEqual([]);
  });

  it('refuses a rule it cannot read, naming the variable and the rule', () => {
    for (const rule of ['owner:ana@example.com', 'admin', 'admin:', 'admin:ana', 'group:qa']) {
      expect(() => parseCloudflareRoleMap(rule), rule).toThrow(/CF_ACCESS_ROLE_MAP/u);
    }
  });
});

describe('remote access in the parsed configuration', () => {
  // An audience tag is an identifier, not a secret, but one shaped like a key beside
  // `CF_ACCESS_` reads to gitleaks as a credential; a short word does not.
  const AUDIENCE = 'aud-test';
  const remote = {
    AUTOMATE_REMOTE: 'cloudflare',
    CF_ACCESS_TEAM_DOMAIN: 'acme',
    CF_ACCESS_AUD: AUDIENCE,
  };

  it('is off by default', () => {
    const config = parseConfig({});
    expect(config.remote).toBeUndefined();
    expect(config.cloudflareAccess).toBeUndefined();
  });

  it('reads Cloudflare Access, with viewer as the role for anyone the map does not name', () => {
    const config = parseConfig({ ...remote, CF_ACCESS_ROLE_MAP: 'admin:ana@example.com' });
    expect(config.remote).toBe('cloudflare');
    expect(config.cloudflareAccess).toEqual({
      teamDomain: 'acme.cloudflareaccess.com',
      audience: AUDIENCE,
      roleMap: [{ role: 'admin', kind: 'email', value: 'ana@example.com' }],
      defaultRole: 'viewer',
    });
  });

  it('can give an unnamed identity no role at all', () => {
    expect(
      parseConfig({ ...remote, CF_ACCESS_DEFAULT_ROLE: 'none' }).cloudflareAccess?.defaultRole,
    ).toBeNull();
  });

  it('is a remote install, so an unset profile is startup and access control is on', () => {
    // A tunnel is exposure: the bind stays 127.0.0.1 while the internet can reach it.
    const config = parseConfig(remote);
    expect(config.profile).toBe('startup');
    expect(config.accessControl).toBe('enforced');
  });

  it('leaves the settings out when either half is missing, so the policy can name it', () => {
    expect(
      parseConfig({ AUTOMATE_REMOTE: 'cloudflare', CF_ACCESS_AUD: 'x' }).cloudflareAccess,
    ).toBeUndefined();
  });

  it('refuses a malformed team domain or role map when the configuration is read', () => {
    expect(() => parseConfig({ ...remote, CF_ACCESS_TEAM_DOMAIN: 'evil.example.com' })).toThrow(
      /CF_ACCESS_TEAM_DOMAIN/u,
    );
    expect(() => parseConfig({ ...remote, CF_ACCESS_ROLE_MAP: 'root:ana@example.com' })).toThrow(
      /CF_ACCESS_ROLE_MAP/u,
    );
    expect(() => parseConfig({ AUTOMATE_REMOTE: 'ngrok' })).toThrow(/AUTOMATE_REMOTE/u);
  });
});
