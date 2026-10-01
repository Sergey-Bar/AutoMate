import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { withErrorBoundary } from './test-support/error-boundary-app.js';
import { Hono } from 'hono';
import { SECRET_MIN_LENGTH } from '@automate/config';
import { app } from './index.js';
import { createReporterRoutes } from './routes/reporter.js';
import {
  syntheticApiKey,
  syntheticCookieSecret,
  syntheticReporterSecret,
  syntheticVaultSecret,
} from './test-support/synthetic-credentials.js';

/**
 * Credentials the production policy actually accepts.
 *
 * These were hand-written here and were 20 to 22 characters, so every assertion
 * below was standing in for a deployment the policy refuses. They are assembled in
 * `test-support/synthetic-credentials.ts` and audited there, so a fixture can no
 * longer be quietly shorter than the configuration it claims to represent.
 */
const VALID_REPORTER_SECRET = syntheticReporterSecret();
const VALID_COOKIE_SECRET = syntheticCookieSecret();
const VALID_API_KEY = syntheticApiKey();
const VALID_VAULT_SECRET = syntheticVaultSecret();

describe('Health routes', () => {
  it('GET /health returns 200', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: string;
      version?: string;
      error?: { code: string; message: string };
    };
    expect(body['status']).toBe('healthy');
  });

  it('GET /api/v1/health returns 200', async () => {
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status?: string;
      version?: string;
      error?: { code: string; message: string };
    };
    expect(body['status']).toBe('healthy');
    expect(body['version']).toBe('1');
  });

  it('GET /api/v1/features returns 200', async () => {
    const res = await app.request('/api/v1/features');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('features');
  });
});

