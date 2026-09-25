/**
 * plugins/saml.ts — SAML 2.0 Single-Provider SSO integration
 *
 * Routes (all gated by 'sso' feature flag, registered unconditionally but
 * return 404 when flag is OFF via requireFeature preHandler):
 *
 *   GET  /api/auth/saml/login     → redirect to IdP
 *   POST /api/auth/saml/callback  → process IdP assertion, issue session cookie
 *   GET  /api/auth/saml/status    → { configured: boolean }  (no auth required)
 *
 * Environment variables:
 *   SAML_ENTRY_POINT    IdP SSO URL (required when sso flag is ON)
 *   SAML_ISSUER         SP entity ID / issuer (required when sso flag is ON)
 *   SAML_CERT           IdP public certificate, PEM, base64-encoded (required)
 *   SAML_CALLBACK_URL   ACS URL the IdP should POST to (required)
 *   SAML_DEFAULT_ROLE   Role assigned to new SSO users: admin|editor|viewer (default: viewer)
 */
import type { FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import { randomUUID } from 'node:crypto';
import { eq, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users, samlConfig } from '../db/schema.js';
import { requireFeature } from '../services/feature-flags.js';
import { generateSessionToken, getCookieSecret, SESSION_COOKIE_NAME } from '../services/auth.js';
import { logAuditEvent } from '../services/audit.js';
import { SESSION_MAX_AGE_SECONDS } from '../constants.js';

// ── Cookie options (mirrors routes/auth.ts, duplicated here to avoid exporting) ──
const isProduction = process.env.NODE_ENV === 'production';
export const SAML_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProduction || !!process.env.HTTPS,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: isProduction ? 24 * 60 * 60 : SESSION_MAX_AGE_SECONDS,
};

/**
 * Build a SAML instance from environment variables.
 * Returns null if required config is absent (SSO not configured).
 */
export function buildSamlInstance(): SAML | null {
  const entryPoint = process.env.SAML_ENTRY_POINT;
  const issuer = process.env.SAML_ISSUER;
  const certBase64 = process.env.SAML_CERT;
  const callbackUrl = process.env.SAML_CALLBACK_URL;

  if (!entryPoint || !issuer || !certBase64 || !callbackUrl) return null;

  // Accept PEM directly or base64-encoded PEM
  const cert = certBase64.includes('-----BEGIN') ? certBase64 : Buffer.from(certBase64, 'base64').toString('utf-8');

  return new SAML({
    entryPoint,
    issuer,
    idpCert: cert,
    callbackUrl,
    ...(process.env.SAML_LOGOUT_URL ? { logoutUrl: process.env.SAML_LOGOUT_URL } : {}),
    // Disable InResponseTo validation for simplicity (SP-initiated only)
    validateInResponseTo: ValidateInResponseTo.never,
    // Allow clock skew of 2 minutes
    acceptedClockSkewMs: 120_000,
  });
}

/**
 * Load SAML configuration from the database.
 * Returns null if no row exists or required fields are missing.
 */
export async function loadSamlConfigFromDb(): Promise<{
  entryPoint: string;
  issuer: string;
  idpCert: string;
  callbackUrl: string;
  spPrivateKey: string | null;
  defaultRole: string;
} | null> {
  const rows = await db.select().from(samlConfig).limit(1);
  const row = rows[0];
  if (!row || !row.entryPoint || !row.issuer || !row.idpCert || !row.callbackUrl) return null;
  return {
    entryPoint: row.entryPoint,
    issuer: row.issuer,
    idpCert: row.idpCert,
    callbackUrl: row.callbackUrl,
    spPrivateKey: row.spPrivateKey ?? null,
    defaultRole: row.defaultRole,
  };
}

/**
 * Build a SAML instance, preferring DB config over environment variables.
 * Returns null if neither source has the required configuration.
 */
export async function buildSamlInstanceAsync(): Promise<SAML | null> {
  try {
    const dbConfig = await loadSamlConfigFromDb();
    if (dbConfig) {
      const cert = dbConfig.idpCert.includes('-----BEGIN')
        ? dbConfig.idpCert
        : Buffer.from(dbConfig.idpCert, 'base64').toString('utf-8');
      return new SAML({
        entryPoint: dbConfig.entryPoint,
        issuer: dbConfig.issuer,
        idpCert: cert,
        callbackUrl: dbConfig.callbackUrl,
        ...(dbConfig.spPrivateKey ? { privateKey: dbConfig.spPrivateKey } : {}),
        validateInResponseTo: ValidateInResponseTo.never,
        acceptedClockSkewMs: 120_000,
      });
    }
  } catch (_err) {
    // DB unavailable — fall through to env vars
  }
  return buildSamlInstance();
}

