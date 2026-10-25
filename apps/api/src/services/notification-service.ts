import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { Cron } from 'croner';
import {
  notificationChannels,
  reportDeliveries,
  reportSubscriptions,
  runs,
  schedules,
  type NotificationChannelRow,
  type ReportDeliveryRow,
  type ReportSubscriptionRow,
} from '@automate/db';
import type {
  ChannelKind,
  ChannelSummary,
  CreateChannelBody,
  CreateSubscriptionBody,
  DeliverySummary,
  SubscriptionSummary,
} from '@automate/shared-contracts';
import { buildDigest, type ReportInput } from '@automate/reporting';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { isAllowedWebhook } from './health-integrations.js';
import {
  deleteVaultSecret,
  readVaultSecret,
  storeVaultSecret,
  type VaultOptions,
} from './vault-secrets.js';

/**
 * Scheduled reports: channels, subscriptions, deliveries, and the data a report is made of.
 *
 * ## Who does what
 *
 * Saving a subscription writes a `schedules` row, id `report:<subscriptionId>`, with
 * `run_options.kind = 'report'`. The worker — which has the clock and not the vault — turns
 * each due occurrence into a pending `report_deliveries` row, once (the idempotency key is
 * unique). The API's dispatcher (`report-dispatcher.ts`) claims pending rows, opens the
 * channel's credential, renders, and sends. Nothing here sends.
 *
 * ## Secrets
 *
 * A channel's credential is sealed under `channel:<id>` (`vault-secrets.ts`) and is never
 * returned: `ChannelSummary` has no field for it.
 */
export type NotificationOptions = VaultOptions & { now?: () => Date };

const channelSecretName = (id: string): string => `channel:${id}`;
const scheduleIdFor = (subscriptionId: string): string => `report:${subscriptionId}`;
const UUID = /^[0-9a-f-]{36}$/iu;
const WHAT = 'A notification channel';

function now(options: NotificationOptions): Date {
  return options.now?.() ?? new Date();
}

function channelSummary(row: NotificationChannelRow): ChannelSummary {
  return {
    id: row.id,
    kind: row.kind as ChannelKind,
    name: row.name,
    settings: (row.settings ?? {}) as Record<string, unknown>,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A secret the server will call: refused here rather than on the first delivery. */
function assertCallableSecret(body: CreateChannelBody): void {
  if (body.kind === 'teams' && !isAllowedWebhook(body.secret)) {
    throw new DomainError(
      ErrorCode.INVALID_REQUEST_BODY,
      'A Teams webhook must be an https URL on a public host',
    );
  }
  if (body.kind === 'signal') {
    // The bridge is expected on this machine or the LAN, so a private http address is
    // allowed for this kind alone — but it must be a URL with no credentials in it.
    const url = URL.canParse(body.secret) ? new URL(body.secret) : null;
    if (url === null || !['http:', 'https:'].includes(url.protocol) || url.username !== '') {
      throw new DomainError(
        ErrorCode.INVALID_REQUEST_BODY,
        'The Signal bridge must be an http(s) URL',
      );
    }
  }
}

export async function createChannel(
  options: NotificationOptions,
  body: CreateChannelBody,
): Promise<ChannelSummary> {
  if (body.kind !== 'inbox') assertCallableSecret(body);
  const at = now(options);
  const [row] = await options.db
    .insert(notificationChannels)
    .values({
      workspaceId: options.workspaceId,
      kind: body.kind,
      name: body.name,
      settings: body.settings,
      createdAt: at,
      updatedAt: at,
    })
    .returning();
  const created = row as NotificationChannelRow;
  if (body.kind !== 'inbox') {
    try {
      await storeVaultSecret(options, channelSecretName(created.id), body.secret, WHAT);
    } catch (error) {
      // No half-made channel: one with no credential could only ever fail.
      await options.db.delete(notificationChannels).where(eq(notificationChannels.id, created.id));
      throw error;
    }
  }
  return channelSummary(created);
}

export async function listChannels(options: NotificationOptions): Promise<ChannelSummary[]> {
  const rows = await options.db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.workspaceId, options.workspaceId))
    .orderBy(notificationChannels.createdAt);
  return rows.map(channelSummary);
}

async function channelRow(
  options: NotificationOptions,
  id: string,
): Promise<NotificationChannelRow> {
  const [row] = UUID.test(id)
    ? await options.db
        .select()
        .from(notificationChannels)
        .where(
          and(
            eq(notificationChannels.workspaceId, options.workspaceId),
            eq(notificationChannels.id, id),
          ),
        )
        .limit(1)
    : [];
  if (row === undefined) throw new DomainError(ErrorCode.NOT_FOUND, `No channel ${id}`);
  return row;
}

/** The channel and its opened credential (`null` for the inbox), for the dispatcher only. */
export async function channelWithSecret(
  options: NotificationOptions,
  id: string,
): Promise<{ channel: ChannelSummary; secret: string | null }> {
  const row = await channelRow(options, id);
  const secret =
    row.kind === 'inbox' ? null : await readVaultSecret(options, channelSecretName(row.id), WHAT);
  return { channel: channelSummary(row), secret };
}

