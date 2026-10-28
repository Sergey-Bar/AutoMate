import { generateKeyPairSync, randomUUID, type JsonWebKey } from 'node:crypto';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { describe, expect, it, vi } from 'vitest';
import type { CloudflareAccessConfig } from '@automate/config';
import {
  createCloudflareAccessVerifier,
  createCloudflareCallerSource,
  type CloudflareAccessSettings,
  type CloudflareIdentity,
} from './cloudflare-access.js';
import { roleForIdentity } from './role-map.js';

/**
 * The Cloudflare Access JWT verifier, against keys generated here at runtime and a JWKS
 * served by a fake `fetch`. Nothing is a committed key: every signing key below exists for
 * one test process.
 */
interface SigningKey {
  kid: string;
  privateJwk: JsonWebKey & { kid: string; alg: 'RS256' };
  publicJwk: JsonWebKey & { kid: string; alg: 'RS256' };
}

function signingKey(): SigningKey {
  const kid = randomUUID();
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    kid,
    privateJwk: { ...privateKey.export({ format: 'jwk' }), kid, alg: 'RS256' },
    publicJwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' },
  };
}

const SETTINGS: CloudflareAccessSettings = {
  teamDomain: 'acme.cloudflareaccess.com',
  audience: 'aud-0123456789abcdef',
};
const ISSUER = 'https://acme.cloudflareaccess.com';
const CERTS = `${ISSUER}/cdn-cgi/access/certs`;

