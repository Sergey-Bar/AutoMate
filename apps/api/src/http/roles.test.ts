import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createErrorBoundary } from '../errors/boundary.js';
import type { Caller } from '../services/access-service.js';
import { callerOf, requireRole, sourceOf, type CallerResolver } from './roles.js';

/**
 * The credential order (ADR-014): a token, then a Cloudflare Access identity, then the
 * installation session, then open or nobody. One resolver decides it for every guard.
 */
const TOKEN_CALLER: Caller = { actor: 'token:t1', role: 'viewer', uploaderFor: null };
const CF_CALLER: Caller = { actor: 'cf:ana@example.com', role: 'operator', uploaderFor: null };

function resolver(overrides: Partial<CallerResolver> = {}): CallerResolver {
  return {
    mode: 'enforced',
    authenticateToken: vi.fn(async (token: string) => (token === 'amt_good' ? TOKEN_CALLER : null)),
    hasSession: vi.fn(async () => false),
    ...overrides,
  };
}

function app(access: CallerResolver) {
  const { onError } = createErrorBoundary({
    log: () => undefined,
    reportError: () => undefined,
    requestId: () => 'R',
  });
  return new Hono()
    .onError(onError)
    .get('/who', async (context) => context.json(await callerOf(context, access)))
    .get('/op', requireRole('operator', access), (context) => context.text('ok'));
}

describe('the credential order', () => {
  it('reads a Cloudflare identity when no token is presented', async () => {
    const access = resolver({ authenticateRemote: vi.fn(async () => CF_CALLER) });
    expect(await (await app(access).request('/who')).json()).toEqual(CF_CALLER);
    expect((await app(access).request('/op')).status).toBe(200);
  });

  it('lets a presented token win over a Cloudflare identity, and does not ask Cloudflare', async () => {
    const authenticateRemote = vi.fn(async () => CF_CALLER);
    const access = resolver({ authenticateRemote });
    const response = await app(access).request('/who', {
      headers: { authorization: 'Bearer amt_good' },
    });
    expect(await response.json()).toEqual(TOKEN_CALLER);
    expect(authenticateRemote).not.toHaveBeenCalled();
  });

  it('puts a Cloudflare identity ahead of the installation session', async () => {
    const hasSession = vi.fn(async () => true);
    const access = resolver({ authenticateRemote: vi.fn(async () => CF_CALLER), hasSession });
    expect(await (await app(access).request('/who')).json()).toEqual(CF_CALLER);
    expect(hasSession).not.toHaveBeenCalled();
  });

  it('falls through to the session, then to nobody, when Cloudflare has no identity', async () => {
    const authenticateRemote = vi.fn(async () => null);
    const withSession = resolver({ authenticateRemote, hasSession: vi.fn(async () => true) });
    expect(await (await app(withSession).request('/who')).json()).toMatchObject({
      actor: 'session',
      role: 'admin',
    });
    const nobody = resolver({ authenticateRemote });
    expect((await app(nobody).request('/op')).status).toBe(401);
  });

  it('puts a person’s session ahead of Cloudflare, and a token ahead of both', async () => {
    const person: Caller = { actor: 'user:u1', role: 'viewer', uploaderFor: null };
    const authenticateRemote = vi.fn(async () => CF_CALLER);
    const access = resolver({ authenticateSession: vi.fn(async () => person), authenticateRemote });
    expect(await (await app(access).request('/who')).json()).toEqual(person);
    expect(authenticateRemote).not.toHaveBeenCalled();
    const withToken = await app(access).request('/who', {
      headers: { authorization: 'Bearer amt_good' },
    });
    expect(await withToken.json()).toEqual(TOKEN_CALLER);
  });

  it('refuses an identity Access let in but the role map gave no role, as forbidden', async () => {
    const access = resolver({
      authenticateRemote: vi.fn(async () => ({
        actor: 'cf:stranger@example.com',
        role: null,
        uploaderFor: null,
      })),
    });
    expect((await app(access).request('/op')).status).toBe(403);
  });
});

describe('sourceOf', () => {
  it('names where every kind of caller came from', () => {
    expect(sourceOf({ actor: 'token:t1', role: 'viewer', uploaderFor: null })).toBe('token');
    expect(sourceOf({ actor: 'session', role: 'admin', uploaderFor: null })).toBe('installation');
    expect(sourceOf(CF_CALLER)).toBe('cloudflare');
    expect(sourceOf({ actor: 'cf-service:ci', role: 'viewer', uploaderFor: null })).toBe(
      'cloudflare',
    );
    expect(sourceOf({ actor: 'anonymous', role: 'admin', uploaderFor: null })).toBe('anonymous');
    expect(sourceOf({ actor: 'user:u1', role: 'viewer', uploaderFor: null })).toBe('user');
  });
});
