import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { DrizzleSessionStore } from '@automate/db';
import type { OidcConfig } from '@automate/config';
import { DrizzleAuthSessionBackend } from '../infrastructure/session-backend.js';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { syntheticCookieSecret } from '../test-support/synthetic-credentials.js';
import { callerForUser } from '../services/user-service.js';
import { createOidcRoutes } from './oidc.js';

/**
 * OIDC sign-in (ADR-014, team) against an identity provider served from this process, with a
 * signing key generated at runtime. The provider is real HTTP on a loopback port, so the
 * discovery, the token exchange and the ID token's signature are checked by `openid-client`
 * exactly as they are against Google, Entra or Okta.
 */
const COOKIE_SECRET = syntheticCookieSecret();
const CLIENT_SECRET = ['client', 'secret', randomUUID()].join('-');
const INSTALLATION = '00000000-0000-4000-8000-000000000001';

interface Grant {
  claims: Record<string, unknown>;
  challenge: string;
}

interface Provider {
  issuer: string;
  grants: Map<string, Grant>;
  close: () => Promise<void>;
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function provider(): Promise<Provider> {
  const kid = randomUUID();
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateJwk = { ...privateKey.export({ format: 'jwk' }), kid, alg: 'RS256' as const };
  const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
  const grants = new Map<string, Grant>();
  const app = new Hono();
  let issuer = '';
  app.get('/.well-known/openid-configuration', (c) =>
    c.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      code_challenge_methods_supported: ['S256'],
    }),
  );
  app.get('/jwks', (c) => c.json({ keys: [publicJwk] }));
  app.post('/token', async (c) => {
    const form = await c.req.parseBody();
    const grant = grants.get(String(form['code']));
    const verifier = String(form['code_verifier'] ?? '');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    if (grant === undefined || grant.challenge !== challenge) {
      return c.json({ error: 'invalid_grant' }, 400);
    }
    grants.delete(String(form['code']));
    const now = Math.floor(Date.now() / 1000);
    const idToken = await sign(
      { iss: issuer, aud: 'automate', iat: now, exp: now + 300, ...grant.claims },
      privateJwk,
    );
    return c.json({ access_token: 'at', token_type: 'Bearer', expires_in: 300, id_token: idToken });
  });
  const server: ServerType = await new Promise((resolve) => {
    const started = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () =>
      resolve(started),
    );
  });
  issuer = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return {
    issuer,
    grants,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function harness(overrides: Partial<OidcConfig> = {}) {
  const idp = await provider();
  closers.push(idp.close);
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const sessions = new DrizzleAuthSessionBackend(
    new DrizzleSessionStore(db as never),
    COOKIE_SECRET,
    3_600_000,
    86_400_000,
  );
  const oidc: OidcConfig = {
    issuer: idp.issuer,
    clientId: 'automate',
    clientSecret: CLIENT_SECRET,
    redirectUri: 'https://automate.example.com/api/v1/auth/oidc/callback',
    allowedDomains: ['example.com'],
    roleMap: [{ role: 'admin', kind: 'email', value: 'ana@example.com' }],
    defaultRole: 'viewer',
    ...overrides,
  };
  const app = withErrorBoundary(
    createOidcRoutes({
      oidc,
      db: db as never,
      workspaceId: 'ws-1',
      sessions,
      installationId: INSTALLATION,
      cookieSecret: COOKIE_SECRET,
      sessionTtlMs: 3_600_000,
      secureCookies: false,
    }),
  );
  return { app, db, idp, sessions };
}

/** Starts a sign-in and plays the provider: returns the callback to follow and the cookie. */
async function signIn(
  h: Awaited<ReturnType<typeof harness>>,
  claims: Record<string, unknown>,
  tamper: { state?: string; nonce?: string } = {},
): Promise<{ location: string | null; cookies: string; status: number }> {
  const start = await h.app.request('/api/v1/auth/oidc/start');
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get('location') ?? '');
  expect(authorize.origin + authorize.pathname).toBe(`${h.idp.issuer}/authorize`);
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authorize.searchParams.get('redirect_uri')).toBe(
    'https://automate.example.com/api/v1/auth/oidc/callback',
  );
  const flow = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  expect(flow).toMatch(/^automate_oidc=/u);
  const code = randomUUID();
  h.idp.grants.set(code, {
    challenge: authorize.searchParams.get('code_challenge') ?? '',
    claims: { nonce: tamper.nonce ?? authorize.searchParams.get('nonce'), ...claims },
  });
  const state = tamper.state ?? authorize.searchParams.get('state') ?? '';
  const callback = await h.app.request(
    `/api/v1/auth/oidc/callback?code=${code}&state=${encodeURIComponent(state)}`,
    { headers: { cookie: flow } },
  );
  return {
    status: callback.status,
    location: callback.headers.get('location'),
    cookies: callback.headers.get('set-cookie') ?? '',
  };
}

