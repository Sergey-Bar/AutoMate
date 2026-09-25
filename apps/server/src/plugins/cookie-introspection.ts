/**
 * cookie-introspection.ts — Dashboard session cookie introspection plugin
 *
 * Decorates the FastifyInstance with `introspectSessionCookie(token)` which:
 *   1. Checks an in-memory LRU cache (TTL: 60s, max 1000 entries)
 *   2. On cache miss, calls Dashboard GET /api/auth/validate-session?token=...
 *      with X-Service-Auth: Bearer <serviceSecret>
 *   3. Caches and returns the result (both valid and invalid results are cached)
 *
 * Part of the unified-auth gateway (Task 11).
 */
import type { FastifyInstance } from 'fastify';

export interface IntrospectionResult {
  valid: boolean;
  userId?: string;
  username?: string;
}

export interface CookieIntrospectionOptions {
  dashboardUrl: string;
  serviceSecret: string;
  cacheTtlMs?: number;
  cacheMaxSize?: number;
}

// ── Fastify type augmentation ──────────────────────────────────────────────────
declare module 'fastify' {
  interface FastifyInstance {
    introspectSessionCookie(token: string): Promise<IntrospectionResult>;
  }
}

// ── Simple LRU cache with TTL ──────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class LruCache<K, V> {
  private readonly map = new Map<K, CacheEntry<V>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxSize: number,
  ) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    // Only evict when adding a NEW key at capacity
    if (!this.map.has(key) && this.map.size >= this.maxSize) {
      // Evict oldest (first) entry
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) {
        this.map.delete(firstKey);
      }
    }
    // map.delete is a no-op for non-existing keys;
    // ensures correct LRU insertion order on both insert and update
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

// ── Plugin ─────────────────────────────────────────────────────────────────────

export async function registerCookieIntrospectionPlugin(
  app: FastifyInstance,
  options: CookieIntrospectionOptions,
): Promise<void> {
  const {
    dashboardUrl,
    serviceSecret,
    cacheTtlMs = 60_000,
    cacheMaxSize = 1000,
  } = options;

  const cache = new LruCache<string, IntrospectionResult>(cacheTtlMs, cacheMaxSize);

  app.decorate('introspectSessionCookie', async (token: string): Promise<IntrospectionResult> => {
    // 1. Check cache
    const cached = cache.get(token);
    if (cached !== undefined) {
      return cached;
    }

    // 2. Call Dashboard introspection endpoint
    try {
      const url = `${dashboardUrl}/api/auth/validate-session?token=${encodeURIComponent(token)}`;
      const res = await fetch(url, {
        headers: {
          'X-Service-Auth': `Bearer ${serviceSecret}`,
        },
        signal: AbortSignal.timeout(5000),
      });

      const data = await res.json() as IntrospectionResult;
      const result: IntrospectionResult = {
        valid: data.valid === true,
        ...(data.valid ? { userId: data.userId, username: data.username } : {}),
      };

      // 3. Cache result (both valid and invalid)
      cache.set(token, result);
      return result;
    } catch {
      // Dashboard unreachable or request failed — fail safe (treat as invalid)
      const fallback: IntrospectionResult = { valid: false };
      cache.set(token, fallback);
      return fallback;
    }
  });
}