export async function deleteChannel(options: NotificationOptions, id: string): Promise<void> {
  const row = await channelRow(options, id);
  const subscriptions = await options.db
    .select({ id: reportSubscriptions.id })
    .from(reportSubscriptions)
    .where(
      and(
        eq(reportSubscriptions.workspaceId, options.workspaceId),
        eq(reportSubscriptions.channelId, row.id),
      ),
    );
  for (const subscription of subscriptions) await deleteSchedule(options, subscription.id);
  await deleteVaultSecret(options, channelSecretName(row.id));
  // Subscriptions go with the channel (cascade); deliveries stay, as history.
  await options.db.delete(notificationChannels).where(eq(notificationChannels.id, row.id));
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The cron a cadence means, in the subscription's own timezone. */
export function cronFor(body: CreateSubscriptionBody): string {
  if (body.cadence === 'custom') return (body.cronExpr ?? '').trim();
  const [hour = '9', minute = '0'] = body.time.split(':').map((part) => String(Number(part)));
  return body.cadence === 'daily'
    ? `${minute} ${hour} * * *`
    : `${minute} ${hour} * * ${String(body.weekday)}`;
}

/** "Every Monday at 09:00", so the page never asks anyone to read cron. */
export function describeCadence(cadence: string, cronExpr: string): string {
  const parts = cronExpr.trim().split(/\s+/u);
  const [minute, hour, dayOfMonth, month, weekday] = parts;
  const simple = (value: string | undefined) => value !== undefined && /^\d+$/u.test(value);
  if (parts.length === 5 && simple(minute) && simple(hour) && dayOfMonth === '*' && month === '*') {
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (weekday === '*') return `Every day at ${time}`;
    if (weekday === '1-5') return `Weekdays at ${time}`;
    if (simple(weekday)) return `Every ${WEEKDAYS[Number(weekday) % 7] ?? 'week'} at ${time}`;
  }
  return cadence === 'custom' ? `Custom: ${cronExpr}` : cronExpr;
}

/**
 * The first occurrence after `after`, or a refusal naming what is wrong.
 *
 * Validated here, on save, because the worker validates at poll time: a bad expression
 * saved today would otherwise fail every poll from now on with nothing on the page to say so.
 */
export function nextOccurrence(cronExpr: string, timezone: string, after: Date): Date {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new DomainError(ErrorCode.INVALID_SCHEDULE, `Unknown timezone ${timezone}`);
  }
  let cron: Cron;
  try {
    cron = new Cron(cronExpr, { timezone, paused: true });
  } catch {
    throw new DomainError(ErrorCode.INVALID_SCHEDULE, `Not a cron expression: ${cronExpr}`);
  }
  const next = cron.nextRun(after);
  if (next === null) throw new DomainError(ErrorCode.INVALID_SCHEDULE, 'The schedule never fires');
  return next;
}

function subscriptionSummary(
  row: ReportSubscriptionRow,
  nextRunAt: string | null,
): SubscriptionSummary {
  return {
    id: row.id,
    channelId: row.channelId,
    name: row.name,
    cadence: row.cadence as SubscriptionSummary['cadence'],
    cronExpr: row.cronExpr,
    timezone: row.timezone,
    enabled: row.enabled,
    describe: describeCadence(row.cadence, row.cronExpr),
    nextRunAt,
  };
}

export async function createSubscription(
  options: NotificationOptions,
  body: CreateSubscriptionBody,
): Promise<SubscriptionSummary> {
  const channel = await channelRow(options, body.channelId);
  const cronExpr = cronFor(body);
  const at = now(options);
  const next = nextOccurrence(cronExpr, body.timezone, at);
  const [row] = await options.db
    .insert(reportSubscriptions)
    .values({
      workspaceId: options.workspaceId,
      channelId: channel.id,
      name: body.name,
      cadence: body.cadence,
      cronExpr,
      timezone: body.timezone,
      createdAt: at,
      updatedAt: at,
    })
    .returning();
  const created = row as ReportSubscriptionRow;
  // `run_once`: one catch-up after downtime, never a backlog of identical reports.
  await options.db
    .insert(schedules)
    .values({
      id: scheduleIdFor(created.id),
      cronExpr,
      runOptions: {
        kind: 'report',
        subscriptionId: created.id,
        timezone: body.timezone,
        misfirePolicy: 'run_once',
        nextRunAt: next.toISOString(),
      },
      enabled: true,
      workspaceId: options.workspaceId,
      createdAt: at,
    })
    .onConflictDoNothing();
  return subscriptionSummary(created, next.toISOString());
}

