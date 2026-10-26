import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, lt, notInArray, or } from 'drizzle-orm';
import { webhookDeliveries } from '@automate/db';
import type { GitHubWebhookAck } from '@automate/shared-contracts';
import { z } from 'zod/v4';
import {
  enabledSourcesForRepository,
  queueDeliverySync,
  type DeliveryOptions,
} from './delivery-service.js';

/**
 * The GitHub webhook receiver's decisions, apart from HTTP.
 *
 * ## The signature is the credential
 *
 * GitHub signs the raw body with the shared secret (`X-Hub-Signature-256: sha256=<hex>`).
 * The signature is checked over the bytes exactly as they arrived, before anything is parsed,
 * with a length check and `timingSafeEqual`, so neither a parser nor the comparison's timing
 * says anything about the secret to a caller without it.
 *
 * ## A verified request is still not trusted
 *
 * The payload is GitHub's description of an event, and a description is not data this install
 * stores. The receiver reads **one** field from it — the repository's full name — and only to
 * decide which of this workspace's projects to sync; the sync then asks GitHub's API with the
 * project's own token. A forged or stale payload can therefore at most cause a sync, which
 * reads what GitHub says now.
 *
 * ## Replay
 *
 * A captured request re-sent later verifies. GitHub's signature covers the body and not the
 * `X-GitHub-Delivery` header, so a replay is refused on either key: every accepted delivery's
 * id **and** the sha256 of its raw body are kept in `webhook_deliveries` (each unique per
 * workspace), and a second of either is refused — GitHub's own "Redeliver" re-sends both
 * unchanged, so it is refused the same way. The table holds {@link WEBHOOK_RETENTION_DAYS} days
 * and at most {@link WEBHOOK_RETENTION_ROWS} rows per workspace; a replay older than that
 * queues a sync of data the schedule has long since read. A delivery whose handling failed is
 * forgotten ({@link forgetWebhookDelivery}), so GitHub's retry of it is accepted.
 */

/** The events that say something a delivery sync reads changed. Anything else is ignored. */
export const GITHUB_WEBHOOK_EVENTS = [
  'pull_request',
  'pull_request_review',
  'deployment_status',
  'push',
  'release',
  'workflow_run',
] as const;

export const WEBHOOK_RETENTION_DAYS = 7;
export const WEBHOOK_RETENTION_ROWS = 10_000;
/** GitHub caps a webhook payload at 25 MB; the events this reads are far below 1 MB. */
export const WEBHOOK_MAX_BYTES = 1024 * 1024;

/** Whether `header` is GitHub's HMAC-SHA256 of exactly these bytes under `secret`. */
export function verifyGitHubSignature(
  secret: string,
  body: Uint8Array,
  header: string | undefined,
): boolean {
  const match = /^sha256=([0-9a-f]{64})$/iu.exec(header ?? '');
  if (match === null) return false;
  const presented = Buffer.from(match[1] as string, 'hex');
  const expected = createHmac('sha256', secret).update(body).digest();
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/**
 * Records a delivery — its id and the sha256 of its raw body — and answers the row's id when
 * neither was seen before, `null` for a replay. Prunes the workspace's deliveries past the
 * retention, so the table cannot grow without bound.
 */
export async function recordWebhookDelivery(
  options: DeliveryOptions,
  deliveryId: string,
  event: string,
  body: Uint8Array,
): Promise<string | null> {
  const now = options.now?.() ?? new Date();
  const bodySha256 = createHash('sha256').update(body).digest('hex');
  const inserted = await options.db
    .insert(webhookDeliveries)
    .values({ workspaceId: options.workspaceId, deliveryId, event, bodySha256, receivedAt: now })
    // Either unique key: the id GitHub names, or the body it signed.
    .onConflictDoNothing()
    .returning({ id: webhookDeliveries.id });
  const scope = eq(webhookDeliveries.workspaceId, options.workspaceId);
  const keep = options.db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(scope)
    .orderBy(desc(webhookDeliveries.receivedAt), desc(webhookDeliveries.id))
    .limit(WEBHOOK_RETENTION_ROWS);
  await options.db
    .delete(webhookDeliveries)
    .where(
      and(
        scope,
        or(
          lt(
            webhookDeliveries.receivedAt,
            new Date(now.getTime() - WEBHOOK_RETENTION_DAYS * 86_400_000),
          ),
          notInArray(webhookDeliveries.id, keep),
        ),
      ),
    );
  return inserted[0]?.id ?? null;
}

/**
 * Forgets a recorded delivery whose handling failed, so GitHub's own retry of it is not
 * refused as a replay and the event is not lost.
 */
export async function forgetWebhookDelivery(options: DeliveryOptions, id: string): Promise<void> {
  await options.db
    .delete(webhookDeliveries)
    .where(
      and(eq(webhookDeliveries.workspaceId, options.workspaceId), eq(webhookDeliveries.id, id)),
    );
}

const RepositoryFieldSchema = z.object({
  repository: z.object({ full_name: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u) }),
});

export function isHandledEvent(event: string): boolean {
  return (GITHUB_WEBHOOK_EVENTS as readonly string[]).includes(event);
}

/** Queues a sync for each enabled source of the repository the payload names. */
export async function handleGitHubEvent(
  options: DeliveryOptions,
  event: string,
  payload: unknown,
): Promise<GitHubWebhookAck> {
  if (!isHandledEvent(event)) return { status: 'ignored', event, reason: 'event', queued: 0 };
  const parsed = RepositoryFieldSchema.safeParse(payload);
  if (!parsed.success) {
    return { status: 'ignored', event, reason: 'no-repository', queued: 0 };
  }
  const sources = await enabledSourcesForRepository(options, parsed.data.repository.full_name);
  if (sources.length === 0) {
    return { status: 'ignored', event, reason: 'unknown-repository', queued: 0 };
  }
  for (const source of sources) await queueDeliverySync(options, source, 'webhook');
  return { status: 'queued', event, reason: null, queued: sources.length };
}
