import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  SESSION_COOKIE_NAME,
  generateSessionToken,
  generateApiKey,
  listApiKeys,
  loadAuthConfig,
  revokeApiKey,
  saveAuthConfig,
  validateApiKey,
  validateSessionToken,
} from '../services/auth.js';
import { migrateFileKeysToDb, createApiKeyInDb } from '../services/api-key-db.js';
import { validateOrReply } from '../lib/validate-or-reply.js';
import { SESSION_MAX_AGE_SECONDS } from '../constants.js';
import { requireFeature } from '../services/feature-flags.js';
import { requireRole } from '../plugins/rbac.js';
import { logAuditEvent } from '../services/audit.js';

const CreateApiKeyBody = z.object({
  name: z.string().min(1),
});

const ToggleAuthBody = z.object({
  enabled: z.boolean(),
});

const LoginBody = z.object({
  apiKey: z.string().min(1),
});

/**
 * Session cookie options.
 * - `secure` is true in production OR whenever HTTPS is likely (reverse proxy sets
 *    X-Forwarded-Proto). This prevents accidental clear-text cookie transmission
 *    even if NODE_ENV is misconfigured.
 * - `sameSite: 'lax'` allows navigating to the dashboard from external links
 *    (Slack, Jira notifications) while still blocking cross-site POST requests.
 * - `maxAge`: 24 hours (reduced from 7 days) to limit session window.
 */
const isProduction = process.env.NODE_ENV === 'production';
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  // Rely on Fastify's `trustProxy` setting for X-Forwarded-Proto detection.
  // The HTTPS env var is a common convention set by hosting platforms (e.g. Heroku).
  secure: isProduction || !!process.env.HTTPS,
  sameSite: 'lax' as const,
  path: '/',
  // Production: 24h session (reduced from SESSION_MAX_AGE_SECONDS / 7d) to limit exposure window
  maxAge: isProduction ? 24 * 60 * 60 : SESSION_MAX_AGE_SECONDS,
};

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, reply): Promise<void> => {
    const body = await validateOrReply(LoginBody, req, reply);
    if (!body) return;

    // Timing-safe validation first — prevents timing attacks on key comparison
    if (!validateApiKey(body.apiKey)) {
      logAuditEvent({
        actorId: 'unknown',
        action: 'auth.login.failed',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        details: { reason: 'invalid_key' },
      });
      return reply.status(401).send({ authenticated: false });
    }

    // Safe to do plain lookup now — key was already validated above
    const config = loadAuthConfig();
    const matchedKey = config.keys.find((key) => key.key === body.apiKey);
    if (!matchedKey) {
      logAuditEvent({
        actorId: 'unknown',
        action: 'auth.login.failed',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        details: { reason: 'key_not_found' },
      });
      return reply.status(401).send({ authenticated: false });
    }

    const token = generateSessionToken(matchedKey.id);
    reply.setCookie(SESSION_COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
    logAuditEvent({
      actorId: matchedKey.id,
      action: 'auth.login',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return reply.send({ authenticated: true });
  });

  app.post('/api/auth/logout', async (_req, reply): Promise<void> => {
    reply.clearCookie(SESSION_COOKIE_NAME, {
      path: '/',
    });
    logAuditEvent({ actorId: 'unknown', action: 'auth.logout' });
    return reply.send({ authenticated: false });
  });

  app.post('/api/auth/keys', {
    preHandler: requireRole('admin'),
  }, async (req, reply): Promise<void> => {
    const body = await validateOrReply(CreateApiKeyBody, req, reply);
    if (!body) return;

    const config = loadAuthConfig();
    const apiKey = generateApiKey(body.name);
    saveAuthConfig({ ...config, keys: [...config.keys, apiKey] });
    logAuditEvent({
      actorId: req.userRole === 'admin' ? 'admin' : 'unknown',
      action: 'key.create',
      resourceType: 'api_key',
      resourceId: apiKey.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      details: { name: body.name },
    });
    return reply.status(201).send(apiKey);
  });

  app.get('/api/auth/keys', async (_req, reply): Promise<void> => {
    return reply.send(listApiKeys());
  });

  app.delete<{ Params: { id: string } }>('/api/auth/keys/:id', {
    preHandler: requireRole('admin'),
  }, async (req, reply): Promise<void> => {
    const removed = revokeApiKey(req.params.id);
    if (!removed) {
      return reply.status(404).send({ error: 'API key not found' });
    }
    logAuditEvent({
      actorId: req.userRole === 'admin' ? 'admin' : 'unknown',
      action: 'key.delete',
      resourceType: 'api_key',
      resourceId: req.params.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return reply.send({ ok: true });
  });

  app.get('/api/auth/status', async (req, reply): Promise<void> => {
    const config = loadAuthConfig();
    const sessionToken = req.cookies[SESSION_COOKIE_NAME];
    const authenticated = typeof sessionToken === 'string' && validateSessionToken(sessionToken);
    return reply.send({ enabled: config.enabled, authenticated, keyCount: config.keys.length });
  });

  app.put('/api/auth/enable', {
    preHandler: requireRole('admin'),
  }, async (req, reply): Promise<void> => {
    const body = await validateOrReply(ToggleAuthBody, req, reply);
    if (!body) return;

    const config = loadAuthConfig();

    // Prevent enabling auth without any API keys — would lock out the owner
    if (body.enabled && config.keys.length === 0) {
      return reply.status(400).send({
        error: 'Cannot enable authentication without any API keys. Create at least one key first via POST /api/auth/keys.',
      });
    }

    saveAuthConfig({ ...config, enabled: body.enabled });
    return reply.send({ ok: true, enabled: body.enabled });
  });

  // ── POST /api/auth/bootstrap ─────────────────────────────────────────────
  // One-time system initialization: creates the first API key via DB.
  // Returns 409 if keys already exist.
  app.post('/api/auth/bootstrap', async (_req, reply): Promise<void> => {
    const config = loadAuthConfig();
    if (config.keys.length > 0) {
      return reply.status(409).send({ error: 'System already initialized' });
    }
    const created = await createApiKeyInDb('bootstrap');
    logAuditEvent({
      actorId: 'system',
      action: 'key.create',
      details: { name: 'bootstrap' },
    });
    return reply.status(201).send({ apiKey: created.key });
  });

  // ── POST /api/admin/migrate-keys ─────────────────────────────────────────
  // Migrates file-backed auth.json keys to DB. Idempotent. Gated by rbac flag.
  app.post('/api/admin/migrate-keys', {
    preHandler: [requireFeature('rbac'), requireRole('admin')],
  }, async (_req, reply): Promise<void> => {
    const migrated = await migrateFileKeysToDb();
    return reply.send({ migrated });
  });
}
