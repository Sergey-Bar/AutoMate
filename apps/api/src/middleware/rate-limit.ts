/**
 * A fixed-window rate limiter for unauthenticated endpoints.
 *
 * Windows are counted in process memory, which is the right scope for a
 * single-tenant self-hosted install: the threat is credential stuffing against
 * one API key, not a distributed attack across replicas. Behind a shared load
 * balancer the per-IP dimension degrades and the per-key dimension still holds.
 */
export interface RateLimiterOptions {
  /** Distinct keys allowed per window before requests are refused. */
  limit: number;
  windowMs: number;
  now?: () => number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the current window resets, for `Retry-After`. */
  retryAfterSeconds: number;
  remaining: number;
}

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimiter {
  /** Consumes one token for `key`; never throws. */
  consume(key: string): RateLimitDecision;
  /** Number of tracked keys, for the leak test in the suite. */
  readonly size: number;
  reset(): void;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? (() => Date.now());
  const windows = new Map<string, Window>();

  return {
    consume(key: string): RateLimitDecision {
      const timestamp = now();
      const existing = windows.get(key);
      if (!existing || existing.resetAt <= timestamp) {
        windows.set(key, { count: 1, resetAt: timestamp + options.windowMs });
        return {
          allowed: true,
          retryAfterSeconds: Math.ceil(options.windowMs / 1000),
          remaining: Math.max(0, options.limit - 1),
        };
      }
      existing.count += 1;
      if (existing.count > options.limit)
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - timestamp) / 1000)),
          remaining: 0,
        };
      return {
        allowed: true,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - timestamp) / 1000)),
        remaining: options.limit - existing.count,
      };
    },
    get size(): number {
      return windows.size;
    },
    reset(): void {
      windows.clear();
    },
  };
}
