import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { GitHubWebhookAck } from '@automate/shared-contracts';
import { domainErrorResponse } from '../errors/boundary.js';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { audit } from '../services/access-service.js';
import type { DeliveryOptions } from '../services/delivery-service.js';
import {
  WEBHOOK_MAX_BYTES,
  forgetWebhookDelivery,
  handleGitHubEvent,
  isHandledEvent,
  recordWebhookDelivery,
  verifyGitHubSignature,
} from '../services/github-webhook.js';

/**
 * `POST /api/v1/webhooks/github`: GitHub telling this install that a repository changed.
 *
 * **Opt-in twice.** It answers only with `AUTOMATE_LAN_MODE=1` *and* `GITHUB_WEBHOOK_SECRET`
 * set; otherwise it is a coded 404, so an install that never opted in has no receiver to probe.
 * A loopback-only install cannot be reached by GitHub anyway, and a receiver with no secret
 * could not tell GitHub from anyone else.
 *
 * It carries no role guard and is in `PUBLIC_ROUTES`: GitHub has no session or token here, and
 * the HMAC signature over the raw body is the credential (`services/github-webhook.ts`). Order
 * matters and is fixed: configured → per-client budget → 1 MB limit → signature → replay →
 * event. Nothing is parsed, and nothing is written, before the signature verified.
 */
export interface GitHubWebhookRouteOptions extends DeliveryOptions {
  lanMode: boolean | undefined;
  secret: string | undefined;
  /** The client address the budget is keyed on. `defaultClientKey` in production. */
  clientKey: (context: Context) => string;
  /** Runs queued syncs now rather than at the next interval. */
  syncNow?: () => Promise<unknown>;
}

/** GitHub sends bursts on a busy repository; this bounds what one address can make us hash. */
const PER_CLIENT = { limit: 120, windowMs: 60_000 };

const DELIVERY_ID = /^[A-Za-z0-9-]{1,100}$/u;
const EVENT = /^[a-z_]{1,50}$/u;

/** A handled event's payload as JSON; an ignored event's is never parsed. */
function parsePayload(event: string, raw: Uint8Array): unknown {
  if (!isHandledEvent(event)) return null;
  try {
    return JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new DomainError(
      ErrorCode.INVALID_JSON,
      'The payload is not JSON; set the webhook content type to application/json',
    );
  }
}

export function createGitHubWebhookRoutes(options: GitHubWebhookRouteOptions): Hono {
  const app = new Hono();
  const limiter = createRateLimiter(PER_CLIENT);

  const configured: MiddlewareHandler = async (_context, next) => {
    // A presence check, not a comparison: whether a secret is configured says nothing about
    // its bytes. Read into a local so the check is on a value, not on a secret-named member.
    const { secret } = options;
    if (options.lanMode !== true || secret === undefined || secret.length === 0) {
      throw new DomainError(
        ErrorCode.WEBHOOK_NOT_CONFIGURED,
        'The GitHub webhook receiver is off: it needs AUTOMATE_LAN_MODE=1 or ' +
          'AUTOMATE_REMOTE=cloudflare, and GITHUB_WEBHOOK_SECRET',
      );
    }
    await next();
  };

  const budget: MiddlewareHandler = async (context, next) => {
    const decision = limiter.consume(`github-webhook:${options.clientKey(context)}`);
    if (!decision.allowed) {
      context.header('retry-after', String(decision.retryAfterSeconds));
      throw new DomainError(ErrorCode.RATE_LIMITED, 'Too many webhook deliveries');
    }
    await next();
  };

  app.post(
    '/api/v1/webhooks/github',
    configured,
    budget,
    bodyLimit({
      maxSize: WEBHOOK_MAX_BYTES,
      onError: (context) =>
        domainErrorResponse(
          context,
          new DomainError(ErrorCode.PAYLOAD_TOO_LARGE, 'Webhook payload larger than 1 MB'),
        ),
    }),
    async (context) => {
      const raw = new Uint8Array(await context.req.arrayBuffer());
      if (
        !verifyGitHubSignature(
          options.secret as string,
          raw,
          context.req.header('x-hub-signature-256'),
        )
      ) {
        throw new DomainError(
          ErrorCode.INVALID_WEBHOOK_SIGNATURE,
          'The X-Hub-Signature-256 header is missing or does not verify',
        );
      }
      const deliveryId = context.req.header('x-github-delivery') ?? '';
      const event = context.req.header('x-github-event') ?? '';
      if (!DELIVERY_ID.test(deliveryId) || !EVENT.test(event)) {
        throw new DomainError(
          ErrorCode.INVALID_REQUEST,
          'X-GitHub-Delivery and X-GitHub-Event are required',
        );
      }
      const recorded = await recordWebhookDelivery(options, deliveryId, event, raw);
      if (recorded === null) {
        throw new DomainError(ErrorCode.WEBHOOK_REPLAYED, 'This delivery was already received');
      }
      let ack: GitHubWebhookAck;
      try {
        ack = await handleGitHubEvent(options, event, parsePayload(event, raw));
      } catch (error) {
        // Not handled, so not received: GitHub's retry of it must not be refused as a replay.
        await forgetWebhookDelivery(options, recorded);
        throw error;
      }
      await audit(options, {
        actor: 'github-webhook',
        action: 'delivery.webhook.receive',
        resourceType: 'webhook_delivery',
        resourceId: deliveryId,
        details: { event, status: ack.status, reason: ack.reason, queued: ack.queued },
      });
      if (ack.queued > 0) void options.syncNow?.().catch(() => undefined);
      return context.json(ack, 202);
    },
  );

  return app;
}
