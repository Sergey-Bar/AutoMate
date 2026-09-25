import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod/v4';
import {
  hashCredential,
  InMemorySessionService,
  verifyCredential,
  type SessionRecord,
} from '@automate/auth';
import type { AuthSessionBackend } from '../infrastructure/session-backend.js';

const LoginSchema = z.object({ apiKey: z.string().min(1) });
const SESSION_COOKIE = 'automate_session';

export interface AuthRouteOptions {
  cookieSecret: string;
  installationId: string;
  installationKeyHash: string;
  sessionTtlMs: number;
  secureCookies: boolean;
  now?: () => Date;
  sessionBackend?: AuthSessionBackend;
}

function sessionResponse(record: SessionRecord) {
  return {
    sessionId: record.id,
    installationId: record.installationId,
    issuedAt: record.issuedAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
  };
}

function memoryBackend(secret: string, ttlMs: number, now?: () => Date): AuthSessionBackend {
  const service = new InMemorySessionService(secret, ttlMs, now);
  return {
    issue: async (installationId) => service.issue(installationId),
    validate: async (token) => service.validate(token),
    revoke: async (id) => service.revoke(id),
  };
}

export function createAuthRoutes(options: AuthRouteOptions) {
  const sessions =
    options.sessionBackend ??
    memoryBackend(options.cookieSecret, options.sessionTtlMs, options.now);
  const app = new Hono();

  app.post('/api/v1/auth/login', async (context) => {
    const parsed = LoginSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Invalid login request' }, 400);
    if (!verifyCredential(options.cookieSecret, parsed.data.apiKey, options.installationKeyHash)) {
      return context.json({ error: 'Invalid credentials' }, 401);
    }
    const issued = await sessions.issue(options.installationId);
    setCookie(context, SESSION_COOKIE, issued.token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: options.secureCookies,
      path: '/',
      maxAge: Math.floor(options.sessionTtlMs / 1000),
    });
    return context.json(sessionResponse(issued.record));
  });

  app.get('/api/v1/auth/session', async (context) => {
    const record = await readSession(context, sessions);
    if (!record) return context.json({ error: 'Unauthorized' }, 401);
    return context.json(sessionResponse(record));
  });

  app.post('/api/v1/auth/logout', async (context) => {
    const record = await readSession(context, sessions);
    if (record) await sessions.revoke(record.id);
    deleteCookie(context, SESSION_COOKIE, { path: '/' });
    return context.json({ ok: true });
  });

  return { app, sessions };
}

async function readSession(
  context: Context,
  sessions: AuthSessionBackend,
): Promise<SessionRecord | undefined> {
  const token = getCookie(context, SESSION_COOKIE);
  if (!token) return undefined;
  return sessions.validate(token);
}

export { hashCredential };
