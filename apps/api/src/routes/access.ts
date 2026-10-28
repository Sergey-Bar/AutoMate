import { Hono, type Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod/v4';
import { accessTokens } from '@automate/db';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import {
  callerOf,
  requireRole,
  sourceOf,
  BROWSER_SIGN_IN,
  type CallerResolver,
} from '../http/roles.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { defaultClientKey } from './auth.js';
import { isSecureFor, type SecureCookies } from '../http/secure-cookies.js';
import {
  CreateAccessTokenBodySchema,
  TOKEN_PREFIX,
  audit,
  authenticateToken,
  createAccessToken,
  hashToken,
  listAccessTokens,
  revokeAccessToken,
  type Caller,
} from '../services/access-service.js';
import type { ProjectRegistryServiceOptions } from '../services/project-registry-service.js';

/**
 * Access tokens, and signing a browser in with one.
 *
 * An admin issues a token for a role; the secret is in the response once and nowhere else.
 * A person pastes theirs into the sign-in screen, which sets it as an `httpOnly` cookie, so a
 * viewer's browser carries a viewer's credential and nothing a script on the page can read.
 *
 * The pasted token arrives in the body, which the workspace dispatch does not read, so the
 * sign-in is served by the default workspace (or the person's) whichever workspace issued it:
 * it is looked up across the installation and authenticated in its own workspace. From then
 * on the cookie carries it, and the dispatch sends each request there.
 */
export interface AccessRouteOptions extends Pick<
  ProjectRegistryServiceOptions,
  'db' | 'workspaceId'
> {
  access: CallerResolver;
  secureCookies?: SecureCookies;
  /**
   * Whether a proxy in front of the API wrote `X-Forwarded-For`. Off by default, and read
   * through {@link defaultClientKey}: the token sign-in budget used to key on the raw header,
   * so a client that changed it on every attempt never ran out (ledger LAN-1).
   */
  trustProxy?: boolean;
  /** The token cookie's lifetime. A token outlives a sign-in; the cookie should not. */
  cookieMaxAgeSeconds?: number;
}

const TokenLoginSchema = z.object({ token: z.string().min(1).max(200) });

function invalid(context: Context, message: string, details: unknown) {
  return context.json({ error: { code: ErrorCode.INVALID_REQUEST_BODY, message, details } }, 400);
}

/** The caller a live token makes in its own workspace, whichever workspace serves the request. */
async function authenticateAnywhere(
  options: Pick<AccessRouteOptions, 'db'>,
  token: string,
): Promise<Caller | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const [row] = await options.db
    .select({ workspaceId: accessTokens.workspaceId })
    .from(accessTokens)
    .where(and(eq(accessTokens.tokenHash, hashToken(token)), isNull(accessTokens.revokedAt)))
    .limit(1);
  if (row === undefined) return null;
  return authenticateToken({ db: options.db, workspaceId: row.workspaceId }, token);
}

export function createAccessRoutes(options: AccessRouteOptions): Hono {
  const app = new Hono();
  const admin = requireRole('admin', options.access);
  const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

  app.get('/api/v1/auth/whoami', async (context) => {
    const caller = await callerOf(context, options.access);
    return context.json({
      actor: caller.actor,
      role: caller.role,
      mode: options.access.mode,
      profile: options.access.profile ?? 'solo',
      source: sourceOf(caller),
      workspace: options.workspaceId,
    });
  });

  app.post('/api/v1/auth/token-login', async (context) => {
    const parsed = TokenLoginSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return invalid(context, 'Invalid sign-in', parsed.error.issues);
    const budget = limiter.consume(
      `token:${defaultClientKey(context, options.trustProxy ?? false)}`,
    );
    if (!budget.allowed) {
      context.header('retry-after', String(budget.retryAfterSeconds));
      throw new DomainError('LOGIN_RATE_LIMITED', 'Too many sign-in attempts');
    }
    const caller = await authenticateAnywhere(options, parsed.data.token);
    // An uploader token is a CI credential; it never signs a browser in.
    if (caller === null || caller.role === null) {
      throw new DomainError('INVALID_CREDENTIALS', 'Invalid credentials');
    }
    // After the token is checked, so the refusal tells nothing to a caller without one.
    if (options.access.ssoEnforced === true) {
      throw new DomainError(
        'SSO_ENFORCED',
        'Single sign-on is enforced: sign in with your identity provider',
      );
    }
    setCookie(context, BROWSER_SIGN_IN, parsed.data.token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: isSecureFor(options.secureCookies, context),
      path: '/',
      maxAge: options.cookieMaxAgeSeconds ?? 12 * 3600,
    });
    return context.json({ actor: caller.actor, role: caller.role });
  });

  app.post('/api/v1/auth/token-logout', (context) => {
    deleteCookie(context, BROWSER_SIGN_IN, { path: '/' });
    return context.json({ ok: true });
  });

  app.get('/api/v1/access-tokens', admin, async (context) =>
    context.json({ tokens: await listAccessTokens(options) }),
  );

  app.post('/api/v1/access-tokens', admin, async (context) => {
    const parsed = CreateAccessTokenBodySchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) return invalid(context, 'Invalid access token', parsed.error.issues);
    const actor = (await callerOf(context, options.access)).actor;
    const created = await createAccessToken(options, parsed.data, actor);
    await audit(options, {
      actor,
      action: 'access-token.create',
      resourceType: 'access_token',
      resourceId: created.summary.id,
      details: { role: created.summary.role, projectId: created.summary.projectId },
    });
    return context.json(created, 201);
  });

  app.delete('/api/v1/access-tokens/:id', admin, async (context) => {
    const revoked = await revokeAccessToken(options, context.req.param('id'));
    await audit(options, {
      actor: (await callerOf(context, options.access)).actor,
      action: 'access-token.revoke',
      resourceType: 'access_token',
      resourceId: revoked.id,
    });
    return context.json(revoked);
  });

  return app;
}