/**
 * Find or create a DB user for an SSO assertion.
 * Matches on samlSubject first, then falls back to email.
 * New users are created with the SAML_DEFAULT_ROLE (default: viewer).
 */
export async function findOrCreateSsoUser(opts: {
  samlSubject: string;
  email: string;
  displayName: string;
}): Promise<{ id: string; role: 'admin' | 'editor' | 'viewer' }> {
  const { samlSubject, email, displayName } = opts;

  // Look up by samlSubject or email (handles first-time SSO login for existing email users)
  const existing = await db
    .select({ id: users.id, role: users.role, samlSubject: users.samlSubject })
    .from(users)
    .where(or(eq(users.samlSubject, samlSubject), eq(users.email, email)))
    .limit(1);

  if (existing.length > 0) {
    const user = existing[0];
    // noUncheckedIndexedAccess guard: ensure user is defined before accessing
    if (user) {
      // Backfill samlSubject if missing (first SSO login for a pre-existing email user)
      if (!user.samlSubject) {
        await db.update(users).set({ samlSubject, updatedAt: new Date().toISOString() }).where(eq(users.id, user.id));
      }
      return { id: user.id, role: user.role };
    }
  }

  // Create new user
  const roleRaw = process.env.SAML_DEFAULT_ROLE ?? 'viewer';
  const role = (['admin', 'editor', 'viewer'] as const).includes(roleRaw as 'admin' | 'editor' | 'viewer')
    ? (roleRaw as 'admin' | 'editor' | 'viewer')
    : 'viewer';

  const id = randomUUID();
  const now = new Date().toISOString();
  await db.insert(users).values({ id, email, displayName, role, samlSubject, createdAt: now, updatedAt: now });
  return { id, role };
}

