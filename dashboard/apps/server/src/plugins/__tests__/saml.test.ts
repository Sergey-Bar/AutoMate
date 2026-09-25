/**
 * Tests for plugins/saml.ts — SAML 2.0 SSO integration
 *
 * Covers:
 *  - GET  /api/auth/saml/status  → { configured: boolean }
 *  - GET  /api/auth/saml/login   → redirect to IdP (requires sso flag + SAML config)
 *  - POST /api/auth/saml/callback → validate assertion, find/create user, set cookie
 *  - buildSamlInstance() helper returns null when config is absent
 *  - findOrCreateSsoUser() creates new user / reuses existing by email or samlSubject
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  mockValidatePostResponseAsync,
  mockGetAuthorizeUrlAsync,
  mockDbSelect,
  mockDbInsert,
  mockDbUpdate,
  mockGenerateSessionToken,
  mockLogAuditEvent,
  mockRequireFeature,
  mockGetCookieSecret,
} = vi.hoisted(() => ({
  mockValidatePostResponseAsync: vi.fn(),
  mockGetAuthorizeUrlAsync: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockGenerateSessionToken: vi.fn<(keyId: string) => string>(),
  mockLogAuditEvent: vi.fn(),
  mockRequireFeature: vi.fn(),
  mockGetCookieSecret: vi.fn<() => string>(),
}));

// Mock @node-saml/node-saml — SAML is a named export class
vi.mock('@node-saml/node-saml', () => {
  function MockSAML() {
    this.validatePostResponseAsync = mockValidatePostResponseAsync;
    this.getAuthorizeUrlAsync = mockGetAuthorizeUrlAsync;
  }
  return {
    SAML: MockSAML,
    // Enum used in buildSamlInstance() — provide matching string values
    ValidateInResponseTo: { never: 'never', ifPresent: 'ifPresent', always: 'always' },
  };
});

// Mock the DB client
vi.mock('../../db/client.js', () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
  },
  sqlite: { prepare: vi.fn() },
  poolConnection: { query: vi.fn() },
  isPostgres: false,
}));

// Mock DB schema (just needs to export users for eq() comparisons)
vi.mock('../../db/schema.js', () => ({
  users: { id: 'id', email: 'email', samlSubject: 'saml_subject', displayName: 'display_name', updatedAt: 'updated_at' },
}));

// Mock drizzle-orm eq/or — identity function is sufficient since we only check calls
vi.mock('drizzle-orm', () => ({
  eq: (field: unknown, val: unknown) => ({ field, val }),
  or: (...args: unknown[]) => ({ or: args }),
}));

// Mock auth services
vi.mock('../../services/auth.js', () => ({
  generateSessionToken: mockGenerateSessionToken,
  getCookieSecret: mockGetCookieSecret,
  SESSION_COOKIE_NAME: 'automate_dashboard_session',
}));

// Mock audit service
vi.mock('../../services/audit.js', () => ({
  logAuditEvent: mockLogAuditEvent,
}));

// Mock requireFeature — default pass-through (returns a no-op preHandler)
vi.mock('../../services/feature-flags.js', () => ({
  requireFeature: mockRequireFeature,
}));

// Mock constants
vi.mock('../../constants.js', () => ({
  SESSION_MAX_AGE_SECONDS: 86400,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  mockDbSelect.mockReturnValue(chain);
  return chain;
}

function makeInsertChain() {
  const chain = { values: vi.fn().mockResolvedValue({ rowsAffected: 1 }) };
  mockDbInsert.mockReturnValue(chain);
  return chain;
}

function makeUpdateChain() {
  const setChain = { where: vi.fn().mockResolvedValue({ rowsAffected: 1 }) };
  const chain = { set: vi.fn().mockReturnValue(setChain) };
  mockDbUpdate.mockReturnValue(chain);
  return chain;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie, { secret: 'test-secret' });

  const { registerSamlPlugin } = await import('../saml.js');
  await registerSamlPlugin(app);
  await app.ready();
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('plugins/saml.ts', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: requireFeature passes (no-op preHandler)
    mockRequireFeature.mockReturnValue(async () => { /* pass */ });
    mockGetCookieSecret.mockReturnValue('test-cookie-secret');
    mockGenerateSessionToken.mockReturnValue('user-id:1234567890:abc123sig');

    // Default: SSO config absent
    delete process.env.SAML_ENTRY_POINT;
    delete process.env.SAML_ISSUER;
    delete process.env.SAML_CERT;
    delete process.env.SAML_CALLBACK_URL;
    delete process.env.SAML_DEFAULT_ROLE;
  });

  afterEach(async () => {
    await app?.close();
  });

  // ── /api/auth/saml/status ─────────────────────────────────────────────────
  describe('GET /api/auth/saml/status', () => {
    it('returns { configured: false } when SAML env vars are absent', async () => {
      app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/auth/saml/status' });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ configured: false });
    });

    it('returns { configured: true } when all SAML env vars are set', async () => {
      process.env.SAML_ENTRY_POINT = 'https://idp.example.com/sso';
      process.env.SAML_ISSUER = 'https://app.example.com';
      process.env.SAML_CERT = 'LS0tLS1CRUdJTi=='; // fake base64
      process.env.SAML_CALLBACK_URL = 'https://app.example.com/api/auth/saml/callback';
      app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/auth/saml/status' });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ configured: true });
    });

    it('returns { configured: false } when only some env vars are set', async () => {
      process.env.SAML_ENTRY_POINT = 'https://idp.example.com/sso';
      // Missing SAML_ISSUER, SAML_CERT, SAML_CALLBACK_URL
      app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/auth/saml/status' });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ configured: false });
    });
  });

  // ── /api/auth/saml/login ──────────────────────────────────────────────────
  describe('GET /api/auth/saml/login', () => {
    it('returns 503 when SAML is not configured', async () => {
      app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/auth/saml/login' });
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body)).toMatchObject({ error: 'SSO is not configured' });
    });

    it('redirects to IdP when SAML is configured', async () => {
      process.env.SAML_ENTRY_POINT = 'https://idp.example.com/sso';
      process.env.SAML_ISSUER = 'https://app.example.com';
      process.env.SAML_CERT = '-----BEGIN CERTIFICATE-----\nMIIBc\n-----END CERTIFICATE-----';
      process.env.SAML_CALLBACK_URL = 'https://app.example.com/api/auth/saml/callback';
      mockGetAuthorizeUrlAsync.mockResolvedValue('https://idp.example.com/sso?SAMLRequest=abc');
      app = await buildApp();

      const res = await app.inject({ method: 'GET', url: '/api/auth/saml/login' });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('https://idp.example.com/sso?SAMLRequest=abc');
    });
  });

  // ── /api/auth/saml/callback ───────────────────────────────────────────────
  describe('POST /api/auth/saml/callback', () => {
    beforeEach(() => {
      process.env.SAML_ENTRY_POINT = 'https://idp.example.com/sso';
      process.env.SAML_ISSUER = 'https://app.example.com';
      process.env.SAML_CERT = '-----BEGIN CERTIFICATE-----\nMIIBc\n-----END CERTIFICATE-----';
      process.env.SAML_CALLBACK_URL = 'https://app.example.com/api/auth/saml/callback';
    });

    it('returns 503 when SAML config is absent at callback time', async () => {
      delete process.env.SAML_ENTRY_POINT;
      app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/saml/callback',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'SAMLResponse=abc',
      });
      expect(res.statusCode).toBe(503);
    });

    it('returns 400 when SAMLResponse body is missing', async () => {
      app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/saml/callback',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: '',
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body)).toMatchObject({ error: 'Missing SAMLResponse' });
    });

    it('returns 401 when SAML assertion validation fails', async () => {
      mockValidatePostResponseAsync.mockRejectedValue(new Error('Invalid signature'));
      app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/saml/callback',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'SAMLResponse=invalidbase64',
      });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body)).toMatchObject({ error: 'Invalid SAML assertion' });
    });

    it('returns 400 when profile is missing nameID or email', async () => {
      mockValidatePostResponseAsync.mockResolvedValue({
        profile: { nameID: '', email: '' },
      });
      app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/saml/callback',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'SAMLResponse=valid',
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body)).toMatchObject({ error: 'SSO profile missing required fields (nameID, email)' });
    });

    it('creates new user and sets session cookie on first SSO login', async () => {
      mockValidatePostResponseAsync.mockResolvedValue({
        profile: { nameID: 'uid-123', email: 'alice@example.com', displayName: 'Alice' },
      });
      // select returns empty (no existing user)
      makeSelectChain([]);
      makeInsertChain();

      app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/saml/callback',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'SAMLResponse=valid',
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/');
      expect(res.headers['set-cookie']).toBeDefined();
      expect(mockDbInsert).toHaveBeenCalledTimes(1);
      const insertArgs = mockDbInsert.mock.results[0].value.values.mock.calls[0][0];
      expect(insertArgs).toMatchObject({
        email: 'alice@example.com',
        displayName: 'Alice',
        samlSubject: 'uid-123',
        role: 'viewer', // default
      });
    });

    it('reuses existing user matched by email on first SSO login', async () => {
      const existingUser = { id: 'existing-user-id', role: 'editor' as const, samlSubject: null };
      makeSelectChain([existingUser]);
      makeUpdateChain(); // backfill samlSubject

      mockValidatePostResponseAsync.mockResolvedValue({
        profile: { nameID: 'uid-new', email: 'bob@example.com', displayName: 'Bob' },
      });

      app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/saml/callback',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'SAMLResponse=valid',
      });

      expect(res.statusCode).toBe(302);
      expect(mockDbInsert).not.toHaveBeenCalled();
      expect(mockDbUpdate).toHaveBeenCalledTimes(1); // backfill samlSubject
      expect(mockGenerateSessionToken).toHaveBeenCalledWith('existing-user-id');
    });

    it('reuses existing user matched by samlSubject on subsequent logins', async () => {
      const existingUser = { id: 'existing-user-id', role: 'admin' as const, samlSubject: 'uid-123' };
      makeSelectChain([existingUser]);

      mockValidatePostResponseAsync.mockResolvedValue({
        profile: { nameID: 'uid-123', email: 'carol@example.com', displayName: 'Carol' },
      });

      app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/saml/callback',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'SAMLResponse=valid',
      });

      expect(res.statusCode).toBe(302);
      expect(mockDbInsert).not.toHaveBeenCalled();
      expect(mockDbUpdate).not.toHaveBeenCalled(); // samlSubject already set
      expect(mockGenerateSessionToken).toHaveBeenCalledWith('existing-user-id');
    });

    it('respects SAML_DEFAULT_ROLE for new users', async () => {
      process.env.SAML_DEFAULT_ROLE = 'admin';
      mockValidatePostResponseAsync.mockResolvedValue({
        profile: { nameID: 'uid-admin', email: 'admin@example.com', displayName: 'Admin' },
      });
      makeSelectChain([]);
      makeInsertChain();

      app = await buildApp();
      await app.inject({
        method: 'POST',
        url: '/api/auth/saml/callback',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'SAMLResponse=valid',
      });

      const insertArgs = mockDbInsert.mock.results[0].value.values.mock.calls[0][0];
      expect(insertArgs.role).toBe('admin');
    });

    it('falls back to viewer for invalid SAML_DEFAULT_ROLE', async () => {
      process.env.SAML_DEFAULT_ROLE = 'superuser'; // invalid
      mockValidatePostResponseAsync.mockResolvedValue({
        profile: { nameID: 'uid-su', email: 'su@example.com', displayName: 'SU' },
      });
      makeSelectChain([]);
      makeInsertChain();

      app = await buildApp();
      await app.inject({
        method: 'POST',
        url: '/api/auth/saml/callback',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'SAMLResponse=valid',
      });

      const insertArgs = mockDbInsert.mock.results[0].value.values.mock.calls[0][0];
      expect(insertArgs.role).toBe('viewer');
    });

    it('extracts email from Azure AD claim when standard email field is absent', async () => {
      mockValidatePostResponseAsync.mockResolvedValue({
        profile: {
          nameID: 'uid-azure',
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress': 'dave@company.com',
          'http://schemas.microsoft.com/identity/claims/displayname': 'Dave',
        },
      });
      makeSelectChain([]);
      makeInsertChain();

      app = await buildApp();
      await app.inject({
        method: 'POST',
        url: '/api/auth/saml/callback',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'SAMLResponse=valid',
      });

      const insertArgs = mockDbInsert.mock.results[0].value.values.mock.calls[0][0];
      expect(insertArgs.email).toBe('dave@company.com');
      expect(insertArgs.displayName).toBe('Dave');
    });

    it('writes an audit event on successful SSO login', async () => {
      mockValidatePostResponseAsync.mockResolvedValue({
        profile: { nameID: 'uid-audit', email: 'audit@example.com', displayName: 'Audit' },
      });
      makeSelectChain([]);
      makeInsertChain();

      app = await buildApp();
      await app.inject({
        method: 'POST',
        url: '/api/auth/saml/callback',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'SAMLResponse=valid',
      });

      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.sso.login' }),
      );
    });

    it('returns 400 when SAML response profile is null', async () => {
      // Covers result.profile ?? {} branch (profile itself is null/undefined)
      mockValidatePostResponseAsync.mockResolvedValue({ profile: null });
      app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/saml/callback',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'SAMLResponse=valid',
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body)).toMatchObject({ error: 'SSO profile missing required fields (nameID, email)' });
    });

    it('falls back displayName to email when no name claim fields are present', async () => {
      // Covers the final ?? email fallback in displayName extraction
      mockValidatePostResponseAsync.mockResolvedValue({
        profile: {
          nameID: 'uid-nodisplay',
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress': 'nodisplay@company.com',
          // no displayName, no Azure displayName claim
        },
      });
      makeSelectChain([]);
      makeInsertChain();

      app = await buildApp();
      await app.inject({
        method: 'POST',
        url: '/api/auth/saml/callback',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'SAMLResponse=valid',
      });

      const insertArgs = mockDbInsert.mock.results[0].value.values.mock.calls[0][0];
      expect(insertArgs.email).toBe('nodisplay@company.com');
      expect(insertArgs.displayName).toBe('nodisplay@company.com'); // falls back to email
    });
  });

  // ── buildSamlInstance() ───────────────────────────────────────────────────
  describe('buildSamlInstance()', () => {
    it('returns null when any required env var is absent', async () => {
      const { buildSamlInstance } = await import('../saml.js');
      expect(buildSamlInstance()).toBeNull();
    });

    it('returns a SAML instance when all env vars are set', async () => {
      process.env.SAML_ENTRY_POINT = 'https://idp.example.com/sso';
      process.env.SAML_ISSUER = 'https://app.example.com';
      process.env.SAML_CERT = '-----BEGIN CERTIFICATE-----\nMIIBc\n-----END CERTIFICATE-----';
      process.env.SAML_CALLBACK_URL = 'https://app.example.com/callback';
      const { buildSamlInstance } = await import('../saml.js');
      expect(buildSamlInstance()).not.toBeNull();
    });

    it('accepts base64-encoded certificate', async () => {
      process.env.SAML_ENTRY_POINT = 'https://idp.example.com/sso';
      process.env.SAML_ISSUER = 'https://app.example.com';
      // Base64 of a fake PEM cert
      process.env.SAML_CERT = Buffer.from('-----BEGIN CERTIFICATE-----\nMIIBc\n-----END CERTIFICATE-----').toString('base64');
      process.env.SAML_CALLBACK_URL = 'https://app.example.com/callback';
      const { buildSamlInstance } = await import('../saml.js');
      expect(buildSamlInstance()).not.toBeNull();
    });
  });

  // ── SAML_SESSION_COOKIE_OPTIONS ───────────────────────────────────────────
  describe('SAML_SESSION_COOKIE_OPTIONS', () => {
    it('uses 24h maxAge and secure=true in production mode', async () => {
      const origNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      vi.resetModules();
      const { SAML_SESSION_COOKIE_OPTIONS: opts } = await import('../saml.js');
      expect(opts.maxAge).toBe(24 * 60 * 60);
      expect(opts.secure).toBe(true);
      process.env.NODE_ENV = origNodeEnv;
      vi.resetModules();
    });

    it('sets secure=true when HTTPS env var is set', async () => {
      process.env.HTTPS = 'true';
      vi.resetModules();
      const { SAML_SESSION_COOKIE_OPTIONS: opts } = await import('../saml.js');
      expect(opts.secure).toBe(true);
      delete process.env.HTTPS;
      vi.resetModules();
    });
  });
});
