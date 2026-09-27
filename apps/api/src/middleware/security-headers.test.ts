import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createSecurityHeaders } from './security-headers.js';

const ALLOWED = 'https://automate.example.test';
const OTHER = 'https://other.example.test';

/** @param {Partial<Parameters<typeof createSecurityHeaders>[0]>} options */
function app(options: Partial<Parameters<typeof createSecurityHeaders>[0]> = {}) {
  return new Hono()
    .use('*', createSecurityHeaders({ allowedOrigins: [ALLOWED], ...options }))
    .get('/api/v1/health', (c) => c.json({ status: 'ok' }))
    .post('/api/v1/runs', (c) => c.json({ id: 'run-1' }, 201));
}

describe('security headers', () => {
  it('sets the baseline headers on a successful response', async () => {
    const response = await app().request('/api/v1/health');
    expect(response.status).toBe(200);
    // Asserted individually with the reason each exists, because a header list
    // assembled from a reference article is the usual way this drifts.
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('permissions-policy')).toContain('camera=()');
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('sets the baseline headers on a refusal as well as a success', async () => {
    const refused = await app().request('/api/v1/nothing-here');
    // A 404 is a response a browser renders, so it needs the same headers as a
    // 200. Setting them only on success is how a 500 page becomes an injection
    // surface — the error page is the one most likely to echo input.
    expect(refused.status).toBe(404);
    expect(refused.headers.get('x-content-type-options')).toBe('nosniff');
    expect(refused.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('lets a handler override a header it is more specific about', async () => {
    const overriding = new Hono()
      .use('*', createSecurityHeaders({ allowedOrigins: [ALLOWED] }))
      .get('/x', (c) => {
        // A handler that knows the response is a download, not a document.
        c.header('content-security-policy', "default-src 'none'; sandbox");
        return c.text('ok');
      });
    const response = await overriding.request('/x');
    // The handler runs inside the middleware, so its value must win: a policy
    // that silently overrode a deliberate one would make the escape hatch
    // impossible, and the next person would work around the middleware instead.
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    // The headers the handler said nothing about are still present.
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });

  it('does not set a pointless sec-fetch-site header', async () => {
    const response = await app().request('/api/v1/health');
    // An empty value is worse than absent: a header with an empty value is a
    // malformed assertion rather than a missing one.
    expect(response.headers.get('sec-fetch-site')).toBeNull();
  });
});

describe('CORS', () => {
  it('allows the configured origin and says credentials are allowed', async () => {
    const response = await app().request('/api/v1/health', { headers: { origin: ALLOWED } });
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    // `Access-Control-Allow-Credentials: true` without this is the difference
    // between a working session and a browser-level network error.
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('exposes the headers a cross-origin client needs to read', async () => {
    const response = await app().request('/api/v1/runs', { headers: { origin: ALLOWED } });
    const exposed = response.headers.get('access-control-expose-headers') ?? '';
    // The idempotency and cursor headers are how a client knows whether a create
    // was a replay and where the next page is. Hidden by default, a cross-origin
    // dashboard cannot implement either.
    expect(exposed).toContain('x-idempotent-replay');
    expect(exposed).toContain('x-next-cursor');
    expect(exposed).toContain('retry-after');
  });

  it('sends no CORS headers at all to an origin that is not allowed', async () => {
    const response = await app().request('/api/v1/health', { headers: { origin: OTHER } });
    expect(response.status).toBe(200);
    // The request itself still executes — this is not a firewall, it is a browser
    // policy — but the browser will refuse to hand the response to the page.
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('never reflects an unknown origin, and never answers with a wildcard', async () => {
    for (const origin of [OTHER, 'null', 'https://automate.example.test.evil.test', '']) {
      const response = await app().request('/api/v1/health', {
        headers: origin === '' ? {} : { origin },
      });
      const allow = response.headers.get('access-control-allow-origin');
      // Reflecting the request's origin is the classic CORS defect: it hands a
      // credentialed session to whatever host the attacker chose.
      expect(allow, `origin ${JSON.stringify(origin)}`).not.toBe(origin || 'null');
      expect(allow).toBeNull();
    }
  });

  it('matches an allowed origin exactly, not by suffix', async () => {
    // The suffix trap: `https://automate.example.test.evil.test` ends with
    // `automate.example.test`, and any endsWith-style allowlist allows it.
    const response = await app().request('/api/v1/health', {
      headers: { origin: 'https://automate.example.test.evil.test' },
    });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();

    const differentPort = await app().request('/api/v1/health', {
      headers: { origin: 'https://automate.example.test:8443' },
    });
    expect(differentPort.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers a preflight for an allowed origin with the policy it will enforce', async () => {
    const response = await app().request('/api/v1/runs', {
      method: 'OPTIONS',
      headers: {
        origin: ALLOWED,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, idempotency-key',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    // `idempotency-key` is not a CORS-safelisted header, so without it in the list
    // every cross-origin run creation fails preflight and the reason is invisible
    // from the server, which logged a successful 204.
    expect(response.headers.get('access-control-allow-headers')).toContain('idempotency-key');
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization');
    expect(response.headers.get('access-control-max-age')).toBe('600');
    expect(response.headers.get('vary')).toBe('Origin');
  });

  it('refuses a preflight from an origin that is not allowed, observably', async () => {
    const response = await app().request('/api/v1/runs', {
      method: 'OPTIONS',
      headers: { origin: OTHER, 'access-control-request-method': 'POST' },
    });
    // 403 rather than a bare 204: the browser refuses either, but a 204 with no
    // headers reads as a working endpoint until the real request fails, and the
    // refusal is then invisible to anyone debugging it.
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CORS_ORIGIN_NOT_ALLOWED');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('does not answer a non-preflight OPTIONS with a CORS policy', async () => {
    // `OPTIONS` without `access-control-request-method` is not a preflight. If it
    // were answered with the full policy, that policy would be cached under
    // `max-age` and applied to preflights nobody made.
    const response = await app().request('/api/v1/runs', {
      method: 'OPTIONS',
      headers: { origin: ALLOWED },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('varies on Origin only when the policy can reflect more than one', async () => {
    const single = await app().request('/api/v1/health', { headers: { origin: ALLOWED } });
    // A single-origin API needs no `Vary`, and adding one would needlessly
    // fragment every cache entry.
    expect(single.headers.get('vary')).toBeNull();

    const several = await app({ allowedOrigins: [ALLOWED, OTHER] }).request('/api/v1/health', {
      headers: { origin: OTHER },
    });
    expect(several.headers.get('access-control-allow-origin')).toBe(OTHER);
    expect(several.headers.get('vary')).toBe('Origin');
  });

  it('allows every listed origin and no other', async () => {
    const both = app({ allowedOrigins: [ALLOWED, OTHER] });
    for (const origin of [ALLOWED, OTHER]) {
      const response = await both.request('/api/v1/health', { headers: { origin } });
      expect(response.headers.get('access-control-allow-origin'), origin).toBe(origin);
    }
    const refused = await both.request('/api/v1/health', {
      headers: { origin: 'https://third.example.test' },
    });
    expect(refused.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('allows the local development origin only when it is listed', async () => {
    const without = await app().request('/api/v1/health', {
      headers: { origin: 'http://localhost:5173' },
    });
    expect(without.headers.get('access-control-allow-origin')).toBeNull();

    const with_ = await app({ allowedOrigins: [ALLOWED, 'http://localhost:5173'] }).request(
      '/api/v1/health',
      { headers: { origin: 'http://localhost:5173' } },
    );
    expect(with_.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });
});
