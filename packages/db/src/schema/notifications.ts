import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { workspaces } from './dashboard.js';

// ─── Scheduled reports ─────────────────────────────────────────────────────
//
// Three tables, added in `0034_notifications.sql`, each hard-scoped from its first
// migration: `workspace_id` NOT NULL, a `restrict` key onto `workspaces`, an index leading
// with it.
//
// **No secret is stored here.** A channel's credential — a bot token, a webhook URL — is a
// `vault_entries` row under connector name `channel:<id>`, sealed with the row's identity as
// additional authenticated data. `settings` is what a person may see: a chat id, a phone
// number id, a template name.

/** Where a report goes: one Slack channel, one Telegram chat, one Teams webhook, … */
export const notificationChannels = pgTable(
  'notification_channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    settings: jsonb('settings').notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notification_channels_workspace_idx').on(table.workspaceId, table.createdAt),
    check(
      'notification_channels_kind_check',
      sql`${table.kind} IN ('inbox', 'slack', 'teams', 'telegram', 'whatsapp', 'signal')`,
    ),
  ],
);

/** A cadence for one channel. The worker's `schedules` row `report:<id>` is what fires it. */
export const reportSubscriptions = pgTable(
  'report_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => notificationChannels.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    cadence: text('cadence').notNull(),
    cronExpr: text('cron_expr').notNull(),
    timezone: text('timezone').notNull(),
    /** Project ids the report covers; `null` is every project. */
    projectScope: jsonb('project_scope'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('report_subscriptions_workspace_idx').on(table.workspaceId, table.channelId),
    check(
      'report_subscriptions_cadence_check',
      sql`${table.cadence} IN ('daily', 'weekly', 'custom')`,
    ),
  ],
);

/**
 * One attempt to send one report, and its outcome.
 *
 * `idempotency_key` is the worker's `schedule:<id>:<dueAt>` (or `test:<uuid>` for a test
 * send), unique, so a schedule polled twice produces one row and therefore one message.
 * `rendered` is the text as sent; for the in-app inbox it *is* the delivery.
 */
export const reportDeliveries = pgTable(
  'report_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    subscriptionId: uuid('subscription_id').references(() => reportSubscriptions.id, {
      onDelete: 'set null',
    }),
    channelId: uuid('channel_id').references(() => notificationChannels.id, {
      onDelete: 'set null',
    }),
    idempotencyKey: text('idempotency_key').notNull(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    errorCode: text('error_code'),
    rendered: text('rendered'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('report_deliveries_idempotency_idx').on(table.idempotencyKey),
    index('report_deliveries_workspace_idx').on(table.workspaceId, table.createdAt),
    // The dispatcher's claim: pending rows whose next attempt is due.
    index('report_deliveries_due_idx')
      .on(table.status, table.nextAttemptAt)
      .where(sql`status IN ('pending', 'sending')`),
    check(
      'report_deliveries_status_check',
      sql`${table.status} IN ('pending', 'sending', 'sent', 'failed')`,
    ),
  ],
);

export type NotificationChannelRow = InferSelectModel<typeof notificationChannels>;
export type ReportSubscriptionRow = InferSelectModel<typeof reportSubscriptions>;
export type ReportDeliveryRow = InferSelectModel<typeof reportDeliveries>;
