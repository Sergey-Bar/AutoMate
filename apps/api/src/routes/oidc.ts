import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import * as client from 'openid-client';
import type { OidcConfig } from '@automate/config';
import { hashCredential, verifyCredential } from '@automate/auth';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { isSecureFor, type SecureCookies } from '../http/secure-cookies.js';
import type { AuthSessionBackend } from '../infrastructure/session-backend.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { audit } from '../services/access-service.js';
import type { ProjectRegistryServiceOptions } from '../services/project-registry-service.js';
import { signInPerson } from '../services/user-service.js';
import { defaultClientKey } from './auth.js';

/**
 * OIDC sign-in (ADR-014, the team profile): the authorization code flow with PKCE, a state
 * and a nonce, through `openid-client`.
 *
 * - `GET /api/v1/auth/oidc/start` sends the browser to the provider. The PKCE verifier, the
 *   state and the nonce travel in a short-lived `httpOnly` cookie signed under
 *   `COOKIE_SECRET`, so nothing about a sign-in in progress is held in this process.
 * - `GET /api/v1/auth/oidc/callback` exchanges the code. `openid-client` checks the state, the
 *   nonce, the PKCE verifier and the ID token's signature, issuer, audience and expiry; this
 *   route then refuses an unverified email or one outside `OIDC_ALLOWED_DOMAINS`, signs the
 *   person in through `signInPerson`, and issues a session that names them.
 *
 * Both answer a coded 404 until OIDC is configured with a database, as the GitHub receiver
 * does, so an install that never opted in has nothing to probe. A failed callback redirects
 * to `/?signin=<reason>` rather than answering JSON, because a browser is on the other end.
 */
export interface OidcRouteOptions extends Partial<Pick<ProjectRegistryServiceOptions, 'db'>> {
  oidc?: OidcConfig;
  workspaceId: string;
  sessions: AuthSessionBackend;
  installationId: string;
  cookieSecret: string;
  sessionTtlMs: number;
  secureCookies: SecureCookies;
  trustProxy?: boolean;
  log?: (message: string, fields: Record<string, unknown>) => void;
}

const FLOW_COOKIE = 'automate_oidc';
const SESSION_COOKIE = 'automate_session';
/** A sign-in in progress outlives a slow provider page, not a lunch break. */
const FLOW_TTL_MS = 10 * 60_000;

interface Flow {
  state: string;
  nonce: string;
  verifier: string;
  expiresAt: number;
}

function sealFlow(secret: string, flow: Flow): string {
  const payload = Buffer.from(JSON.stringify(flow)).toString('base64url');
  return `${payload}.${hashCredential(secret, `oidc:${payload}`)}`;
}

function openFlow(secret: string, value: string | undefined, now: number): Flow | null {
  if (value === undefined) return null;
  const [payload, signature] = value.split('.');
  if (payload === undefined || signature === undefined) return null;
  if (!/^[0-9a-f]{64}$/u.test(signature)) return null;
  if (!verifyCredential(secret, `oidc:${payload}`, signature)) return null;
  try {
    const flow = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Flow;
    return typeof flow.expiresAt === 'number' && flow.expiresAt > now ? flow : null;
  } catch {
    return null;
  }
}

function groupsOf(claims: Record<string, unknown>): string[] {
  const groups = claims['groups'];
  return Array.isArray(groups)
    ? groups.filter((group): group is string => typeof group === 'string')
    : [];
}

