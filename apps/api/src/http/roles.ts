import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { guard } from './access.js';
import { bearerToken } from './bearer-token.js';
import type { Caller, Role } from '../services/access-service.js';
import { satisfies } from '../services/access-service.js';

/**
 * Who is calling, resolved once per request, and the guards that read it.
 *
 * Credentials, in order: an `Authorization: Bearer` access token, then the `automate_token`
 * cookie a browser sign-in with a token sets, then the `automate_session` cookie the
 * installation key's sign-in sets (which is the admin). With `ACCESS_CONTROL=open` a caller
 * with none of them is the operator ADR-006 describes, and is admin; with `enforced` they are
 * nobody, and every guard refuses them.
 */
export const TOKEN_COOKIE = 'automate_token';
const CALLER = 'automate.caller';

export interface CallerResolver {
  mode: 'open' | 'enforced';
  authenticateToken: (token: string) => Promise<Caller | null>;
  /** Whether the request carries a valid installation session. */
  hasSession: (context: Context) => Promise<boolean>;
}

const NOBODY: Caller = { actor: 'anonymous', role: null, uploaderFor: null };

export async function callerOf(context: Context, resolver: CallerResolver): Promise<Caller> {
  const cached = context.get(CALLER as never) as Caller | undefined;
  if (cached !== undefined) return cached;
  const presented =
    bearerToken(context.req.header('authorization')) ?? getCookie(context, TOKEN_COOKIE);
  let caller: Caller | null = null;
  if (presented !== undefined) caller = await resolver.authenticateToken(presented);
  if (caller === null && (await resolver.hasSession(context))) {
    caller = { actor: 'session', role: 'admin', uploaderFor: null };
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