const ANA = { sub: 'sub-ana', email: 'ana@example.com', email_verified: true, name: 'Ana' };
const BO = { sub: 'sub-bo', email: 'bo@example.com', email_verified: true, name: 'Bo' };

async function sessionUser(h: Awaited<ReturnType<typeof harness>>, cookies: string) {
  const token = /automate_session=([^;]+)/u.exec(cookies)?.[1];
  if (token === undefined) return undefined;
  return (await h.sessions.validate(token))?.userId;
}

describe('OIDC sign-in', () => {
  it('signs a new person in, as the role the map gives them, in this workspace', async () => {
    const h = await harness();
    const result = await signIn(h, ANA);
    expect(result.status).toBe(302);
    expect(result.location).toBe('/');
    const userId = await sessionUser(h, result.cookies);
    expect(userId).toBeDefined();
    expect(await callerForUser({ db: h.db as never, workspaceId: 'ws-1' }, String(userId))).toEqual(
      { actor: `user:${String(userId)}`, role: 'admin', uploaderFor: null },
    );
    // The flow cookie is spent with the sign-in.
    expect(result.cookies).toMatch(/automate_oidc=;/u);
    // A membership is the workspace's: the same person has no role in another.
    expect(
      (await callerForUser({ db: h.db as never, workspaceId: 'ws-2' }, String(userId)))?.role,
    ).toBeNull();
  });

  it('gives a person no rule names the default role, and finds them again by subject', async () => {
    const h = await harness();
    const first = await signIn(h, BO);
    const second = await signIn(h, { ...BO, email: 'bo@example.com', name: 'Bo B.' });
    const id = await sessionUser(h, first.cookies);
    expect(await sessionUser(h, second.cookies)).toBe(id);
    expect(
      (await callerForUser({ db: h.db as never, workspaceId: 'ws-1' }, String(id)))?.role,
    ).toBe('viewer');
    const rows = await h.db.select().from(schema.users);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.displayName).toBe('Bo B.');
  });

  it.each([
    ['a replayed or forged state', { state: 'not-the-state' }, {}, 'failed'],
    ['an ID token for another sign-in', { nonce: 'not-the-nonce' }, {}, 'failed'],
    ['an email outside the allowed domains', {}, { email: 'eve@elsewhere.org' }, 'domain'],
    ['an unverified email', {}, { email_verified: false }, 'unverified'],
  ])('refuses %s, and signs nobody in', async (_name, tamper, claims, reason) => {
    const h = await harness();
    const result = await signIn(h, { ...BO, ...claims }, tamper);
    expect(result.location).toBe(`/?signin=${reason}`);
    expect(result.cookies).not.toMatch(/automate_session=[^;]/u);
    expect(await h.db.select().from(schema.sessions)).toEqual([]);
  });

  it('refuses a person the map does not name when the default role is none', async () => {
    const h = await harness({ defaultRole: null });
    const result = await signIn(h, BO);
    expect(result.location).toBe('/?signin=not-invited');
    expect(await h.db.select().from(schema.workspaceMembers)).toEqual([]);
  });

  it('refuses a disabled person, and their existing session stops working', async () => {
    const h = await harness();
    const first = await signIn(h, BO);
    const id = String(await sessionUser(h, first.cookies));
    await h.db.update(schema.users).set({ disabledAt: new Date() }).where(eq(schema.users.id, id));
    expect(await callerForUser({ db: h.db as never, workspaceId: 'ws-1' }, id)).toBeNull();
    expect((await signIn(h, BO)).location).toBe('/?signin=disabled');
  });

  it('refuses a callback with no flow cookie, which is what a forged link looks like', async () => {
    const h = await harness();
    const response = await h.app.request('/api/v1/auth/oidc/callback?code=x&state=y');
    expect(response.headers.get('location')).toBe('/?signin=expired');
  });

  it('answers a coded 404 when OIDC is not configured', async () => {
    const { db, close } = await migratedDatabase();
    closers.push(close);
    const app = withErrorBoundary(
      createOidcRoutes({
        db: db as never,
        workspaceId: 'ws-1',
        sessions: new DrizzleAuthSessionBackend(
          new DrizzleSessionStore(db as never),
          COOKIE_SECRET,
          1,
          1,
        ),
        installationId: INSTALLATION,
        cookieSecret: COOKIE_SECRET,
        sessionTtlMs: 1,
        secureCookies: false,
      }),
    );
    for (const path of ['/api/v1/auth/oidc/start', '/api/v1/auth/oidc/callback']) {
      const response = await app.request(path);
      expect(response.status, path).toBe(404);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'OIDC_NOT_CONFIGURED',
      );
    }
  });
});
