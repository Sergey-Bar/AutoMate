import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { app } from './index.js';
import { createReporterRoutes } from './routes/reporter.js';

// A reporter secret that passes all production checks (not a placeholder, ≥ 16 chars).
const VALID_REPORTER_SECRET = 'valid-reporter-secret-x';
const VALID_COOKIE_SECRET = 'valid-cookie-secret-that-is-long-enough';

describe('Health routes', () => {
  it('GET /health returns 200', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, string>;
    expect(body['status']).toBe('healthy');
  });

  it('GET /api/v1/health returns 200', async () => {
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, string>;
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
      apiKey: 'a-valid-api-key-here',
      vaultSecret: 'a-valid-vault-secret-32chars-min!!',
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
      apiKey: 'a-valid-api-key-here',
      vaultSecret: 'a-valid-vault-secret-32chars-min!!',
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
      apiKey: 'a-valid-api-key-here',
      vaultSecret: 'a-valid-vault-secret-32chars-min!!',
    };
    expect(() => checkProductionPolicy(config)).toThrow(
      'REPORTER_SECRET must not be a placeholder',
    );
  });

  it('rejects REPORTER_SECRET shorter than 16 chars in production', async () => {
    const { checkProductionPolicy } = await import('./startup-policy.js');
    const config = {
      nodeEnv: 'production',
      port: 3000,
      databaseUrl: 'postgres://localhost/test',
      cookieSecret: VALID_COOKIE_SECRET,
      reporterSecret: 'short',
      apiKey: 'a-valid-api-key-here',
      vaultSecret: 'a-valid-vault-secret-32chars-min!!',
    };
    expect(() => checkProductionPolicy(config)).toThrow(
      'REPORTER_SECRET must be at least 16 characters',
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
      apiKey: 'a-valid-api-key-here',
      vaultSecret: 'a-valid-vault-secret-32chars-min!!',
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
      apiKey: 'a-valid-api-key-here',
      vaultSecret: 'a-valid-vault-secret-32chars-min!!',
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
      apiKey: 'a-valid-api-key-here',
      vaultSecret: 'a-valid-vault-secret-32chars-min!!',
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
      vaultSecret: 'a-valid-vault-secret-32chars-min!!',
    };
    expect(() => checkProductionPolicy(config)).toThrow(
      'AUTOMATE_API_KEY is required in production',
    );
  });

  it('rejects AUTOMATE_API_KEY shorter than 16 chars in production', async () => {
    const { checkProductionPolicy } = await import('./startup-policy.js');
    const config = {
      nodeEnv: 'production',
      port: 3000,
      databaseUrl: 'postgres://localhost/test',
      cookieSecret: VALID_COOKIE_SECRET,
      reporterSecret: VALID_REPORTER_SECRET,
      apiKey: 'short',
      vaultSecret: 'a-valid-vault-secret-32chars-min!!',
    };
    expect(() => checkProductionPolicy(config)).toThrow(
      'AUTOMATE_API_KEY must be at least 16 characters',
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
      vaultSecret: 'a-valid-vault-secret-32chars-min!!',
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
      vaultSecret: 'a-valid-vault-secret-32chars-min!!',
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
      apiKey: 'a-valid-api-key-here',
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
      apiKey: 'a-valid-api-key-here',
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
      apiKey: 'a-valid-api-key-here',
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
      apiKey: 'a-valid-api-key-here',
      vaultSecret: 'a-valid-vault-secret-32chars-min!!',
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
  const TEST_KEY = 'test-api-key-for-testing';

  beforeEach(() => {
    process.env['AUTOMATE_API_KEY'] = TEST_KEY;
  });

  afterEach(() => {
    delete process.env['AUTOMATE_API_KEY'];
  });

  describe('sensitive routes require auth', () => {
    it('GET /api/v1/runs returns 401 without auth', async () => {
      const res = await app.request('/api/v1/runs');
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, string>;
      expect(body['error']).toBe('Unauthorized');
    });

    it('GET /api/v1/dashboard/runs/:id returns 401 without auth', async () => {
      const res = await app.request('/api/v1/dashboard/runs/some-run-id');
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, string>;
      expect(body['error']).toBe('Unauthorized');
    });

    it('GET /api/v1/events returns 401 without auth', async () => {
      const res = await app.request('/api/v1/events');
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, string>;
      expect(body['error']).toBe('Unauthorized');
    });

    it('GET /api/v1/orchestrator/conversations returns 401 without auth', async () => {
      const res = await app.request('/api/v1/orchestrator/conversations');
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, string>;
      expect(body['error']).toBe('Unauthorized');
    });

    it('GET /api/v1/vault/credentials returns 401 without auth', async () => {
      const res = await app.request('/api/v1/vault/credentials');
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, string>;
      expect(body['error']).toBe('Unauthorized');
    });

    it('GET /api/v1/connectors returns 401 without auth', async () => {
      const res = await app.request('/api/v1/connectors');
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, string>;
      expect(body['error']).toBe('Unauthorized');
    });

    it('POST /api/v1/agents/browser/generate returns 401 without auth', async () => {
      const res = await app.request('/api/v1/agents/browser/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'generate a login test' }),
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, string>;
      expect(body['error']).toBe('Unauthorized');
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

  describe('wrong token is rejected', () => {
    const WRONG_AUTH = 'Bearer wrong-token';

    it('GET /api/v1/runs returns 401 with wrong Bearer token', async () => {
      const res = await app.request('/api/v1/runs', {
        headers: { Authorization: WRONG_AUTH },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, string>;
      expect(body['error']).toBe('Unauthorized');
    });

    it('GET /api/v1/events returns 401 with wrong Bearer token', async () => {
      const res = await app.request('/api/v1/events', {
        headers: { Authorization: WRONG_AUTH },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, string>;
      expect(body['error']).toBe('Unauthorized');
    });

    it('GET /api/v1/dashboard/runs/:id returns 401 with wrong Bearer token', async () => {
      const res = await app.request('/api/v1/dashboard/runs/any-id', {
        headers: { Authorization: WRONG_AUTH },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, string>;
      expect(body['error']).toBe('Unauthorized');
    });
  });

  describe('reporter routes use REPORTER_SECRET auth', () => {
    const TEST_REPORTER_SECRET = 'test-reporter-secret-x';

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
      const reporterApp = new Hono();
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
      const body = (await res.json()) as Record<string, string>;
      expect(body['error']).toBe('Missing reporter authentication token');
    });

    it('POST /api/v1/reporter/events with REPORTER_SECRET configured returns 403 for wrong Bearer token', async () => {
      const reporterApp = new Hono();
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
      const body = (await res.json()) as Record<string, string>;
      expect(body['error']).toBe('Invalid reporter authentication token');
    });

    it('POST /api/v1/reporter/events with valid REPORTER_SECRET returns 202', async () => {
      const reporterApp = new Hono();
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

describe('Shared repository — reporter and runs routes see same state', () => {
  const TEST_KEY = 'test-api-key-for-testing';

  beforeEach(() => {
    process.env['AUTOMATE_API_KEY'] = TEST_KEY;
  });

  afterEach(() => {
    delete process.env['AUTOMATE_API_KEY'];
  });

  it('run posted via reporter is visible in GET /api/v1/runs', async () => {
    // POST a run:start via reporter
    const postRes = await app.request('/api/v1/reporter/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'run:start',
        runId: 'shared-repo-run-001',
        payload: { total: 3 },
      }),
    });
    expect(postRes.status).toBe(202);

    // GET the runs list with auth
    const listRes = await app.request('/api/v1/runs', {
      headers: { Authorization: `Bearer ${TEST_KEY}` },
    });
    expect(listRes.status).toBe(200);
    const body = (await listRes.json()) as Array<{ id: string }>;
    const ids = body.map((r) => r.id);
    expect(ids).toContain('shared-repo-run-001');
  });
});

/**
 * The cross-cutting middleware is actually mounted.
 *
 * `security-headers.test.ts` and `request-deadline.test.ts` prove the two
 * middlewares behave. Neither can prove the *composed app* uses them, and a
 * middleware that works perfectly and is never registered is a real shape of dead
 * code � it reads as a security control in a code search and protects nothing.
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
