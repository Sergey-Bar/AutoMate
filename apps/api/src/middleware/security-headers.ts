import type { MiddlewareHandler } from 'hono';

/**
 * Response security headers, and a CORS policy that fails closed.
 *
 * Neither existed. `apps/api/src/index.ts` mounted the auth guard, the body limit
 * and the ingestion rate limiter, and no test anywhere in the repository asserted
 * a single response header — so a reverse proxy stripping `X-Content-Type-Options`,
 * a handler that overwrote `X-Frame-Options`, or a CORS change that opened every
 * origin would all have shipped green.
 *
 * The CORS policy is **default-deny**, and the reason is worth stating because it
 * is the failure mode, not the convenience. The API is same-origin with the web
 * client and authenticates with a cookie, so a permissive
 * `Access-Control-Allow-Origin: *` would not be a development convenience — with
 * `credentials: 'include'` a browser refuses it, and the workarounds people reach
 * for instead are `reflected origin` and `null`, both of which hand a session to
 * any site the user visits. An origin that is not on the list gets no CORS headers
 * at all, which is what the browser needs in order to refuse.
 */
export interface SecurityHeadersOptions {
  /**
   * Exact origins allowed to make credentialed cross-origin requests.
   *
   * Matched exactly, including scheme and port. There is no wildcard and no
   * suffix match: `https://automate.example.com.evil.test` is a different origin
   * and must not be allowed, and a naive `endsWith` check is how that ships.
   */
  allowedOrigins: readonly string[];
  /** `Vary: Origin` is set when more than one origin may be reflected. */
  varyOrigin?: boolean;
  /** Request headers the browser may send on a preflight. */
  allowedHeaders?: readonly string[];
  /** Response headers the browser may read. */
  exposedHeaders?: readonly string[];
  /** Methods the API serves. `Access-Control-Allow-Methods` is static. */
  allowedMethods?: readonly string[];
  /** Preflight cache lifetime, in seconds. */
  maxAgeSeconds?: number;
}

const DEFAULT_ALLOWED_HEADERS = [
  'authorization',
  'content-type',
  'idempotency-key',
  'x-request-id',
  'x-runner-registration-secret',
  'x-rotation-token',
] as const;

const DEFAULT_EXPOSED_HEADERS = [
  'x-idempotent-replay',
  'x-next-cursor',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-request-id',
  'retry-after',
] as const;

const DEFAULT_ALLOWED_METHODS = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
] as const;

/**
 * Headers that are safe and correct to set on every response, with the reason each
 * one is here — a header list without reasons does not survive the next person who
 * thinks a header is noise.
 */
const BASE_HEADERS: ReadonlyArray<readonly [string, string]> = [
  // Stops a browser from second-guessing a declared Content-Type, which is the
  // primitive behind a stored-XSS payload served with `text/html`.
  ['x-content-type-options', 'nosniff'],
  // This API serves a JSON document, not a document to frame. `DENY` rather than
  // `SAMEORIGIN` because nothing here is meant to be framed at all.
  ['x-frame-options', 'DENY'],
  // A referrer from an API response is never needed by the client, and it can
  // carry a run id in the path.
  ['referrer-policy', 'no-referrer'],
  // The only cross-origin surface is the API itself, named explicitly, and
  // `getRequestHeader()` is a no-op in the browsers that support it.
  ['permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()'],
  // `unsafe-inline` is required: Vite injects the theme and the stylesheet, and
  // this is a self-hosted same-origin document. `strict-dynamic` means a script
  // loaded from this page cannot then load a script from anywhere else, which is
  // what turns an injected `<script src>` from an unknown host into a no-op.
  // `strict-dynamic` is ignored where unsupported, so it adds protection without
  // ever being the only thing standing between the page and a CSP bypass.
  [
    'content-security-policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' strict-dynamic; " +
      "style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
      "connect-src 'self' ws: wss:; font-src 'self' data:; object-src 'none'; " +
      "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  ],
  // Fetch metadata: a cross-origin request that declares `same-origin` or `none`
  // cannot have been aimed at this API deliberately, and a mutating endpoint can
  // refuse it. The API also requires a credential, which is the primary defence;
  // this is the second one for browsers that send the header.
  ['sec-fetch-site', ''],
];

function dropEmpty(
  headers: ReadonlyArray<readonly [string, string]>,
): Array<readonly [string, string]> {
  return headers.filter(([, value]) => value !== '');
}

/**
 * Builds the middleware.
 *
 * Two rules make it testable rather than declarative:
 *
 *  1. `Access-Control-Allow-Origin` is set only for an origin in the list, and it
 *     is that origin's exact value — never `*` and never a reflected unknown.
 *  2. A preflight for a disallowed origin is answered `403`, not `204` with no
 *     headers. The browser would refuse either, but a 403 makes the refusal
 *     observable to the client and to the log; a silent 204 reads as a working
 *     endpoint until the browser blocks the real request.
 */
export function createSecurityHeaders(options: SecurityHeadersOptions): MiddlewareHandler {
  const allowed = new Set(options.allowedOrigins);
  const allowedHeaders = (options.allowedHeaders ?? DEFAULT_ALLOWED_HEADERS).join(', ');
  const exposedHeaders = (options.exposedHeaders ?? DEFAULT_EXPOSED_HEADERS).join(', ');
  const allowedMethods = (options.allowedMethods ?? DEFAULT_ALLOWED_METHODS).join(', ');
  const maxAge = String(options.maxAgeSeconds ?? 600);
  // Only reflect when the set is large enough to be a policy rather than a single
  // value; `Vary: Origin` on a single-origin API would needlessly defeat caches.
  const vary = options.varyOrigin === true || allowed.size > 1;

  return async (c, next) => {
    const origin = c.req.header('origin');
    const permitted = origin !== undefined && allowed.has(origin);

    if (c.req.method === 'OPTIONS' && origin !== undefined) {
      // Preflight. `access-control-request-method` is what the browser will
      // actually send; its absence means this was not a preflight, and answering
      // one anyway would cache a misleading policy under `max-age`.
      if (c.req.header('access-control-request-method') === undefined) {
        return c.body(null, 204);
      }
      if (!permitted) {
        return c.json(
          { error: { code: 'CORS_ORIGIN_NOT_ALLOWED', message: 'origin not allowed' } },
          403,
        );
      }
      c.header('access-control-allow-origin', origin ?? '');
      c.header('access-control-allow-methods', allowedMethods);
      c.header('access-control-allow-headers', allowedHeaders);
      c.header('access-control-max-age', maxAge);
      c.header('vary', 'Origin');
      return c.body(null, 204);
    }

    await next();

    // Only fill in a header the response does not already carry.
    //
    // A handler that knows its response is a download, or is returning a policy
    // stricter than the baseline, must win. A middleware that overwrote a
    // deliberate header would make that impossible, and the next person would work
    // around the middleware rather than through it.
    const present = c.res.headers;
    for (const [name, value] of dropEmpty(BASE_HEADERS)) {
      if (present.has(name)) continue;
      c.header(name, value);
    }
    if (permitted) {
      c.header('access-control-allow-origin', origin ?? '');
      // Without this the browser discards the response for a credentialed
      // request, and the client sees a network error rather than a 401.
      c.header('access-control-allow-credentials', 'true');
      c.header('access-control-expose-headers', exposedHeaders);
    }
    if (vary) c.header('vary', 'Origin');
  };
}
