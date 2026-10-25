import { and, eq, sql } from 'drizzle-orm';
import { reportDeliveries, reportSubscriptions, type ReportDeliveryRow } from '@automate/db';
import type { ConnectorAdapter, ConnectorRequest } from '@automate/connectors-sdk';
import type { ChannelKind, ChannelSummary } from '@automate/shared-contracts';
import {
  composeReport,
  renderPlain,
  renderSlack,
  renderTeams,
  renderTelegram,
  type ReportModel,
} from '@automate/reporting';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';
import { channelWithSecret, loadReport } from './notification-service.js';

/**
 * Sends the reports the worker queued.
 *
 * ## Exactly once, with two of these running
 *
 * A claim is one statement: move up to `batch` due rows to `sending` and push their
 * `next_attempt_at` a lease into the future, choosing them with `FOR UPDATE SKIP LOCKED`.
 * A second dispatcher in the same instant skips the locked rows, and after the commit
 * the rows are no longer due — so each delivery is in exactly one dispatcher's hands. A
 * dispatcher that dies mid-send leaves a `sending` row whose lease lapses, and the next
 * claim takes it again: a crash costs a retry, never a lost report.
 *
 * ## Retries
 *
 * A retryable failure (a rate limit, a refusal that sent nothing) goes back to `pending`
 * with a backoff, up to `maxAttempts`; anything else is `failed` with the adapter's stable
 * error code, which the history list shows. The adapters never retry an ambiguous failure
 * on a send, so a retry here cannot duplicate a message that arrived.
 */
export interface ReportDispatcherOptions {
  db: ProjectRegistryServiceOptions['db'];
  vaultSecret: string | undefined;
  adapters: Partial<Record<Exclude<ChannelKind, 'inbox'>, ConnectorAdapter>>;
  /** The dashboard link a report carries. */
  link: string | null;
  now?: () => Date;
  batch?: number;
  maxAttempts?: number;
  leaseMs?: number;
  log?: (message: string, details: Record<string, unknown>) => void;
}

export interface DispatchOutcome {
  id: string;
  status: 'sent' | 'failed' | 'pending';
  errorCode: string | null;
}

const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];

/** The request for one channel, and the text kept as history. */
export function requestFor(
  channel: ChannelSummary,
  model: ReportModel,
): { request: ConnectorRequest | null; rendered: string } {
  const settings = channel.settings as Record<string, string>;
  const plain = renderPlain(model, 2_000);
  switch (channel.kind) {
    case 'inbox':
      return { request: null, rendered: plain };
    case 'slack': {
      const text = renderSlack(model);
      return {
        request: { operation: 'postMessage', input: { channel: settings['channel'], text } },
        rendered: text,
      };
    }
    case 'teams':
      return {
        request: { operation: 'postCard', input: { message: renderTeams(model) } },
        rendered: plain,
      };
    case 'telegram': {
      const text = renderTelegram(model);
      return {
        request: { operation: 'sendMessage', input: { chatId: settings['chatId'], text } },
        rendered: text,
      };
    }
    case 'whatsapp': {
      // A template's body parameter may not hold a newline, so lines are joined.
      const text = renderPlain(model).replace(/\n/gu, ' · ');
      return {
        request: { operation: 'sendTemplate', input: { ...settings, text } },
        rendered: text,
      };
    }
    case 'signal':
      return {
        request: { operation: 'send', input: { ...settings, message: plain } },
        rendered: plain,
      };
  }
}