export function createOidcRoutes(options: OidcRouteOptions): Hono {
  const app = new Hono();
  const limiter = createRateLimiter({ limit: 20, windowMs: 60_000 });
  let discovered: Promise<client.Configuration> | null = null;

  const configured = (): { oidc: OidcConfig; db: NonNullable<OidcRouteOptions['db']> } => {
    if (options.oidc === undefined || options.db === undefined) {
      throw new DomainError(
        ErrorCode.OIDC_NOT_CONFIGURED,
        'Single sign-on is off: it needs OIDC_ISSUER, OIDC_CLIENT_ID and a database',
      );
    }
    return { oidc: options.oidc, db: options.db };
  };

  const throttle = (context: Context): void => {
    const budget = limiter.consume(
      `oidc:${defaultClientKey(context, options.trustProxy ?? false)}`,
    );
    if (!budget.allowed) {
      context.header('retry-after', String(budget.retryAfterSeconds));
      throw new DomainError('RATE_LIMITED', 'Too many sign-in attempts');
    }
  };

  /** Discovery, once; a failure is forgotten so the next sign-in tries again. */
  const configuration = (oidc: OidcConfig): Promise<client.Configuration> => {
    discovered ??= client
      .discovery(
        new URL(oidc.issuer),
        oidc.clientId,
        oidc.clientSecret,
        undefined,
        // The configuration refuses plain HTTP off this machine, so this is a local provider.
        oidc.issuer.startsWith('http:') ? { execute: [client.allowInsecureRequests] } : undefined,
      )
      .catch((error: unknown) => {
        discovered = null;
        throw error;
      });
    return discovered;
  };

  const redirectWith = (context: Context, reason: string, fields: Record<string, unknown> = {}) => {
    options.log?.('single sign-on refused', { reason, ...fields });
    deleteCookie(context, FLOW_COOKIE, { path: '/api/v1/auth/oidc' });
    return context.redirect(`/?signin=${reason}`, 302);
  };

  app.get('/api/v1/auth/oidc/start', async (context) => {
    const { oidc } = configured();
    throttle(context);
    const config = await configuration(oidc);
    const flow: Flow = {
      state: client.randomState(),
      nonce: client.randomNonce(),
      verifier: client.randomPKCECodeVerifier(),
      expiresAt: Date.now() + FLOW_TTL_MS,
    };
    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: oidc.redirectUri,
      scope: 'openid email profile',
      code_challenge: await client.calculatePKCECodeChallenge(flow.verifier),
      code_challenge_method: 'S256',
      state: flow.state,
      nonce: flow.nonce,
    });
    setCookie(context, FLOW_COOKIE, sealFlow(options.cookieSecret, flow), {
      httpOnly: true,
      // The provider sends the browser back with a top-level GET, which Lax allows.
      sameSite: 'Lax',
      secure: isSecureFor(options.secureCookies, context),
      path: '/api/v1/auth/oidc',
      maxAge: Math.floor(FLOW_TTL_MS / 1000),
    });
    return context.redirect(url.href, 302);
  });

  app.get('/api/v1/auth/oidc/callback', async (context) => {
    const { oidc, db } = configured();
    throttle(context);
    const flow = openFlow(options.cookieSecret, getCookie(context, FLOW_COOKIE), Date.now());
    if (flow === null) return redirectWith(context, 'expired');
    // The URL the provider redirected to, as the provider saw it: behind the edge, the
    // request URL this process sees names the proxy, not the public origin.
    const current = new URL(oidc.redirectUri);
    current.search = new URL(context.req.url).search;
    let claims: Record<string, unknown>;
    try {
      const tokens = await client.authorizationCodeGrant(await configuration(oidc), current, {
        pkceCodeVerifier: flow.verifier,
        expectedState: flow.state,
        expectedNonce: flow.nonce,
        idTokenExpected: true,
      });
      claims = (tokens.claims() ?? {}) as Record<string, unknown>;
    } catch (error) {
      return redirectWith(context, 'failed', {
        error: error instanceof Error ? error.name : 'error',
      });
    }
    const email = typeof claims['email'] === 'string' ? claims['email'].toLowerCase() : '';
    const subject = typeof claims['sub'] === 'string' ? claims['sub'] : '';
    if (email === '' || subject === '') return redirectWith(context, 'failed');
    if (claims['email_verified'] === false) return redirectWith(context, 'unverified');
    const domain = email.slice(email.lastIndexOf('@') + 1);
    if (oidc.allowedDomains.length > 0 && !oidc.allowedDomains.includes(domain)) {
      return redirectWith(context, 'domain', { domain });
    }
    const scope = { db, workspaceId: options.workspaceId };
    const outcome = await signInPerson(
      scope,
      {
        issuer: oidc.issuer,
        subject,
        email,
        name: typeof claims['name'] === 'string' ? claims['name'] : null,
        groups: groupsOf(claims),
      },
      { roleMap: oidc.roleMap, defaultRole: oidc.defaultRole },
    );
    if (!outcome.ok) return redirectWith(context, outcome.reason);
    const issued = await options.sessions.issue(options.installationId, outcome.userId);
    await audit(scope, {
      actor: `user:${outcome.userId}`,
      action: 'user.sign-in',
      resourceType: 'user',
      resourceId: outcome.userId,
      details: { method: 'oidc', role: outcome.role },
    });
    deleteCookie(context, FLOW_COOKIE, { path: '/api/v1/auth/oidc' });
    setCookie(context, SESSION_COOKIE, issued.token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: isSecureFor(options.secureCookies, context),
      path: '/',
      maxAge: Math.floor(options.sessionTtlMs / 1000),
    });
    return context.redirect('/', 302);
  });

  return app;
}
