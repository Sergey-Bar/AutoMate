import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';

// Mock feature flags before importing the prehandler
vi.mock('../services/feature-flags.js', () => ({
  isEnabled: vi.fn().mockReturnValue(true),
}));

const { cookieAuthPreHandler } = await import('./cookie-auth-prehandler.js');
const { isEnabled } = await import('../services/feature-flags.js');

type IntrospectFn = (token: string) => Promise<{ valid: boolean; userId?: string; username?: string }>;

/**
 * Build a test Fastify app with:
 *  - `introspectSessionCookie` decorated (mocked)
 *  - A test route that uses `cookieAuthPreHandler` and returns `req.user`
 */
async function buildApp(
  introspectMock: IntrospectFn,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Decorate with the mock introspect function
  app.decorate('introspectSessionCookie', introspectMock);

  // A test route that uses the preHandler and returns the user
  app.get('/test', {
    preHandler: cookieAuthPreHandler as (req: FastifyRequest, reply: FastifyReply) => Promise<void>,
  }, async (request) => {
    return { user: (request as FastifyRequest & { user?: { id: string; username: string } }).user ?? null };
  });

  await app.ready();
  return app;
}

describe('cookieAuthPreHandler', () => {
  let app: FastifyInstance;
  let introspectMock: ReturnType<typeof vi.fn<IntrospectFn>>;

  beforeEach(() => {
    introspectMock = vi.fn<IntrospectFn>();
    vi.mocked(isEnabled).mockReturnValue(true);
  });

  afterEach(async () => {
    await app?.close();
    vi.clearAllMocks();
  });

  describe('no cookie present → passes through without setting user', () => {
    it('sets no user and calls handler when no Cookie header', async () => {
      app = await buildApp(introspectMock);

      const res = await app.inject({
        method: 'GET',
        url: '/test',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ user: null });
      expect(introspectMock).not.toHaveBeenCalled();
    });

    it('sets no user when Cookie header has no automate_session cookie', async () => {
      app = await buildApp(introspectMock);

      const res = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { cookie: 'theme=dark; lang=en' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ user: null });
      expect(introspectMock).not.toHaveBeenCalled();
    });
  });

  describe('valid cookie → sets request.user', () => {
    it('sets request.user with id and username when cookie is valid', async () => {
      introspectMock.mockResolvedValueOnce({
        valid: true,
        userId: 'user-abc',
        username: 'Alice',
      });
      app = await buildApp(introspectMock);

      const res = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { cookie: 'automate_session=validtoken123' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ user: { id: 'user-abc', username: 'Alice' } });
      expect(introspectMock).toHaveBeenCalledWith('validtoken123');
    });

    it('uses userId as username when username is not returned', async () => {
      introspectMock.mockResolvedValueOnce({
        valid: true,
        userId: 'user-xyz',
        // username omitted
      });
      app = await buildApp(introspectMock);

      const res = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { cookie: 'automate_session=tokenxyz' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ user: { id: 'user-xyz', username: 'user-xyz' } });
    });

    it('parses automate_session correctly from multi-cookie header', async () => {
      introspectMock.mockResolvedValueOnce({
        valid: true,
        userId: 'user-multi',
        username: 'Multi',
      });
      app = await buildApp(introspectMock);

      const res = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { cookie: 'theme=dark; automate_session=multitoken; lang=en' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ user: { id: 'user-multi', username: 'Multi' } });
      expect(introspectMock).toHaveBeenCalledWith('multitoken');
    });
  });

  describe('invalid cookie → passes through without setting user', () => {
    it('does not set user when token is invalid', async () => {
      introspectMock.mockResolvedValueOnce({ valid: false });
      app = await buildApp(introspectMock);

      const res = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { cookie: 'automate_session=badtoken' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ user: null });
      expect(introspectMock).toHaveBeenCalledWith('badtoken');
    });

    it('does not set user when valid=true but userId is missing', async () => {
      introspectMock.mockResolvedValueOnce({ valid: true }); // no userId
      app = await buildApp(introspectMock);

      const res = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { cookie: 'automate_session=nouseridtoken' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ user: null });
    });
  });

  describe('malformed cookie parts → skipped gracefully', () => {
    it('ignores cookie parts with no "=" sign and still finds automate_session', async () => {
      introspectMock.mockResolvedValueOnce({
        valid: true,
        userId: 'user-ok',
        username: 'OkUser',
      });
      app = await buildApp(introspectMock);

      // "badpart" has no "=" → eqIndex === -1 → continue; automate_session still found
      const res = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { cookie: 'badpart; automate_session=goodtoken; other=val' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ user: { id: 'user-ok', username: 'OkUser' } });
      expect(introspectMock).toHaveBeenCalledWith('goodtoken');
    });
  });

  describe('flag disabled → skips entirely', () => {
    it('does not call introspect and does not set user when unified-auth is disabled', async () => {
      vi.mocked(isEnabled).mockReturnValue(false);
      app = await buildApp(introspectMock);

      const res = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { cookie: 'automate_session=sometoken' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ user: null });
      expect(introspectMock).not.toHaveBeenCalled();
    });

    it('skips even when cookie is present', async () => {
      vi.mocked(isEnabled).mockReturnValue(false);
      app = await buildApp(introspectMock);

      const res = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { cookie: 'automate_session=token; other=value' },
      });

      expect(introspectMock).not.toHaveBeenCalled();
      expect(res.json()).toEqual({ user: null });
    });
  });
});