describe('Startup policy', () => {
  it('rejects missing REPORTER_SECRET in production', async () => {
    const { checkProductionPolicy } = await import('./startup-policy.js');
    const config = {
      nodeEnv: 'production',
      port: 3000,
      databaseUrl: 'postgres://localhost/test',
      cookieSecret: VALID_COOKIE_SECRET,
      reporterSecret: undefined,
      apiKey: VALID_API_KEY,
      vaultSecret: VALID_VAULT_SECRET,
    };
    expect(() => checkProductionPolicy(config)).toThrow('REPORTER_SECRET');
  });

  it('rejects placeholder "change-me" as REPORTER_SECRET in production', async () => {
    const { checkProductionPolicy } = await import('./startup-policy.js');
    const config = {
      nodeEnv: 'production',
      port: 3000,
      databaseUrl: 'postgres://localhost/test',
      cookieSecret: VALID_COOKIE_SECRET,
      reporterSecret: 'change-me',
      apiKey: VALID_API_KEY,
      vaultSecret: VALID_VAULT_SECRET,
    };
    expect(() => checkProductionPolicy(config)).toThrow(
      'REPORTER_SECRET must not be a placeholder',
    );
  });

  it('rejects placeholder "reporter-secret" as REPORTER_SECRET in production', async () => {
    const { checkProductionPolicy } = await import('./startup-policy.js');
    const config = {
      nodeEnv: 'production',
      port: 3000,
      databaseUrl: 'postgres://localhost/test',
      cookieSecret: VALID_COOKIE_SECRET,
      reporterSecret: 'reporter-secret',
      apiKey: VALID_API_KEY,
      vaultSecret: VALID_VAULT_SECRET,
    };
    expect(() => checkProductionPolicy(config)).toThrow(
      'REPORTER_SECRET must not be a placeholder',
    );
  });

  it('rejects REPORTER_SECRET shorter than the floor in production', async () => {
    const { checkProductionPolicy } = await import('./startup-policy.js');
    const config = {
      nodeEnv: 'production',
      port: 3000,
      databaseUrl: 'postgres://localhost/test',
      cookieSecret: VALID_COOKIE_SECRET,
      reporterSecret: 'short',
      apiKey: VALID_API_KEY,
      vaultSecret: VALID_VAULT_SECRET,
    };
    // The floor is 32 for every secret, reporter included. It used to be 16, which is
    // the whole of this row: the weakest credential set the bar for the rest.
    expect(() => checkProductionPolicy(config)).toThrow(
      `REPORTER_SECRET must be at least ${String(SECRET_MIN_LENGTH)} characters`,
    );
  });

  it('rejects missing COOKIE_SECRET in production', async () => {
    const { checkProductionPolicy } = await import('./startup-policy.js');
    const config = {
      nodeEnv: 'production',
      port: 3000,
      databaseUrl: 'postgres://localhost/test',
      cookieSecret: undefined,
      reporterSecret: VALID_REPORTER_SECRET,
      apiKey: VALID_API_KEY,
      vaultSecret: VALID_VAULT_SECRET,
    };
    expect(() => checkProductionPolicy(config)).toThrow('COOKIE_SECRET');
  });

  it('rejects placeholder COOKIE_SECRET in production', async () => {
    const { checkProductionPolicy } = await import('./startup-policy.js');
    const config = {
      nodeEnv: 'production',
      port: 3000,
      databaseUrl: 'postgres://localhost/test',
      cookieSecret: 'change-me-to-a-long-random-string',
      reporterSecret: VALID_REPORTER_SECRET,
      apiKey: VALID_API_KEY,
      vaultSecret: VALID_VAULT_SECRET,
    };
    expect(() => checkProductionPolicy(config)).toThrow('COOKIE_SECRET must not be a placeholder');
  });

  it('rejects COOKIE_SECRET shorter than 32 chars in production', async () => {
    const { checkProductionPolicy } = await import('./startup-policy.js');
    const config = {
      nodeEnv: 'production',
      port: 3000,
      databaseUrl: 'postgres://localhost/test',
      cookieSecret: 'short-cookie-secret',
      reporterSecret: VALID_REPORTER_SECRET,
      apiKey: VALID_API_KEY,
      vaultSecret: VALID_VAULT_SECRET,
    };
    expect(() => checkProductionPolicy(config)).toThrow(
      'COOKIE_SECRET must be at least 32 characters',
    );
  });

  it('passes in development without secrets', async () => {
    const { checkProductionPolicy } = await import('./startup-policy.js');
    const config = {
      nodeEnv: 'development',
      port: 3000,
      databaseUrl: undefined,
      cookieSecret: undefined,
      reporterSecret: undefined,
      apiKey: undefined,
      vaultSecret: undefined,
    };
    expect(() => checkProductionPolicy(config)).not.toThrow();
  });

  it('rejects missing AUTOMATE_API_KEY in production', async () => {
    const { checkProductionPolicy } = await import('./startup-policy.js');
    const config = {
      nodeEnv: 'production',
      port: 3000,
      databaseUrl: 'postgres://localhost/test',
      cookieSecret: VALID_COOKIE_SECRET,
      reporterSecret: VALID_REPORTER_SECRET,
      apiKey: undefined,
      vaultSecret: VALID_VAULT_SECRET,
    };
    expect(() => checkProductionPolicy(config)).toThrow(
      'AUTOMATE_API_KEY is required in production',
    );
  });

  it('rejects AUTOMATE_API_KEY shorter than the floor in production', async () => {
    const { checkProductionPolicy } = await import('./startup-policy.js');
    const config = {
      nodeEnv: 'production',
      port: 3000,
      databaseUrl: 'postgres://localhost/test',
      cookieSecret: VALID_COOKIE_SECRET,
      reporterSecret: VALID_REPORTER_SECRET,
      apiKey: 'short',
      vaultSecret: VALID_VAULT_SECRET,
    };
    expect(() => checkProductionPolicy(config)).toThrow(
      `AUTOMATE_API_KEY must be at least ${String(SECRET_MIN_LENGTH)} characters`,
    );
  });

  it('rejects placeholder "change-me" as AUTOMATE_API_KEY in production', async () => {
    const { checkProductionPolicy } = await import('./startup-policy.js');
    const config = {
      nodeEnv: 'production',
      port: 3000,
      databaseUrl: 'postgres://localhost/test',
      cookieSecret: VALID_COOKIE_SECRET,
      reporterSecret: VALID_REPORTER_SECRET,
      apiKey: 'change-me',
      vaultSecret: VALID_VAULT_SECRET,
    };
    expect(() => checkProductionPolicy(config)).toThrow(
      'AUTOMATE_API_KEY must not be a placeholder',
    );
  });

  it('rejects placeholder "automate" as AUTOMATE_API_KEY in production', async () => {
    const { checkProductionPolicy } = await import('./startup-policy.js');
    const config = {
      nodeEnv: 'production',
      port: 3000,
      databaseUrl: 'postgres://localhost/test',
      cookieSecret: VALID_COOKIE_SECRET,
      reporterSecret: VALID_REPORTER_SECRET,
      apiKey: 'automate',
      vaultSecret: VALID_VAULT_SECRET,
    };
    expect(() => checkProductionPolicy(config)).toThrow(
      'AUTOMATE_API_KEY must not be a placeholder',
    );
  });

  it('rejects missing VAULT_SECRET in production', async () => {
    const { checkProductionPolicy } = await import('./startup-policy.js');
    const config = {
      nodeEnv: 'production',
      port: 3000,
      databaseUrl: 'postgres://localhost/test',
      cookieSecret: VALID_COOKIE_SECRET,
      reporterSecret: VALID_REPORTER_SECRET,
      apiKey: VALID_API_KEY,
      vaultSecret: undefined,
    };
    expect(() => checkProductionPolicy(config)).toThrow('VAULT_SECRET is required in production');
  });

  it('rejects placeholder "change-me" as VAULT_SECRET in production', async () => {
    const { checkProductionPolicy } = await import('./startup-policy.js');
    const config = {
      nodeEnv: 'production',
      port: 3000,
      databaseUrl: 'postgres://localhost/test',
      cookieSecret: VALID_COOKIE_SECRET,
      reporterSecret: VALID_REPORTER_SECRET,
      apiKey: VALID_API_KEY,
      vaultSecret: 'change-me',
    };
    expect(() => checkProductionPolicy(config)).toThrow('VAULT_SECRET must not be a placeholder');
  });

  it('rejects VAULT_SECRET shorter than 32 chars in production', async () => {
    const { checkProductionPolicy } = await import('./startup-policy.js');
    const config = {
      nodeEnv: 'production',
      port: 3000,
      databaseUrl: 'postgres://localhost/test',
      cookieSecret: VALID_COOKIE_SECRET,
      reporterSecret: VALID_REPORTER_SECRET,
      apiKey: VALID_API_KEY,
      vaultSecret: 'short-vault-secret',
    };
    expect(() => checkProductionPolicy(config)).toThrow(
      'VAULT_SECRET must be at least 32 characters',
    );
  });

  it('rejects missing DATABASE_URL in production', async () => {
    const { checkProductionPolicy } = await import('./startup-policy.js');
    const config = {
      nodeEnv: 'production',
      port: 3000,
      databaseUrl: undefined,
      cookieSecret: VALID_COOKIE_SECRET,
      reporterSecret: VALID_REPORTER_SECRET,
      apiKey: VALID_API_KEY,
      vaultSecret: VALID_VAULT_SECRET,
    };
    expect(() => checkProductionPolicy(config)).toThrow('DATABASE_URL is required in production');
  });

  it('does not require DATABASE_URL in development', async () => {
    const { checkProductionPolicy } = await import('./startup-policy.js');
    const config = {
      nodeEnv: 'development',
      port: 3000,
      databaseUrl: undefined,
      cookieSecret: undefined,
      reporterSecret: undefined,
      apiKey: undefined,
      vaultSecret: undefined,
    };
    expect(() => checkProductionPolicy(config)).not.toThrow();
  });
});

