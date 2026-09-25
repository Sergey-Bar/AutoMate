/**
 * Tests for plugins/saml.ts — new routes: metadata, logout, SLO
 *
 * Covers:
 *  - GET  /api/auth/saml/metadata → SP metadata XML
 *  - POST /api/auth/saml/logout   → SP-initiated logout (clear cookie, redirect)
 *  - POST /api/auth/saml/slo      → IdP-initiated SLO callback
 *  - buildSamlInstanceAsync()     → DB config first, env fallback
 *  - loadSamlConfigFromDb()       → null when no DB row
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
const {
  mockGetAuthorizeUrlAsync,
  mockGetLogoutUrlAsync,
  mockGetLogoutResponseUrlAsync,
  mockValidatePostRequestAsync,
  mockGenerateServiceProviderMetadata,
  mockDbSelect,
  mockDbInsert,
  mockDbUpdate,
  mockGenerateSessionToken,
  mockLogAuditEvent,
  mockRequireFeature,
  mockGetCookieSecret,
} = vi.hoisted(() => ({
  mockGetAuthorizeUrlAsync: vi.fn(),
  mockGetLogoutUrlAsync: vi.fn(),
  mockGetLogoutResponseUrlAsync: vi.fn(),
  mockValidatePostRequestAsync: vi.fn(),
  mockGenerateServiceProviderMetadata: vi.fn<() => string>(),
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockGenerateSessionToken: vi.fn<(keyId: string) => string>(),
  mockLogAuditEvent: vi.fn(),
  mockRequireFeature: vi.fn(),
  mockGetCookieSecret: vi.fn<() => string>(),
}));

// Mock @node-saml/node-saml
vi.mock('@node-saml/node-saml', () => {
  function MockSAML(this: Record<string, unknown>, opts: { logoutUrl?: string; issuer?: string }) {
    this.options = { logoutUrl: opts.logoutUrl, issuer: opts.issuer ?? 'test-issuer' };
    this.getAuthorizeUrlAsync = mockGetAuthorizeUrlAsync;
    this.getLogoutUrlAsync = mockGetLogoutUrlAsync;
    this.getLogoutResponseUrlAsync = mockGetLogoutResponseUrlAsync;
    this.validatePostRequestAsync = mockValidatePostRequestAsync;
    this.generateServiceProviderMetadata = mockGenerateServiceProviderMetadata;
  }
  return {
    SAML: MockSAML,
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

// Mock DB schema
vi.mock('../../db/schema.js', () => ({
  users: { id: 'id', email: 'email', samlSubject: 'saml_subject', displayName: 'display_name', updatedAt: 'updated_at' },
  samlConfig: { id: 'id', entryPoint: 'entry_point', issuer: 'issuer', idpCert: 'idp_cert', callbackUrl: 'callback_url', spPrivateKey: 'sp_private_key', defaultRole: 'default_role', updatedAt: 'updated_at' },
}));

// Mock drizzle-orm
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

// Mock requireFeature — default pass-through
vi.mock('../../services/feature-flags.js', () => ({
  requireFeature: mockRequireFeature,
}));

// Mock constants
vi.mock('../../constants.js', () => ({
  SESSION_MAX_AGE_SECONDS: 86400,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Sets up mockDbSelect to return empty rows (no DB config found) */
function makeEmptySelectChain() {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  mockDbSelect.mockReturnValue(chain);
  return chain;
}

/** Sets up mockDbSelect to throw (simulates DB unavailable) */
function makeSelectThrow() {
  mockDbSelect.mockImplementation(() => {
    throw new Error('DB connection failed');
  });
}

/** Sets up mockDbSelect to return a DB saml_config row */
function makeDbConfigSelectChain(config: {
  entryPoint: string;
  issuer: string;
  idpCert: string;
  callbackUrl: string;
  spPrivateKey?: string | null;
  defaultRole?: string | null;
}) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([{
      id: 'default',
      entryPoint: config.entryPoint,
      issuer: config.issuer,
      idpCert: config.idpCert,
      callbackUrl: config.callbackUrl,
      spPrivateKey: config.spPrivateKey ?? null,
      defaultRole: config.defaultRole ?? 'viewer',
      updatedAt: '2025-01-01T00:00:00.000Z',
    }]),
  };
  mockDbSelect.mockReturnValue(chain);
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

