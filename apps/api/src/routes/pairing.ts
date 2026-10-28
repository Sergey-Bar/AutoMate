import { Hono, type Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import {
  BROWSER_SIGN_IN,
  browserCredentialsCount,
  callerOf,
  requireRole,
  type CallerResolver,
} from '../http/roles.js';
import { isSecureFor, type SecureCookies } from '../http/secure-cookies.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { audit } from '../services/access-service.js';
import {
  IssuePairingCodeBodySchema,
  RedeemPairingCodeBodySchema,
  issuePairingCode,
  redeemPairingCode,
  type RedeemedPairing,
} from '../services/pairing-service.js';
import type { ProjectRegistryServiceOptions } from '../services/project-registry-service.js';

export interface PairingRouteOptions extends Pick<
  ProjectRegistryServiceOptions,
  'db' | 'workspaceId'
> {
  access: CallerResolver;
  /** The HMAC key pairing codes are stored under: the installation's cookie secret. */
  pepper: string | undefined;
  /** Where a device opens the pairing link. A QR code carries `<publicAppUrl>/dashboard/pair?code=…`. */
  publicAppUrl: string;
  /** The client address the per-client budget is keyed on. `defaultClientKey` in production. */
  clientKey: (context: Context) => string;
  secureCookies?: SecureCookies;
  now?: () => Date;
}

/** Five wrong codes a minute from one client; thirty in ten minutes from everyone. */
const PER_CLIENT = { limit: 5, windowMs: 60_000 };
const INSTALLATION_WIDE = { limit: 30, windowMs: 10 * 60_000 };

/**
 * `POST /api/v1/pairing-codes` (admin) issues a code; `POST /api/v1/pair` (open — the device
 * has no credential yet) spends it for a sign-in cookie.
 *
 * Two budgets, because one is not enough: a per-client limit alone is defeated by a
 * guesser with many addresses, and a LAN has plenty. The installation-wide budget is what
 * bounds the total number of guesses against the million values while a code is live.
 *
 * A device has no credential, so the default workspace serves `POST /api/v1/pair` whichever
 * workspace issued the code: the code is found across the installation, and the device's
 * token, and the audit row, are the issuing workspace's. Under enforced single sign-on a
 * device would carry exactly the browser token cookie the caller resolver ignores, so pairing
 * is refused, as the token sign-in is, unless break-glass is on.
 */
export function createPairingRoutes(options: PairingRouteOptions): Hono {
  const app = new Hono();
  const admin = requireRole('admin', options.access);
  const perClient = createRateLimiter(PER_CLIENT);
  const everyone = createRateLimiter(INSTALLATION_WIDE);
  const service = () => {
    if (options.pepper === undefined || options.pepper === '') {
      throw new DomainError(ErrorCode.NOT_CONFIGURED, 'Device pairing is not configured');
    }
    return {
      db: options.db,
      workspaceId: options.workspaceId,
      pepper: options.pepper,
      ...(options.now === undefined ? {} : { now: options.now }),
    };
  };
  /** Where a redeemed code is recorded: the workspace that issued it, which its token is in. */
  const issuing = (redeemed: RedeemedPairing) => ({
    db: options.db,
    workspaceId: redeemed.workspaceId,
  });

  app.post('/api/v1/pairing-codes', admin, async (context) => {
    const parsed = IssuePairingCodeBodySchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) {
      throw new DomainError(ErrorCode.INVALID_REQUEST_BODY, 'Invalid pairing request', {
        details: { issues: parsed.error.issues },
      });
    }
    const actor = (await callerOf(context, options.access)).actor;
    const pairing = service();
    const issued = await issuePairingCode(pairing, parsed.data, actor);
    await audit(pairing, {
      actor,
      action: 'pairing-code.issue',
      resourceType: 'pairing_code',
      resourceId: issued.id,
      details: { role: issued.role, deviceName: issued.deviceName },
    });
    const base = options.publicAppUrl.replace(/\/$/u, '');
    return context.json({ ...issued, pairUrl: `${base}/dashboard/pair?code=${issued.code}` }, 201);
  });

  app.post('/api/v1/pair', async (context) => {
    for (const [limiter, key] of [
      [perClient, `pair:${options.clientKey(context)}`],
      [everyone, 'pair:*'],
    ] as const) {
      const budget = limiter.consume(key);
      if (!budget.allowed) {
        context.header('retry-after', String(budget.retryAfterSeconds));
        throw new DomainError(ErrorCode.LOGIN_RATE_LIMITED, 'Too many pairing attempts');
      }
    }
    // Before any code is read, so a refused device spends nothing and learns nothing.
    if (!browserCredentialsCount(options.access)) {
      throw new DomainError(
        ErrorCode.SSO_ENFORCED,
        'Single sign-on is enforced: sign in with your identity provider',
      );
    }
    const parsed = RedeemPairingCodeBodySchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success)
      throw new DomainError(ErrorCode.INVALID_PAIRING_CODE, 'That code is wrong or has expired');
    const pairing = service();
    const redeemed = await redeemPairingCode(pairing, parsed.data.code.trim());
    await audit(issuing(redeemed), {
      actor: `token:${redeemed.tokenId}`,
      action: 'pairing-code.redeem',
      resourceType: 'access_token',
      resourceId: redeemed.tokenId,
      details: { role: redeemed.role, deviceName: redeemed.deviceName },
    });
    setCookie(context, BROWSER_SIGN_IN, redeemed.token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: isSecureFor(options.secureCookies, context),
      path: '/',
      // A paired device stays paired: thirty days, then pair again. Revoking the device on
      // the Access page ends it sooner.
      maxAge: 30 * 24 * 3600,
    });
    return context.json({ role: redeemed.role, deviceName: redeemed.deviceName });
  });

  return app;
}