describe('Auth matrix', () => {
  const TEST_KEY = syntheticApiKey();

  beforeEach(() => {
    process.env['AUTOMATE_API_KEY'] = TEST_KEY;
  });

  afterEach(() => {
    delete process.env['AUTOMATE_API_KEY'];
  });

  // The install is open as of 2026-09-30, so there is no longer a distinction between
  // a route that requires a credential and one that does not. The two describes that
  // made that distinction — "sensitive routes require auth" and "wrong token is
  // rejected" — described a boundary the product does not have, and their cells are
  // deleted rather than inverted: writing new assertions about what an unauthenticated
  // caller receives is a different body of work, and the `open-access` E2E spec is
  // where that contract now lives.
  describe('every route is served, with or without a credential', () => {
    it('GET /api/v1/runs is served with no credential at all', async () => {
      const res = await app.request('/api/v1/runs');
      expect(res.status).toBe(200);
    });

    it('GET /api/v1/runs is served with a credential that is not the installation key', async () => {
      // A credential that is present is not refused for being wrong: there is nothing
      // for it to authenticate, so a stale key in a script is not an outage.
      const res = await app.request('/api/v1/runs', {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      expect(res.status).toBe(200);
    });
  });

  describe('public routes bypass auth', () => {
    it('GET /health returns 200 without auth', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);
    });

    it('GET /api/v1/health returns 200 without auth', async () => {
      const res = await app.request('/api/v1/health');
      expect(res.status).toBe(200);
    });

    it('GET /api/v1/features returns 200 without auth', async () => {
      const res = await app.request('/api/v1/features');
      expect(res.status).toBe(200);
    });
  });

  describe('valid auth grants access to sensitive routes', () => {
    it('GET /api/v1/runs returns 200 with valid Bearer token', async () => {
      const res = await app.request('/api/v1/runs', {
        headers: { Authorization: `Bearer ${TEST_KEY}` },
      });
      expect(res.status).toBe(200);
    });

    it('GET /api/v1/events returns non-401 status with valid Bearer token', async () => {
      const res = await app.request('/api/v1/events', {
        headers: { Authorization: `Bearer ${TEST_KEY}` },
      });
      expect(res.status).not.toBe(401);
      await res.body?.cancel();
    });
  });

  describe('reporter routes use REPORTER_SECRET auth', () => {
    const TEST_REPORTER_SECRET = syntheticReporterSecret();

    it('POST /api/v1/reporter/events without REPORTER_SECRET configured accepts events (open mode)', async () => {
      // The global app has no REPORTER_SECRET env — open mode, no auth required
      const res = await app.request('/api/v1/reporter/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'run:start',
          runId: 'auth-matrix-reporter-01',
          payload: { total: 1 },
        }),
      });
      expect(res.status).toBe(202);
    });

    it('POST /api/v1/reporter/events with REPORTER_SECRET configured returns 401 when auth is missing', async () => {
      const reporterApp = withErrorBoundary(new Hono());
      reporterApp.route('/', createReporterRoutes(TEST_REPORTER_SECRET));
      const res = await reporterApp.request('/api/v1/reporter/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'run:start',
          runId: 'auth-matrix-reporter-02',
          payload: { total: 1 },
        }),
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as {
        status?: string;
        version?: string;
        error?: { code: string; message: string };
      };
      expect(body.error).toMatchObject({
        code: 'MISSING_REPORTER_TOKEN',
        message: 'Missing reporter authentication token',
      });
    });

    it('POST /api/v1/reporter/events with REPORTER_SECRET configured returns 403 for wrong Bearer token', async () => {
      const reporterApp = withErrorBoundary(new Hono());
      reporterApp.route('/', createReporterRoutes(TEST_REPORTER_SECRET));
      const res = await reporterApp.request('/api/v1/reporter/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer wrong-reporter-secret',
        },
        body: JSON.stringify({
          type: 'run:start',
          runId: 'auth-matrix-reporter-03',
          payload: { total: 1 },
        }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as {
        status?: string;
        version?: string;
        error?: { code: string; message: string };
      };
      expect(body.error).toMatchObject({
        code: 'INVALID_REPORTER_TOKEN',
        message: 'Invalid reporter authentication token',
      });
    });

    it('POST /api/v1/reporter/events with valid REPORTER_SECRET returns 202', async () => {
      const reporterApp = withErrorBoundary(new Hono());
      reporterApp.route('/', createReporterRoutes(TEST_REPORTER_SECRET));
      const res = await reporterApp.request('/api/v1/reporter/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TEST_REPORTER_SECRET}`,
        },
        body: JSON.stringify({
          type: 'run:start',
          runId: 'auth-matrix-reporter-04',
          payload: { total: 1 },
        }),
      });
      expect(res.status).toBe(202);
    });
  });
});