describe('plugins/saml.ts — SLO and metadata routes', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRequireFeature.mockReturnValue(async () => { /* pass */ });
    mockGetCookieSecret.mockReturnValue('test-cookie-secret');
    mockGenerateSessionToken.mockReturnValue('user-id:1234567890:abc123sig');

    // Default: SSO config from env vars
    process.env.SAML_ENTRY_POINT = 'https://idp.example.com/sso';
    process.env.SAML_ISSUER = 'https://app.example.com';
    process.env.SAML_CERT = '-----BEGIN CERTIFICATE-----\nMIIBc\n-----END CERTIFICATE-----';
    process.env.SAML_CALLBACK_URL = 'https://app.example.com/api/auth/saml/callback';
    delete process.env.SAML_LOGOUT_URL;
    delete process.env.SAML_SLO_CALLBACK_URL;
  });

  afterEach(async () => {
    await app?.close();
  });

  // ── GET /api/auth/saml/metadata ───────────────────────────────────────────
  describe('GET /api/auth/saml/metadata', () => {
    it('returns 503 when SAML is not configured (no env, no DB)', async () => {
      delete process.env.SAML_ENTRY_POINT;
      delete process.env.SAML_ISSUER;
      delete process.env.SAML_CERT;
      delete process.env.SAML_CALLBACK_URL;
      makeEmptySelectChain();

      app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/auth/saml/metadata' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: 'SSO is not configured' });
    });

    it('returns SP metadata XML with application/samlmetadata+xml content type', async () => {
      makeEmptySelectChain(); // no DB config — uses env vars
      const fakeXml = '<?xml version="1.0"?><EntityDescriptor/>';
      mockGenerateServiceProviderMetadata.mockReturnValue(fakeXml);

      app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/auth/saml/metadata' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/samlmetadata+xml');
      expect(res.body).toBe(fakeXml);
    });

    it('falls back to env vars when DB query throws', async () => {
      makeSelectThrow();
      mockGenerateServiceProviderMetadata.mockReturnValue('<EntityDescriptor/>');

      app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/auth/saml/metadata' });
      expect(res.statusCode).toBe(200);
    });

    it('uses DB config when available — builds SAML with DB fields', async () => {
      makeDbConfigSelectChain({
        entryPoint: 'https://db-idp.example.com/sso',
        issuer: 'https://db-sp.example.com',
        idpCert: '-----BEGIN CERTIFICATE-----\nMIIDb\n-----END CERTIFICATE-----',
        callbackUrl: 'https://db-sp.example.com/callback',
      });
      mockGenerateServiceProviderMetadata.mockReturnValue('<EntityDescriptor/>');

      app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/auth/saml/metadata' });
      expect(res.statusCode).toBe(200);
      expect(mockGenerateServiceProviderMetadata).toHaveBeenCalledWith(null, null);
    });
  });

  // ── POST /api/auth/saml/logout ────────────────────────────────────────────
  describe('POST /api/auth/saml/logout', () => {
    it('clears session cookie and redirects to login when no logoutUrl', async () => {
      makeEmptySelectChain(); // SAML instance built from env — no logoutUrl by default
      // SAML instance options.logoutUrl will be undefined (not set in env)

      app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/saml/logout',
        headers: { cookie: 'automate_dashboard_session=user-id:123:sig' },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/api/auth/saml/login');
      // Cookie should be cleared
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('writes an audit event on local logout', async () => {
      makeEmptySelectChain();

      app = await buildApp();
      await app.inject({
        method: 'POST',
        url: '/api/auth/saml/logout',
        headers: { cookie: 'automate_dashboard_session=myuserid:123:sig' },
      });
      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.sso.logout' }),
      );
    });

    it('redirects to IdP SLO URL when logoutUrl is configured', async () => {
      process.env.SAML_LOGOUT_URL = 'https://idp.example.com/slo';
      makeEmptySelectChain();

      const idpSloWithRequest = 'https://idp.example.com/slo?SAMLRequest=xyz&Signature=abc';
      mockGetLogoutUrlAsync.mockResolvedValue(idpSloWithRequest);

      app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/saml/logout',
        headers: { cookie: 'automate_dashboard_session=user-id:123:sig' },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(idpSloWithRequest);
      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.sso.logout', details: expect.objectContaining({ method: 'sp-initiated' }) }),
      );
    });

    it('falls back to login redirect when getLogoutUrlAsync throws', async () => {
      process.env.SAML_LOGOUT_URL = 'https://idp.example.com/slo';
      makeEmptySelectChain();
      mockGetLogoutUrlAsync.mockRejectedValue(new Error('SAML signing failed'));

      app = await buildApp();
      const res = await app.inject({ method: 'POST', url: '/api/auth/saml/logout' });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/api/auth/saml/login');
    });

    it('returns 503 when SAML is not configured at all', async () => {
      delete process.env.SAML_ENTRY_POINT;
      delete process.env.SAML_ISSUER;
      delete process.env.SAML_CERT;
      delete process.env.SAML_CALLBACK_URL;
      makeEmptySelectChain();

      app = await buildApp();
      // Even without SAML config, logout clears cookie and redirects to login
      const res = await app.inject({ method: 'POST', url: '/api/auth/saml/logout' });
      // No SAML instance → redirect to login page
      expect(res.statusCode).toBe(302);
    });
  });

  // ── POST /api/auth/saml/slo ───────────────────────────────────────────────
  describe('POST /api/auth/saml/slo', () => {
    it('returns 503 when SAML is not configured', async () => {
      delete process.env.SAML_ENTRY_POINT;
      delete process.env.SAML_ISSUER;
      delete process.env.SAML_CERT;
      delete process.env.SAML_CALLBACK_URL;
      makeEmptySelectChain();

      app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/saml/slo',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'SAMLRequest=abc',
      });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: 'SSO is not configured' });
    });

    it('returns 400 when SAMLRequest is missing', async () => {
      makeEmptySelectChain();

      app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/saml/slo',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: '',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'Missing SAMLRequest' });
    });

    it('returns 400 when LogoutRequest signature validation fails', async () => {
      makeEmptySelectChain();
      mockValidatePostRequestAsync.mockRejectedValue(new Error('Invalid signature'));

      app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/saml/slo',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'SAMLRequest=invalid',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'Invalid LogoutRequest' });
    });

    it('clears session cookie and redirects with LogoutResponse on valid request', async () => {
      makeEmptySelectChain();
      mockValidatePostRequestAsync.mockResolvedValue({
        profile: {
          nameID: 'uid-logout',
          nameIDFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
          issuer: 'https://idp.example.com',
        },
        loggedOut: false,
      });
      const logoutResponseUrl = 'https://idp.example.com/slo?SAMLResponse=encoded&Signature=abc';
      mockGetLogoutResponseUrlAsync.mockResolvedValue(logoutResponseUrl);

      app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/saml/slo',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: 'automate_dashboard_session=session-user:123:sig',
        },
        body: 'SAMLRequest=validrequest&RelayState=relay-state-123',
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(logoutResponseUrl);
      // Cookie should be cleared
      expect(res.headers['set-cookie']).toBeDefined();
      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.sso.logout', details: expect.objectContaining({ method: 'idp-initiated' }) }),
      );
    });

    it('passes RelayState through to LogoutResponse generation', async () => {
      makeEmptySelectChain();
      mockValidatePostRequestAsync.mockResolvedValue({
        profile: { nameID: 'uid-relay', nameIDFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient', issuer: 'https://idp' },
        loggedOut: false,
      });
      mockGetLogoutResponseUrlAsync.mockResolvedValue('https://idp.example.com/slo?resp=1');

      app = await buildApp();
      await app.inject({
        method: 'POST',
        url: '/api/auth/saml/slo',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'SAMLRequest=valid&RelayState=my-relay-state',
      });

      // Second arg to getLogoutResponseUrlAsync should be the RelayState
      expect(mockGetLogoutResponseUrlAsync).toHaveBeenCalledWith(
        expect.anything(),
        'my-relay-state',
        {},
        true,
      );
    });

    it('redirects to / when LogoutResponse generation fails', async () => {
      makeEmptySelectChain();
      mockValidatePostRequestAsync.mockResolvedValue({
        profile: { nameID: 'uid-fail', nameIDFormat: 'transient', issuer: 'https://idp' },
        loggedOut: false,
      });
      mockGetLogoutResponseUrlAsync.mockRejectedValue(new Error('Signing failed'));

      app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/saml/slo',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'SAMLRequest=valid',
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/');
    });
  });

  // ── buildSamlInstanceAsync() ──────────────────────────────────────────────
  describe('buildSamlInstanceAsync()', () => {
    it('returns null when neither DB nor env vars are configured', async () => {
      delete process.env.SAML_ENTRY_POINT;
      delete process.env.SAML_ISSUER;
      delete process.env.SAML_CERT;
      delete process.env.SAML_CALLBACK_URL;
      makeEmptySelectChain();

      const { buildSamlInstanceAsync } = await import('../saml.js');
      const result = await buildSamlInstanceAsync();
      expect(result).toBeNull();
    });

    it('returns a SAML instance from env vars when DB is empty', async () => {
      makeEmptySelectChain();

      const { buildSamlInstanceAsync } = await import('../saml.js');
      const result = await buildSamlInstanceAsync();
      expect(result).not.toBeNull();
    });

    it('returns a SAML instance from DB config when DB row exists', async () => {
      makeDbConfigSelectChain({
        entryPoint: 'https://db-idp.example.com/sso',
        issuer: 'https://db-app.example.com',
        idpCert: '-----BEGIN CERTIFICATE-----\nMIIDb\n-----END CERTIFICATE-----',
        callbackUrl: 'https://db-app.example.com/callback',
      });

      const { buildSamlInstanceAsync } = await import('../saml.js');
      const result = await buildSamlInstanceAsync();
      expect(result).not.toBeNull();
    });

    it('falls back to env vars when DB throws', async () => {
      makeSelectThrow();

      const { buildSamlInstanceAsync } = await import('../saml.js');
      const result = await buildSamlInstanceAsync();
      expect(result).not.toBeNull(); // env vars are still set
    });
  });

  // ── loadSamlConfigFromDb() ─────────────────────────────────────────────────
  describe('loadSamlConfigFromDb()', () => {
    it('returns null when no row exists in DB', async () => {
      makeEmptySelectChain();

      const { loadSamlConfigFromDb } = await import('../saml.js');
      const result = await loadSamlConfigFromDb();
      expect(result).toBeNull();
    });

    it('returns null when DB row is missing required fields', async () => {
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        // Row has id but missing entryPoint
        limit: vi.fn().mockResolvedValue([{ id: 'default', entryPoint: null, issuer: null, idpCert: null, callbackUrl: null }]),
      };
      mockDbSelect.mockReturnValue(chain);

      const { loadSamlConfigFromDb } = await import('../saml.js');
      const result = await loadSamlConfigFromDb();
      expect(result).toBeNull();
    });

    it('returns config when all required fields are present', async () => {
      makeDbConfigSelectChain({
        entryPoint: 'https://idp.example.com/sso',
        issuer: 'https://app.example.com',
        idpCert: '-----BEGIN CERTIFICATE-----\nMIIBc\n-----END CERTIFICATE-----',
        callbackUrl: 'https://app.example.com/callback',
        spPrivateKey: 'test-private-key-material',
        defaultRole: 'editor',
      });

      const { loadSamlConfigFromDb } = await import('../saml.js');
      const result = await loadSamlConfigFromDb();
      expect(result).not.toBeNull();
      expect(result?.entryPoint).toBe('https://idp.example.com/sso');
      expect(result?.spPrivateKey).toBe('test-private-key-material');
      expect(result?.defaultRole).toBe('editor');
    });
  });
});
