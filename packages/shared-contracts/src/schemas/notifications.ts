import { z } from 'zod/v4';

/**
 * Scheduled reports: where they go, when, and what happened.
 *
 * One schema per channel kind, because each platform needs different public settings and a
 * different secret. The secret is accepted on create and **never** appears in a response:
 * the summaries below have no field that could hold it.
 */

export const CHANNEL_KINDS = ['inbox', 'slack', 'teams', 'telegram', 'whatsapp', 'signal'] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

const name = z.string().trim().min(1).max(80);
const secret = z.string().trim().min(1).max(2_000);

export const CreateChannelBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inbox'), name, settings: z.object({}).default({}) }),
  z.object({
    kind: z.literal('slack'),
    name,
    // A channel id (C0123…) or a #name the bot has been invited to.
    settings: z.object({ channel: z.string().regex(/^[#A-Za-z0-9._-]{1,80}$/u) }),
    secret,
  }),
  z.object({ kind: z.literal('teams'), name, settings: z.object({}).default({}), secret }),
  z.object({
    kind: z.literal('telegram'),
    name,
    // A numeric chat id (groups are negative) or a public @channelusername.
    settings: z.object({ chatId: z.string().regex(/^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/u) }),
    secret,
  }),
  z.object({
    kind: z.literal('whatsapp'),
    name,
    settings: z.object({
      phoneNumberId: z.string().regex(/^\d{5,20}$/u),
      to: z.string().regex(/^\d{7,15}$/u),
      template: z.string().regex(/^[a-z0-9_]{1,512}$/u),
      // `en` or `en_US`, as two alternatives rather than an optional group.
      language: z.string().regex(/^([a-z]{2,3}|[a-z]{2,3}_[A-Z]{2})$/u),
    }),
    secret,
  }),
  z.object({
    kind: z.literal('signal'),
    name,
    settings: z.object({
      number: z.string().regex(/^\+\d{7,15}$/u),
      // Comma-separated phone numbers or group ids.
      recipients: z.string().trim().min(1).max(1_000),
    }),
    // The bridge's base URL.
    secret,
  }),
]);
export type CreateChannelBody = z.infer<typeof CreateChannelBodySchema>;

export const ChannelSummarySchema = z.object({
  id: z.string(),
  kind: z.enum(CHANNEL_KINDS),
  name: z.string(),
  settings: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
  createdAt: z.string(),
});
export type ChannelSummary = z.infer<typeof ChannelSummarySchema>;

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/u;

export const CreateSubscriptionBodySchema = z
  .object({
    channelId: z.string().uuid(),
    name: name.default('Quality report'),
    cadence: z.enum(['daily', 'weekly', 'custom']),
    /** Daily and weekly: the local time to send at. Defaults to 09:00. */
    time: z.string().regex(HH_MM).default('09:00'),
    /** Weekly: 0 is Sunday. Defaults to Monday. */
    weekday: z.number().int().min(0).max(6).default(1),
    /** Custom: a five-field cron expression, in `timezone`. */
    cronExpr: z.string().trim().max(100).optional(),
    /** An IANA zone, such as Europe/Berlin. */
    timezone: z.string().trim().min(1).max(64).default('UTC'),
  })
  .refine((body) => body.cadence !== 'custom' || (body.cronExpr ?? '') !== '', {
    message: 'a custom cadence needs a cron expression',
    path: ['cronExpr'],
  });
export type CreateSubscriptionBody = z.infer<typeof CreateSubscriptionBodySchema>;

export const SubscriptionSummarySchema = z.object({
  id: z.string(),
  channelId: z.string(),
  name: z.string(),
  cadence: z.enum(['daily', 'weekly', 'custom']),
  cronExpr: z.string(),
  timezone: z.string(),
  enabled: z.boolean(),
  /** "Every day at 09:00", in words, so nobody has to read cron. */
  describe: z.string(),
  nextRunAt: z.string().nullable(),
});
export type SubscriptionSummary = z.infer<typeof SubscriptionSummarySchema>;

export const DeliverySummarySchema = z.object({
  id: z.string(),
  channelId: z.string().nullable(),
  subscriptionId: z.string().nullable(),
  status: z.enum(['pending', 'sending', 'sent', 'failed']),
  attempts: z.number().int(),
  errorCode: z.string().nullable(),
  scheduledFor: z.string(),
  sentAt: z.string().nullable(),
  /** The report as sent. Always present for the in-app inbox. */
  rendered: z.string().nullable(),
});
export type DeliverySummary = z.infer<typeof DeliverySummarySchema>;

export const ReportPreviewSchema = z.object({
  status: z.enum(['good', 'caution', 'bad']),
  text: z.string(),
});
export type ReportPreview = z.infer<typeof ReportPreviewSchema>;