export async function registerSamlPlugin(app: FastifyInstance): Promise<void> {
  // Register formbody within this plugin scope only — parses SAML POST assertions
  await app.register(formbody);

  // ── GET /api/auth/saml/status ── public, no auth ─────────────────────────
  app.get('/api/auth/saml/status', async (_req, reply) => {
    const configured = !!(
      process.env.SAML_ENTRY_POINT &&
      process.env.SAML_ISSUER &&
      process.env.SAML_CERT &&
      process.env.SAML_CALLBACK_URL
    );
    return reply.send({ configured });
  });

  // ── GET /api/auth/saml/login ── redirect to IdP ───────────────────────────
  app.get('/api/auth/saml/login', {
    preHandler: [requireFeature('sso')],
  }, async (_req, reply) => {
    const saml = buildSamlInstance();
    if (!saml) {
      return reply.status(503).send({ error: 'SSO is not configured' });
    }

    const redirectUrl = await saml.getAuthorizeUrlAsync('', undefined, {});
    return reply.redirect(redirectUrl, 302);
  });

  // ── POST /api/auth/saml/callback ── process IdP assertion ─────────────────
  app.post<{ Body: { SAMLResponse?: string; RelayState?: string } }>(
    '/api/auth/saml/callback',
    {
      preHandler: [requireFeature('sso')],
    },
    async (req, reply) => {
      const saml = buildSamlInstance();
      if (!saml) {
        return reply.status(503).send({ error: 'SSO is not configured' });
      }

      if (!req.body?.SAMLResponse) {
        return reply.status(400).send({ error: 'Missing SAMLResponse' });
      }

      let profile: { nameID?: string; nameIDFormat?: string; email?: string; displayName?: string; [key: string]: unknown };
      try {
        const result = await saml.validatePostResponseAsync({ SAMLResponse: req.body.SAMLResponse });
        profile = result.profile ?? {};
      } catch (err) {
        app.log.warn({ err }, '[saml] SAML assertion validation failed');
        return reply.status(401).send({ error: 'Invalid SAML assertion' });
      }

      const samlSubject = (profile.nameID as string | undefined) ?? '';
      const email = (profile.email as string | undefined)
        ?? (profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] as string | undefined)
        ?? '';
      const displayName = (profile.displayName as string | undefined)
        ?? (profile['http://schemas.microsoft.com/identity/claims/displayname'] as string | undefined)
        ?? email;

      if (!samlSubject || !email) {
        app.log.warn({ profile }, '[saml] SAML profile missing nameID or email');
        return reply.status(400).send({ error: 'SSO profile missing required fields (nameID, email)' });
      }

      const user = await findOrCreateSsoUser({ samlSubject, email, displayName });
      const token = generateSessionToken(user.id);

      // Verify COOKIE_SECRET is set (getCookieSecret throws in production when absent)
      getCookieSecret();

      reply.setCookie(SESSION_COOKIE_NAME, token, SAML_SESSION_COOKIE_OPTIONS);

      logAuditEvent({
        actorId: user.id,
        action: 'auth.sso.login',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        details: { email, role: user.role },
      });

      // Redirect to dashboard root after successful SSO login
      return reply.redirect('/', 302);
    },
  );

  // ── GET /api/auth/saml/metadata ── SP metadata XML ───────────────────────
  app.get('/api/auth/saml/metadata', async (_req, reply) => {
    const saml = await buildSamlInstanceAsync();
    if (!saml) {
      return reply.status(503).send({ error: 'SSO is not configured' });
    }
    const xml = saml.generateServiceProviderMetadata(null, null);
    return reply.header('content-type', 'application/samlmetadata+xml').send(xml);
  });

  // ── POST /api/auth/saml/logout ── SP-initiated logout ────────────────────
  app.post<{ Body?: Record<string, unknown> }>(
    '/api/auth/saml/logout',
    async (req, reply) => {
      // Always clear the session cookie
      reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });

      // Extract user ID from session cookie for audit log
      const cookieValue = req.cookies?.[SESSION_COOKIE_NAME] ?? '';
      const actorId = cookieValue.split(':')[0] ?? 'unknown';

      const saml = await buildSamlInstanceAsync();

      // If SAML is configured and has a logoutUrl, attempt SP-initiated SLO
      const samlOptions = saml ? (saml as unknown as { options?: { logoutUrl?: string } }).options : undefined;
      if (saml && samlOptions?.logoutUrl) {
        try {
          const logoutUrl = await saml.getLogoutUrlAsync(
            { nameID: actorId, nameIDFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient', issuer: process.env.SAML_ISSUER ?? '' },
            '',
            {},
          );
          logAuditEvent({
            actorId,
            action: 'auth.sso.logout',
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            details: { method: 'sp-initiated' },
          });
          return reply.redirect(logoutUrl, 302);
        } catch (_err) {
          // Fall through to local logout
        }
      }

      // Local logout — just redirect to login
      logAuditEvent({
        actorId,
        action: 'auth.sso.logout',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        details: { method: 'local' },
      });
      return reply.redirect('/api/auth/saml/login', 302);
    },
  );

  // ── POST /api/auth/saml/slo ── IdP-initiated SLO callback ────────────────
  app.post<{ Body?: { SAMLRequest?: string; RelayState?: string } }>(
    '/api/auth/saml/slo',
    async (req, reply) => {
      const saml = await buildSamlInstanceAsync();
      if (!saml) {
        return reply.status(503).send({ error: 'SSO is not configured' });
      }

      if (!req.body?.SAMLRequest) {
        return reply.status(400).send({ error: 'Missing SAMLRequest' });
      }

      let profile: { nameID?: string; nameIDFormat?: string; issuer?: string; [key: string]: unknown };
      try {
        const result = await saml.validatePostRequestAsync({ SAMLRequest: req.body.SAMLRequest });
        profile = result.profile ?? {};
      } catch (err) {
        app.log.warn({ err }, '[saml] SLO LogoutRequest validation failed');
        return reply.status(400).send({ error: 'Invalid LogoutRequest' });
      }

      // Clear session cookie
      reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });

      const cookieValue = req.cookies?.[SESSION_COOKIE_NAME] ?? '';
      const actorId = cookieValue.split(':')[0] ?? 'unknown';

      logAuditEvent({
        actorId,
        action: 'auth.sso.logout',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        details: { method: 'idp-initiated' },
      });

      const relayState = req.body.RelayState ?? '';
      try {
        const logoutResponseUrl = await saml.getLogoutResponseUrlAsync(
          { ...profile, nameID: profile.nameID ?? '', nameIDFormat: profile.nameIDFormat ?? 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient', issuer: profile.issuer ?? '' },
          relayState, {}, true,
        );
        return reply.redirect(logoutResponseUrl, 302);
      } catch (_err) {
        return reply.redirect('/', 302);
      }
    },
  );
}
