import type { MiddlewareHandler } from 'hono';
import { DomainError, ErrorCode } from '../errors/domain-error.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The hostname an `Origin` names, or `null` for one that is not a URL. */
function hostnameOf(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export interface OriginCheckOptions {
  /** The same list CORS admits: `PUBLIC_APP_URL` plus `CORS_ALLOWED_ORIGINS`. */
  allowedOrigins: readonly string[];
}

/**
 * Refuses a state-changing request a browser made on behalf of another site.
 *
 * The session cookie is `SameSite=Lax`, which stops a cross-*site* POST but not a
 * cross-*origin* one from the same site — and on a LAN every `http://192.168.x.y` is the
 * same site as every other. So a page on another machine could post to this install with
 * the operator's cookie. The browser says where a request came from in `Origin`, and in
 * `Sec-Fetch-Site` when it sends no `Origin`; this reads both.
 *
 * Admitted: a safe method; no `Origin` and no cross-site fetch metadata (a runner, a
 * reporter, `curl` — none of which carries a cookie); an `Origin` on the allowlist; an
 * `Origin` naming the host the request was sent to, which is the same-origin dashboard
 * served through the edge proxy.
 */
export function createOriginCheck(options: OriginCheckOptions): MiddlewareHandler {
  const allowed = new Set(options.allowedOrigins);
  return async (context, next) => {
    if (!SAFE_METHODS.has(context.req.method)) {
      const origin = context.req.header('origin');
      const site = context.req.header('sec-fetch-site');
      if (origin !== undefined && origin !== 'null') {
        // Hostnames, not host:port. The edge forwards `Host: $host`, which nginx strips of
        // its port, so the dashboard's own `Origin: http://192.168.1.10:8080` arrives beside
        // `Host: 192.168.1.10`. A different machine is a different hostname either way.
        const host = (context.req.header('x-forwarded-host') ?? context.req.header('host'))
          ?.replace(/:\d+$/u, '')
          .toLowerCase();
        const originHost = hostnameOf(origin);
        if (!allowed.has(origin) && (host === undefined || originHost !== host)) {
          throw new DomainError(ErrorCode.CROSS_SITE_REQUEST, 'Cross-site requests are refused');
        }
      } else if (origin === 'null' || site === 'cross-site') {
        throw new DomainError(ErrorCode.CROSS_SITE_REQUEST, 'Cross-site requests are refused');
      }
    }
    await next();
  };
}