/**
 * The cross-cutting middleware is actually mounted.
 *
 * `security-headers.test.ts` and `request-deadline.test.ts` prove the two
 * middlewares behave. Neither can prove the *composed app* uses them, and a
 * middleware that works perfectly and is never registered is a real shape of dead
 * code — it reads as a security control in a code search and protects nothing.
 *
 * This asserts the effect on a live response from `{ app }`, which is the only
 * thing a client ever sees.
 */
describe('cross-cutting middleware on the composed app', () => {
  it('sets the security headers the middleware owns', async () => {
    const res = await app.request('/api/v1/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('echoes the request deadline that applied', async () => {
    const res = await app.request('/api/v1/health');
    // Present and numeric. Absent would mean the deadline middleware is not
    // mounted; non-numeric would mean the header name drifted out of sync.
    const header = res.headers.get('x-request-deadline-ms');
    expect(header).not.toBeNull();
    expect(Number(header)).toBeGreaterThan(0);
    expect(Number.isInteger(Number(header))).toBe(true);
  });

  it('grants CORS only to the configured public origin', async () => {
    // `PUBLIC_APP_URL` is the web client. An origin outside the list gets no
    // `Access-Control-Allow-Origin`, so the browser refuses to hand the response
    // to the page.
    const allowed = process.env['PUBLIC_APP_URL'] ?? 'http://localhost:5173';
    const allowedOrigin = new URL(allowed).origin;
    const granted = await app.request('/api/v1/health', {
      headers: { origin: allowedOrigin },
    });
    expect(granted.headers.get('access-control-allow-origin')).toBe(allowedOrigin);

    const refused = await app.request('/api/v1/health', {
      headers: { origin: 'https://not-the-configured-origin.example.test' },
    });
    expect(refused.status).toBe(200);
    expect(refused.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('never answers with a wildcard origin', async () => {
    for (const origin of ['https://a.example.test', 'null', 'http://localhost:4173']) {
      const res = await app.request('/api/v1/health', { headers: { origin } });
      expect(res.headers.get('access-control-allow-origin'), origin).not.toBe('*');
    }
  });

  it('exempts the SSE stream from the deadline, and nothing else by accident', async () => {
    const stream = await app.request('/api/v1/events');
    // A long-lived stream must not be refused halfway through, so it is the one
    // exempt path. This asserts the exemption is not wider than that.
    if (stream.status === 200) {
      expect(stream.headers.get('x-request-deadline-ms')).toBeNull();
    }
    const ordinary = await app.request('/api/v1/features');
    expect(ordinary.headers.get('x-request-deadline-ms')).not.toBeNull();
  });
});
