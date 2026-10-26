import { createHash, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { guard } from './access.js';
import { bearerToken } from './bearer-token.js';
import { callerOf, type CallerResolver } from './roles.js';

/**
 * The credential a CI job presents to push evidence about one project: the health report
 * upload, the gate report, CODEOWNERS, and the delivery push door all take the same one.
 *
 * One guard, shared, rather than a copy per route group: a second copy is a second place the
 * rule can be weakened, and the authz matrix would show the two as one access class while
 * they drifted apart underneath it.
 */
export interface UploaderGuardOptions {
  access: CallerResolver;
  /** The reporter secret. Unset outside production: uploads are open. */
  reporterSecret?: string | undefined;
  /** Refuse uploads when no secret is configured, rather than accepting them openly. */
  requireReporterSecret?: boolean | undefined;
}

function sameSecret(presented: string, expected: string): boolean {
  // Hashed first so the comparison is constant-time over equal-length buffers.
  const left = createHash('sha256').update(presented).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

/**
 * Admits the reporter secret, or an access token: an uploader token pinned to the project in
 * the path (`:id`), or an operator's. With no reporter secret configured outside production,
 * an upload is admitted openly, as the reporter routes admit one.
 */
export function uploaderGuard(options: UploaderGuardOptions): MiddlewareHandler {
  return guard('reporter-secret', async (context, next) => {
    const presented = bearerToken(context.req.header('authorization'));
    if (presented !== undefined && presented.startsWith('amt_')) {
      const caller = await callerOf(context, options.access);
      const project = context.req.param('id');
      if (caller.uploaderFor === project || caller.role === 'operator' || caller.role === 'admin') {
        await next();
        return;
      }
      throw new DomainError(ErrorCode.FORBIDDEN, 'This token cannot upload to this project');
    }
    const secret = options.reporterSecret;
    if (secret === undefined || secret === '') {
      if (options.requireReporterSecret === true) {
        throw new DomainError(
          ErrorCode.NOT_CONFIGURED,
          'Health uploads are unavailable until REPORTER_SECRET is configured',
        );
      }
      await next();
      return;
    }
    if (presented === undefined) {
      throw new DomainError(
        ErrorCode.MISSING_REPORTER_TOKEN,
        'Missing reporter authentication token',
      );
    }
    if (!sameSecret(presented, secret)) {
      throw new DomainError(
        ErrorCode.INVALID_REPORTER_TOKEN,
        'Invalid reporter authentication token',
      );
    }
    await next();
  });
}

/** Who an upload is from, for the audit row: the token's actor, or `reporter`. */
export async function uploaderActor(
  context: Parameters<MiddlewareHandler>[0],
  access: CallerResolver,
): Promise<string> {
  return bearerToken(context.req.header('authorization'))?.startsWith('amt_') === true
    ? (await callerOf(context, access)).actor
    : 'reporter';
}