function jwks(...keys: SigningKey[]) {
  return vi.fn(async (input: string | URL | Request) => {
    expect(String(input)).toBe(CERTS);
    return new Response(JSON.stringify({ keys: keys.map((key) => key.publicJwk) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

const now = () => Math.floor(Date.now() / 1000);

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    aud: [SETTINGS.audience],
    email: 'ana@example.com',
    sub: 'user-7f3a',
    iss: ISSUER,
    iat: now() - 10,
    nbf: now() - 10,
    exp: now() + 300,
    type: 'app',
    ...overrides,
  };
}

describe('the Cloudflare Access verifier', () => {
  it('accepts a token signed by the team key, for this application', async () => {
    const key = signingKey();
    const verifier = createCloudflareAccessVerifier(SETTINGS, { fetch: jwks(key) });
    const token = await sign(claims(), key.privateJwk, 'RS256');
    expect(await verifier.verify(token)).toEqual({
      ok: true,
      identity: {
        subject: 'user-7f3a',
        email: 'ana@example.com',
        serviceTokenId: null,
        groups: [],
      },
    });
  });

  it('reads a service token, which has no person behind it, by its client id', async () => {
    const key = signingKey();
    const verifier = createCloudflareAccessVerifier(SETTINGS, { fetch: jwks(key) });
    const token = await sign(
      claims({ sub: '', email: undefined, common_name: 'ci.client-id.access' }),
      key.privateJwk,
      'RS256',
    );
    const result = await verifier.verify(token);
    expect(result).toMatchObject({
      ok: true,
      identity: { serviceTokenId: 'ci.client-id.access', email: null },
    });
  });

  it('reads the groups an identity provider forwarded, at the top level or under custom', async () => {
    const key = signingKey();
    const verifier = createCloudflareAccessVerifier(SETTINGS, { fetch: jwks(key) });
    const top = await sign(claims({ groups: ['qa', 7, 'admins'] }), key.privateJwk, 'RS256');
    const custom = await sign(claims({ custom: { groups: ['qa-admins'] } }), key.privateJwk);
    expect(await verifier.verify(top)).toMatchObject({ identity: { groups: ['qa', 'admins'] } });
    expect(await verifier.verify(custom)).toMatchObject({ identity: { groups: ['qa-admins'] } });
  });

  it.each([
    ['another application', { aud: ['someone-else'] }, 'audience'],
    ['another team', { iss: 'https://evil.cloudflareaccess.com' }, 'issuer'],
    ['an expired token', { exp: now() - 1 }, 'expired'],
    ['a token not valid yet', { nbf: now() + 600 }, 'not valid yet'],
    ['a token with no expiry', { exp: undefined }, 'expiry'],
  ])('refuses %s', async (_name, overrides, reason) => {
    const key = signingKey();
    const verifier = createCloudflareAccessVerifier(SETTINGS, { fetch: jwks(key) });
    const token = await sign(claims(overrides), key.privateJwk, 'RS256');
    const result = await verifier.verify(token);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toMatch(new RegExp(reason, 'iu'));
  });

  it('refuses a token signed by a key the team does not publish', async () => {
    const published = signingKey();
    const attacker = signingKey();
    // The attacker reuses the published kid, so only the signature can tell them apart.
    const forged = { ...attacker.privateJwk, kid: published.kid };
    const verifier = createCloudflareAccessVerifier(SETTINGS, { fetch: jwks(published) });
    const result = await verifier.verify(await sign(claims(), forged, 'RS256'));
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/signature/iu) });
  });

  it('refuses a payload changed after signing', async () => {
    const key = signingKey();
    const verifier = createCloudflareAccessVerifier(SETTINGS, { fetch: jwks(key) });
    const [header, , signature] = (await sign(claims(), key.privateJwk, 'RS256')).split('.');
    const tampered = Buffer.from(JSON.stringify(claims({ email: 'root@example.com' }))).toString(
      'base64url',
    );
    const result = await verifier.verify(`${String(header)}.${tampered}.${String(signature)}`);
    expect(result.ok).toBe(false);
  });

  it('refuses alg none and every symmetric algorithm, before any key is fetched', async () => {
    const key = signingKey();
    const fetch = jwks(key);
    const verifier = createCloudflareAccessVerifier(SETTINGS, { fetch });
    const body = Buffer.from(JSON.stringify(claims())).toString('base64url');
    for (const alg of ['none', 'HS256', 'RS512', 'ES256']) {
      const header = Buffer.from(JSON.stringify({ alg, kid: key.kid, typ: 'JWT' })).toString(
        'base64url',
      );
      const result = await verifier.verify(`${header}.${body}.`);
      expect(result, alg).toMatchObject({ ok: false, reason: expect.stringMatching(/RS256/u) });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses something that is not a token at all', async () => {
    const verifier = createCloudflareAccessVerifier(SETTINGS, { fetch: jwks(signingKey()) });
    for (const value of ['', 'abc', 'a.b.c', '...']) {
      expect((await verifier.verify(value)).ok, value).toBe(false);
    }
  });

  it('caches the key set, and fetches again once for a key it has not seen', async () => {
    const first = signingKey();
    const rotated = signingKey();
    let published = [first];
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ keys: published.map((key) => key.publicJwk) })),
    );
    const verifier = createCloudflareAccessVerifier(SETTINGS, { fetch, minRefetchMs: 0 });
    for (let i = 0; i < 3; i += 1) {
      expect((await verifier.verify(await sign(claims(), first.privateJwk))).ok).toBe(true);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    // Cloudflare rotates its signing keys; a new kid is a reason to look again.
    published = [first, rotated];
    expect((await verifier.verify(await sign(claims(), rotated.privateJwk))).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not let a stream of unknown key ids become a stream of fetches', async () => {
    const key = signingKey();
    const fetch = jwks(key);
    const verifier = createCloudflareAccessVerifier(SETTINGS, { fetch, minRefetchMs: 60_000 });
    expect((await verifier.verify(await sign(claims(), key.privateJwk))).ok).toBe(true);
    for (let i = 0; i < 5; i += 1) {
      const stranger = signingKey();
      const result = await verifier.verify(await sign(claims(), stranger.privateJwk));
      expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/key/iu) });
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('says so when the key set cannot be fetched, rather than admitting anyone', async () => {
    const key = signingKey();
    const verifier = createCloudflareAccessVerifier(SETTINGS, {
      fetch: vi.fn(async () => new Response('down', { status: 503 })),
    });
    const result = await verifier.verify(await sign(claims(), key.privateJwk));
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/503/u) });
  });
});

