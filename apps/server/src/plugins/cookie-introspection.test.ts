import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerCookieIntrospectionPlugin, type CookieIntrospectionOptions } from './cookie-introspection.js';

const BASE_OPTIONS: CookieIntrospectionOptions = {
  dashboardUrl: 'http://localhost:4000',
  serviceSecret: 'test-service-secret',
  cacheTtlMs: 60_000,
  cacheMaxSize: 1000,
};

async function buildApp(opts: Partial<CookieIntrospectionOptions> = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerCookieIntrospectionPlugin(app, { ...BASE_OPTIONS, ...opts });
  await app.ready();
  return app;
}

const VALID_RESPONSE = { valid: true, userId: 'user-123', username: 'Test User' };
const INVALID_RESPONSE = { valid: false };

describe('registerCookieIntrospectionPlugin', () => {
  let app: FastifyInstance;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    globalThis.fetch = fetchMock;
  });

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  describe('cache miss → calls Dashboard', () => {
    it('calls Dashboard on cache miss and returns valid result', async () => {
      fetchMock.mockResolvedValueOnce({
        json: async () => VALID_RESPONSE,
      } as Response);

      app = await buildApp();
      const result = await app.introspectSessionCookie('mytoken123');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:4000/api/auth/validate-session?token=mytoken123',
        expect.objectContaining({
          headers: { 'X-Service-Auth': 'Bearer test-service-secret' },
        }),
      );
      expect(result).toEqual(VALID_RESPONSE);
    });

    it('calls Dashboard on cache miss and returns invalid result', async () => {
      fetchMock.mockResolvedValueOnce({
        json: async () => INVALID_RESPONSE,
      } as Response);

      app = await buildApp();
      const result = await app.introspectSessionCookie('bad-token');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ valid: false });
    });

    it('URL-encodes the token when calling Dashboard', async () => {
      fetchMock.mockResolvedValueOnce({
        json: async () => INVALID_RESPONSE,
      } as Response);

      app = await buildApp();
      await app.introspectSessionCookie('key:123:sig+special');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent('key:123:sig+special')),
        expect.any(Object),
      );
    });
  });

  describe('cache hit → does NOT call Dashboard', () => {
    it('returns cached result on second call without calling Dashboard', async () => {
      fetchMock.mockResolvedValueOnce({
        json: async () => VALID_RESPONSE,
      } as Response);

      app = await buildApp();
      // First call — cache miss
      const first = await app.introspectSessionCookie('mytoken123');
      // Second call — cache hit
      const second = await app.introspectSessionCookie('mytoken123');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(first).toEqual(VALID_RESPONSE);
      expect(second).toEqual(VALID_RESPONSE);
    });

    it('caches invalid results too', async () => {
      fetchMock.mockResolvedValueOnce({
        json: async () => INVALID_RESPONSE,
      } as Response);

      app = await buildApp();
      await app.introspectSessionCookie('bad-token');
      const cached = await app.introspectSessionCookie('bad-token');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(cached).toEqual({ valid: false });
    });

    it('caches different tokens independently', async () => {
      fetchMock
        .mockResolvedValueOnce({ json: async () => VALID_RESPONSE } as Response)
        .mockResolvedValueOnce({ json: async () => INVALID_RESPONSE } as Response);

      app = await buildApp();
      const r1 = await app.introspectSessionCookie('token-a');
      const r2 = await app.introspectSessionCookie('token-b');
      // Cached calls
      const r1b = await app.introspectSessionCookie('token-a');
      const r2b = await app.introspectSessionCookie('token-b');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(r1).toEqual(VALID_RESPONSE);
      expect(r2).toEqual({ valid: false });
      expect(r1b).toEqual(VALID_RESPONSE);
      expect(r2b).toEqual({ valid: false });
    });
  });

  describe('cache expiry → calls Dashboard again', () => {
    it('calls Dashboard again after cache TTL expires', async () => {
      fetchMock
        .mockResolvedValueOnce({ json: async () => VALID_RESPONSE } as Response)
        .mockResolvedValueOnce({ json: async () => VALID_RESPONSE } as Response);

      // Use very short TTL for testing
      app = await buildApp({ cacheTtlMs: 50 });

      // First call — cache miss
      await app.introspectSessionCookie('mytoken');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Advance time past TTL
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + 100);

      // Second call — cache expired, should call Dashboard again
      await app.introspectSessionCookie('mytoken');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('Dashboard returns invalid → caches and returns { valid: false }', () => {
    it('returns { valid: false } and caches it', async () => {
      fetchMock.mockResolvedValueOnce({
        json: async () => ({ valid: false }),
      } as Response);

      app = await buildApp();
      const result = await app.introspectSessionCookie('expired-token');

      expect(result).toEqual({ valid: false });
      // Verify it's cached
      await app.introspectSessionCookie('expired-token');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Dashboard unreachable → returns { valid: false } without throwing', () => {
    it('returns { valid: false } when fetch throws (network error)', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      app = await buildApp();
      const result = await app.introspectSessionCookie('anytoken');

      expect(result).toEqual({ valid: false });
    });

    it('returns { valid: false } when fetch times out (AbortError)', async () => {
      fetchMock.mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'));

      app = await buildApp();
      const result = await app.introspectSessionCookie('anytoken');

      expect(result).toEqual({ valid: false });
    });

    it('does not throw even when Dashboard is unreachable', async () => {
      fetchMock.mockRejectedValue(new Error('network error'));

      app = await buildApp();
      await expect(app.introspectSessionCookie('anytoken')).resolves.not.toThrow();
    });
  });

  describe('uses default options when not provided', () => {
    it('works with only required options (uses default cacheTtlMs and cacheMaxSize)', async () => {
      fetchMock.mockResolvedValueOnce({
        json: async () => VALID_RESPONSE,
      } as Response);

      // Only provide required options — defaults for cacheTtlMs/cacheMaxSize should apply
      const app2 = Fastify({ logger: false });
      await registerCookieIntrospectionPlugin(app2, {
        dashboardUrl: 'http://localhost:4000',
        serviceSecret: 'secret',
        // cacheTtlMs and cacheMaxSize intentionally omitted → use defaults
      });
      await app2.ready();

      const result = await app2.introspectSessionCookie('default-opts-token');
      expect(result).toEqual(VALID_RESPONSE);
      await app2.close();
    });
  });

  describe('firstKey undefined branch — empty map eviction guard', () => {
    it('gracefully handles eviction attempt on empty map (firstKey is undefined)', async () => {
      fetchMock.mockResolvedValueOnce({ json: async () => INVALID_RESPONSE } as Response);

      // cacheMaxSize: 0 → on first set(), size(0) >= maxSize(0) → tries to evict but map is empty
      app = await buildApp({ cacheMaxSize: 0 });

      // First call: cache miss → fetch → set() triggered with empty map → firstKey undefined
      const result = await app.introspectSessionCookie('some-token');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ valid: false });
    });
  });

  describe('LRU eviction when cache is full', () => {
    it('evicts the oldest entry when cacheMaxSize is reached', async () => {
      // Use a small cache for testing
      const SMALL_MAX = 3;
      fetchMock.mockResolvedValue({
        json: async () => ({ valid: false }),
      } as Response);

      app = await buildApp({ cacheMaxSize: SMALL_MAX });

      // Fill cache with SMALL_MAX entries
      await app.introspectSessionCookie('token-1');
      await app.introspectSessionCookie('token-2');
      await app.introspectSessionCookie('token-3');

      expect(fetchMock).toHaveBeenCalledTimes(3);

      // Adding a 4th entry should evict token-1 (oldest/first)
      fetchMock.mockResolvedValueOnce({
        json: async () => ({ valid: true, userId: 'u4', username: 'U4' }),
      } as Response);
      await app.introspectSessionCookie('token-4');

      // token-1 should be evicted — calling it should trigger another fetch
      fetchMock.mockResolvedValueOnce({
        json: async () => ({ valid: false }),
      } as Response);
      await app.introspectSessionCookie('token-1');

      // Total: 3 initial + 1 for token-4 + 1 for evicted token-1 = 5
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });

    it('does not evict when cache is not full', async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({ valid: false }),
      } as Response);

      app = await buildApp({ cacheMaxSize: 1000 });

      // Add a few entries (well under maxSize)
      await app.introspectSessionCookie('token-a');
      await app.introspectSessionCookie('token-b');

      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Both should still be cached
      await app.introspectSessionCookie('token-a');
      await app.introspectSessionCookie('token-b');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('evicts 1 entry when adding to a full cache of 1000', async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({ valid: false }),
      } as Response);

      app = await buildApp({ cacheMaxSize: 1000 });

      // Fill cache completely
      for (let i = 0; i < 1000; i++) {
        await app.introspectSessionCookie(`token-${i}`);
      }
      expect(fetchMock).toHaveBeenCalledTimes(1000);

      // Adding one more should evict oldest (token-0)
      await app.introspectSessionCookie('token-overflow');
      expect(fetchMock).toHaveBeenCalledTimes(1001);

      // token-0 should be evicted — need to fetch again
      await app.introspectSessionCookie('token-0');
      expect(fetchMock).toHaveBeenCalledTimes(1002);

      // token-999 should still be cached (was recently set, hasn't been evicted)
      await app.introspectSessionCookie('token-999');
      expect(fetchMock).toHaveBeenCalledTimes(1002);
    });
  });
});
