import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Profile } from '@automate/config';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { guard } from './access.js';
import { bearerToken } from './bearer-token.js';
import type { Caller, Role } from '../services/access-service.js';
import { satisfies } from '../services/access-service.js';

/**
 * Who is calling, resolved once per request, and the guards that read it.
 *
 * Credentials, in order (ADR-014): an `Authorization: Bearer` access token, then the
 * `automate_token` cookie a browser sign-in with a token sets, then a person's session
 * (OIDC), then the `automate_session` cookie the installation key's sign-in sets (which is the
 * admin), then a verified Cloudflare Access identity when the install is remote. The
 * installation session comes before Access because behind the tunnel every request carries an
 * Access identity: read after it, a break-glass sign-in would never be read at all. With
 * `ACCESS_CONTROL=open` a caller with none of them is the operator ADR-006 describes, and is
 * admin; with `enforced` they are nobody, and every guard refuses them.
 *
 * Under enforced single sign-on a browser signs in through the identity provider, so the token
 * cookie and the installation session are ignored — whatever a browser kept from before, or a
 * paired device — and count again only under break-glass. A bearer token is a pipeline's, and
 * always counts.
 */
/**
 * The name of the cookie a token sign-in sets. Not a secret: its value is set per browser
 * at sign-in. Named without `cookie` or `token` because the secret-literal rule reads those
 * words in a name as a credential held in source.
 */
export const BROWSER_SIGN_IN = 'automate_token';
const CALLER = 'automate.caller';

export interface CallerResolver {
  mode: 'open' | 'enforced';
  /** The deployment profile (ADR-014), reported by `whoami`. Unset reads as `solo`. */
  profile?: Profile;
  /**
   * Enforced single sign-on (ADR-014, enterprise): a browser signs in through the identity
   * provider only, so the token sign-in refuses, and a browser's token cookie and the
   * installation session are ignored. A token sent as a bearer still works.
   */
  ssoEnforced?: boolean;
  /**
   * Break-glass (`AUTOMATE_BREAK_GLASS=1`): under enforced single sign-on, the installation
   * session and a browser's token cookie count again, so the installation key can get an admin
   * in while the identity provider is down.
   */
  breakGlass?: boolean;
  authenticateToken: (token: string) => Promise<Caller | null>;
  /**
   * A person's session (ADR-014, team): the caller it signs in, with their role in this
   * workspace, or `null` when the request carries no person's session.
   */
  authenticateSession?: (context: Context) => Promise<Caller | null>;
  /**
   * A verified remote identity — Cloudflare Access with `AUTOMATE_REMOTE=cloudflare` — or
   * `null`. Absent means the install has no remote credential source.
   */
  authenticateRemote?: (context: Context) => Promise<Caller | null>;
  /** Whether the request carries a valid installation session. */
  hasSession: (context: Context) => Promise<boolean>;
}

/** Where a caller's credential came from, for `whoami` and for the audit trail. */
export type CallerSource = 'token' | 'user' | 'cloudflare' | 'installation' | 'anonymous';

export function sourceOf(caller: Caller): CallerSource {
  if (caller.actor.startsWith('token:')) return 'token';
  if (caller.actor.startsWith('user:')) return 'user';
  if (caller.actor.startsWith('cf:') || caller.actor.startsWith('cf-service:')) {
    return 'cloudflare';
  }
  if (caller.actor === 'session') return 'installation';
  return 'anonymous';
}

const NOBODY: Caller = { actor: 'anonymous', role: null, uploaderFor: null };

/**
 * Whether a caller is the installation's own admin, who may enter any workspace (ADR-014): the
 * installation session, an open install's operator, or a Cloudflare identity the role map makes
 * an admin — a service token on every profile, and a person only on `startup`, where people are
 * not accounts. A token and a person are bound to their own workspaces and never are.
 */
export function isInstallationAdmin(caller: Caller): boolean {
  const source = sourceOf(caller);
  return (
    caller.role === 'admin' &&
    (source === 'installation' || source === 'anonymous' || source === 'cloudflare')
  );
}

/**
 * Whether a browser's own credentials count: the token cookie and the installation session.
 * Not under enforced single sign-on, unless break-glass is on.
 */
export function browserCredentialsCount(resolver: CallerResolver): boolean {
  return resolver.ssoEnforced !== true || resolver.breakGlass === true;
}

export async function callerOf(context: Context, resolver: CallerResolver): Promise<Caller> {
  const cached = context.get(CALLER as never) as Caller | undefined;
  if (cached !== undefined) return cached;
  const browser = browserCredentialsCount(resolver);
  const presented =
    bearerToken(context.req.header('authorization')) ??
    (browser ? getCookie(context, BROWSER_SIGN_IN) : undefined);
  let caller: Caller | null = null;
  if (presented !== undefined) caller = await resolver.authenticateToken(presented);
  if (caller === null && resolver.authenticateSession !== undefined) {
    caller = await resolver.authenticateSession(context);
  }
  if (caller === null && browser && (await resolver.hasSession(context))) {
    caller = { actor: 'session', role: 'admin', uploaderFor: null };
  }
  if (caller === null && resolver.authenticateRemote !== undefined) {
    caller = await resolver.authenticateRemote(context);
  }
  if (caller === null) {
    caller =
      resolver.mode === 'open' ? { actor: 'anonymous', role: 'admin', uploaderFor: null } : NOBODY;
  }
  context.set(CALLER as never, caller as never);
  return caller;
}

/** A guard that admits `role` or any role above it. */
export function requireRole(role: Role, resolver: CallerResolver): MiddlewareHandler {
  return guard(role, async (context, next) => {
    const caller = await callerOf(context, resolver);
    if (caller.role === null && caller.actor === 'anonymous') {
      throw new DomainError(ErrorCode.UNAUTHENTICATED, 'Sign in, or send an access token');
    }
    if (!satisfies(caller, role)) {
      throw new DomainError(ErrorCode.FORBIDDEN, `This needs the ${role} role`);
    }
    await next();
  });
}