describe('the role an Access identity gets', () => {
  const access = (rules: CloudflareAccessConfig['roleMap'], defaultRole: 'viewer' | null) => ({
    roleMap: rules,
    defaultRole,
  });
  const person = (email: string, groups: string[] = []): CloudflareIdentity => ({
    subject: 'u',
    email,
    serviceTokenId: null,
    groups,
  });

  it('is the highest role any rule grants, matching email without regard to case', () => {
    const map = access(
      [
        { role: 'viewer', kind: 'domain', value: 'example.com' },
        { role: 'admin', kind: 'email', value: 'ana@example.com' },
        { role: 'operator', kind: 'group', value: 'qa' },
      ],
      null,
    );
    expect(roleForIdentity(person('Ana@Example.com'), map)).toBe('admin');
    expect(roleForIdentity(person('bo@example.com', ['qa']), map)).toBe('operator');
    expect(roleForIdentity(person('cy@example.com'), map)).toBe('viewer');
    // A subdomain is not the domain.
    expect(roleForIdentity(person('dee@mail.example.com'), map)).toBeNull();
  });

  it('is the default for an identity no rule names', () => {
    expect(roleForIdentity(person('x@elsewhere.org'), access([], 'viewer'))).toBe('viewer');
    expect(roleForIdentity(person('x@elsewhere.org'), access([], null))).toBeNull();
  });

  it('matches a service token by its client id and never by an email rule', () => {
    const map = access([{ role: 'operator', kind: 'service', value: 'ci.access' }], null);
    const machine: CloudflareIdentity = {
      subject: '',
      email: null,
      serviceTokenId: 'ci.access',
      groups: [],
    };
    expect(roleForIdentity(machine, map)).toBe('operator');
    expect(roleForIdentity({ ...machine, serviceTokenId: 'other' }, map)).toBeNull();
  });
});

describe('the Cloudflare caller source', () => {
  const config: CloudflareAccessConfig = {
    teamDomain: SETTINGS.teamDomain,
    audience: SETTINGS.audience,
    roleMap: [{ role: 'operator', kind: 'email', value: 'ana@example.com' }],
    defaultRole: null,
  };
  const request = (headers: Record<string, string> = {}) =>
    new Hono()
      .get('/', async (context) => {
        const source = createCloudflareCallerSource(
          createCloudflareAccessVerifier(SETTINGS, { fetch: jwks(KEY) }),
          config,
          { log: LOG },
        );
        return context.json({ caller: await source(context) });
      })
      .request('/', { headers });
  const KEY = signingKey();
  const LOG = vi.fn();

  it('is nobody without the header, and nobody with a header that does not verify', async () => {
    expect(await (await request()).json()).toEqual({ caller: null });
    expect(
      await (await request({ 'cf-access-jwt-assertion': 'forged.token.value' })).json(),
    ).toEqual({ caller: null });
    // Logged without the token, so a refused header is diagnosable and nothing leaks.
    expect(LOG).toHaveBeenCalledWith(
      'cloudflare access refused a request',
      expect.not.objectContaining({ token: expect.anything() }),
    );
  });

  it('is the person, with the role the map gives them', async () => {
    const token = await sign(claims(), KEY.privateJwk);
    expect(await (await request({ 'cf-access-jwt-assertion': token })).json()).toEqual({
      caller: { actor: 'cf:ana@example.com', role: 'operator', uploaderFor: null },
    });
  });

  it('is a machine for a service token, named by its client id', async () => {
    const token = await sign(
      claims({ sub: '', email: undefined, common_name: 'ci.access' }),
      KEY.privateJwk,
    );
    expect(await (await request({ 'cf-access-jwt-assertion': token })).json()).toEqual({
      caller: { actor: 'cf-service:ci.access', role: null, uploaderFor: null },
    });
  });
});