export function createReportDispatcher(options: ReportDispatcherOptions) {
  const clock = options.now ?? (() => new Date());
  const maxAttempts = options.maxAttempts ?? 3;
  const leaseMs = options.leaseMs ?? 5 * 60_000;

  async function claim(): Promise<ReportDeliveryRow[]> {
    const at = clock();
    const result = await options.db.execute(sql`
      UPDATE report_deliveries
      SET status = 'sending', attempts = attempts + 1,
          next_attempt_at = ${new Date(at.getTime() + leaseMs).toISOString()}::timestamptz
      WHERE id IN (
        SELECT id FROM report_deliveries
        WHERE status IN ('pending', 'sending')
          AND next_attempt_at <= ${at.toISOString()}::timestamptz
        ORDER BY next_attempt_at
        LIMIT ${options.batch ?? 10}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`);
    const ids = ((result as unknown as { rows: Array<{ id: string }> }).rows ?? []).map(
      (row) => row.id,
    );
    if (ids.length === 0) return [];
    return options.db
      .select()
      .from(reportDeliveries)
      .where(
        sql`${reportDeliveries.id} IN (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      );
  }

  async function finish(
    row: ReportDeliveryRow,
    outcome: DispatchOutcome & { rendered: string | null },
  ) {
    const at = clock();
    const retry = BACKOFF_MS[Math.min(row.attempts - 1, BACKOFF_MS.length - 1)] ?? 60_000;
    await options.db
      .update(reportDeliveries)
      .set({
        status: outcome.status,
        errorCode: outcome.errorCode,
        ...(outcome.rendered === null ? {} : { rendered: outcome.rendered }),
        ...(outcome.status === 'sent' ? { sentAt: at } : {}),
        ...(outcome.status === 'pending' ? { nextAttemptAt: new Date(at.getTime() + retry) } : {}),
      })
      .where(eq(reportDeliveries.id, row.id));
  }

  async function subscriptionOf(row: ReportDeliveryRow) {
    if (row.subscriptionId === null) return null;
    const [subscription] = await options.db
      .select()
      .from(reportSubscriptions)
      .where(
        and(
          eq(reportSubscriptions.workspaceId, row.workspaceId),
          eq(reportSubscriptions.id, row.subscriptionId),
        ),
      )
      .limit(1);
    return subscription ?? null;
  }

  async function deliver(row: ReportDeliveryRow): Promise<DispatchOutcome> {
    const scoped = {
      db: options.db,
      workspaceId: row.workspaceId,
      vaultSecret: options.vaultSecret,
      now: clock,
    };
    const subscription = await subscriptionOf(row);
    const channelId = row.channelId ?? subscription?.channelId ?? null;
    if (channelId === null) {
      const outcome = { id: row.id, status: 'failed' as const, errorCode: 'channel_missing' };
      await finish(row, { ...outcome, rendered: null });
      return outcome;
    }
    try {
      const { channel, secret } = await channelWithSecret(scoped, channelId);
      const model = composeReport(
        await loadReport(scoped, {
          title: subscription?.name ?? 'Test report from Automate',
          windowDays: subscription?.cadence === 'daily' ? 1 : 7,
          link: options.link,
        }),
      );
      const { request, rendered } = requestFor(channel, model);
      if (request === null) {
        const outcome = { id: row.id, status: 'sent' as const, errorCode: null };
        await finish(row, { ...outcome, rendered });
        return outcome;
      }
      const adapter = options.adapters[channel.kind as Exclude<ChannelKind, 'inbox'>];
      if (adapter === undefined || secret === null) {
        const outcome = {
          id: row.id,
          status: 'failed' as const,
          errorCode: `${channel.kind}_not_configured`,
        };
        await finish(row, { ...outcome, rendered });
        return outcome;
      }
      const result = await adapter.execute(request, secret);
      const status =
        result.status === 'ok'
          ? ('sent' as const)
          : result.error?.retryable === true && row.attempts < maxAttempts
            ? ('pending' as const)
            : ('failed' as const);
      const outcome = { id: row.id, status, errorCode: result.error?.code ?? null };
      await finish(row, { ...outcome, rendered });
      return outcome;
    } catch (error) {
      // A channel deleted since it was queued, or a vault that will not open: final, and
      // named, so the history says why rather than showing a row stuck in `sending`.
      const errorCode =
        typeof (error as { code?: unknown }).code === 'string'
          ? `delivery_${String((error as { code: string }).code).toLowerCase()}`
          : 'delivery_failed';
      const outcome = { id: row.id, status: 'failed' as const, errorCode };
      await finish(row, { ...outcome, rendered: null });
      return outcome;
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<unknown> = Promise.resolve();

  return {
    /** One claim, and every claimed delivery sent. */
    async runOnce(): Promise<DispatchOutcome[]> {
      const claimed = await claim();
      const outcomes: DispatchOutcome[] = [];
      for (const row of claimed) outcomes.push(await deliver(row));
      for (const outcome of outcomes) options.log?.('report delivery', { ...outcome });
      return outcomes;
    },
    start(intervalMs: number): void {
      if (timer !== undefined) return;
      timer = setInterval(() => {
        running = running
          .then(() => this.runOnce())
          .catch((error: unknown) =>
            options.log?.('report dispatch failed', {
              error: error instanceof Error ? error.message : String(error),
            }),
          );
      }, intervalMs);
      timer.unref();
    },
    async stop(): Promise<void> {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      await running;
    },
  };
}

export type ReportDispatcher = ReturnType<typeof createReportDispatcher>;