export async function listSubscriptions(
  options: NotificationOptions,
): Promise<SubscriptionSummary[]> {
  const rows = await options.db
    .select({ subscription: reportSubscriptions, runOptions: schedules.runOptions })
    .from(reportSubscriptions)
    .leftJoin(
      schedules,
      and(
        eq(schedules.workspaceId, reportSubscriptions.workspaceId),
        eq(schedules.id, sql`'report:' || ${reportSubscriptions.id}::text`),
      ),
    )
    .where(eq(reportSubscriptions.workspaceId, options.workspaceId))
    .orderBy(reportSubscriptions.createdAt);
  return rows.map(({ subscription, runOptions }) => {
    const next = (runOptions as Record<string, unknown> | null)?.['nextRunAt'];
    return subscriptionSummary(subscription, typeof next === 'string' ? next : null);
  });
}

async function deleteSchedule(options: NotificationOptions, subscriptionId: string): Promise<void> {
  await options.db
    .delete(schedules)
    .where(
      and(
        eq(schedules.workspaceId, options.workspaceId),
        eq(schedules.id, scheduleIdFor(subscriptionId)),
      ),
    );
}

export async function deleteSubscription(options: NotificationOptions, id: string): Promise<void> {
  const [row] = UUID.test(id)
    ? await options.db
        .delete(reportSubscriptions)
        .where(
          and(
            eq(reportSubscriptions.workspaceId, options.workspaceId),
            eq(reportSubscriptions.id, id),
          ),
        )
        .returning({ id: reportSubscriptions.id })
    : [];
  if (row === undefined) throw new DomainError(ErrorCode.NOT_FOUND, `No subscription ${id}`);
  await deleteSchedule(options, row.id);
}

export function deliverySummary(row: ReportDeliveryRow): DeliverySummary {
  return {
    id: row.id,
    channelId: row.channelId,
    subscriptionId: row.subscriptionId,
    status: row.status as DeliverySummary['status'],
    attempts: row.attempts,
    errorCode: row.errorCode,
    scheduledFor: row.scheduledFor.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    rendered: row.rendered,
  };
}

export async function listDeliveries(
  options: NotificationOptions,
  limit = 50,
): Promise<DeliverySummary[]> {
  const rows = await options.db
    .select()
    .from(reportDeliveries)
    .where(eq(reportDeliveries.workspaceId, options.workspaceId))
    .orderBy(desc(reportDeliveries.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map(deliverySummary);
}

/** A test send: one delivery, due now, to one channel. The dispatcher sends it. */
export async function queueTestDelivery(
  options: NotificationOptions,
  channelId: string,
): Promise<string> {
  const channel = await channelRow(options, channelId);
  const at = now(options);
  const [row] = await options.db
    .insert(reportDeliveries)
    .values({
      workspaceId: options.workspaceId,
      channelId: channel.id,
      idempotencyKey: `test:${randomUUID()}`,
      scheduledFor: at,
      nextAttemptAt: at,
      createdAt: at,
    })
    .returning({ id: reportDeliveries.id });
  return (row as { id: string }).id;
}

const DAY_MS = 24 * 60 * 60 * 1000;

interface Window {
  runs: number;
  passRate: number | null;
  failed: Array<{ label: string }>;
}

async function windowOf(options: NotificationOptions, from: Date, to: Date): Promise<Window> {
  const rows = await options.db
    .select({ id: runs.id, status: runs.status, suite: runs.suite })
    .from(runs)
    .where(
      and(
        eq(runs.workspaceId, options.workspaceId),
        gte(runs.startedAt, from),
        lt(runs.startedAt, to),
      ),
    )
    .orderBy(desc(runs.startedAt));
  const finished = rows.filter((row) => row.status === 'passed' || row.status === 'failed');
  const passed = finished.filter((row) => row.status === 'passed').length;
  return {
    runs: rows.length,
    passRate: finished.length === 0 ? null : (passed / finished.length) * 100,
    failed: rows
      .filter((row) => row.status === 'failed')
      .map((row) => ({ label: row.suite ?? `run ${row.id.slice(0, 8)}` })),
  };
}

/**
 * What a report says, for one workspace over its window: the runs, the pass rate and its
 * change, and the failed runs as the things that need someone.
 */
export async function loadReport(
  options: NotificationOptions,
  input: { title: string; windowDays: number; link: string | null },
): Promise<ReportInput> {
  const end = now(options);
  const start = new Date(end.getTime() - input.windowDays * DAY_MS);
  const before = new Date(start.getTime() - input.windowDays * DAY_MS);
  const [current, previous] = await Promise.all([
    windowOf(options, start, end),
    windowOf(options, before, start),
  ]);
  const digest = buildDigest({
    current: { ...current, flakyKeys: [], failingKeys: [], slowKeys: [] },
    previous: { ...previous, flakyKeys: [], failingKeys: [] },
    coverageDelta: null,
  });
  const failedBySuite = new Map<string, number>();
  for (const run of current.failed) {
    failedBySuite.set(run.label, (failedBySuite.get(run.label) ?? 0) + 1);
  }
  return {
    title: input.title,
    runs: current.runs,
    passRate: current.passRate,
    attention: [...failedBySuite].map(([label, count]) => ({
      severity: 'bad' as const,
      text: count === 1 ? `${label} failed` : `${label} failed ${String(count)} times`,
    })),
    digest,
    link: input.link,
  };
}
