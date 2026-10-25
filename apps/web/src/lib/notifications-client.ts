import { z } from 'zod/v4';
import {
  ChannelSummarySchema,
  DeliverySummarySchema,
  ReportPreviewSchema,
  SubscriptionSummarySchema,
  type ChannelSummary,
  type CreateChannelBody,
  type DeliverySummary,
  type ReportPreview,
  type SubscriptionSummary,
} from '@automate/shared-contracts';
import { parse } from './qa-client.js';

/**
 * Scheduled reports, from the browser. Same rules as the other clients: every response is
 * parsed against the server's own schema, and every path is built here.
 */
export interface SubscriptionDraft {
  channelId: string;
  name?: string;
  cadence: 'daily' | 'weekly' | 'custom';
  time?: string;
  weekday?: number;
  cronExpr?: string;
  timezone: string;
}

export interface NotificationsClient {
  listChannels(): Promise<ChannelSummary[]>;
  createChannel(body: CreateChannelBody): Promise<ChannelSummary>;
  deleteChannel(id: string): Promise<void>;
  testChannel(id: string): Promise<DeliverySummary | null>;
  listSubscriptions(): Promise<SubscriptionSummary[]>;
  createSubscription(draft: SubscriptionDraft): Promise<SubscriptionSummary>;
  deleteSubscription(id: string): Promise<void>;
  listDeliveries(): Promise<DeliverySummary[]>;
  preview(window: 'daily' | 'weekly'): Promise<ReportPreview>;
}

const Ok = z.object({}).passthrough();

export function createNotificationsClient(
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): NotificationsClient {
  async function call<T>(method: string, path: string, schema: z.ZodType<T>, body?: unknown) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      credentials: 'include',
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return parse(response, schema, path);
  }
  const id = (value: string) => encodeURIComponent(value);
  return {
    listChannels: async () =>
      (
        await call(
          'GET',
          '/api/v1/notification-channels',
          z.object({ channels: z.array(ChannelSummarySchema) }),
        )
      ).channels,
    createChannel: (body) =>
      call('POST', '/api/v1/notification-channels', ChannelSummarySchema, body),
    deleteChannel: async (channelId) => {
      await call('DELETE', `/api/v1/notification-channels/${id(channelId)}`, Ok);
    },
    testChannel: async (channelId) =>
      (
        await call(
          'POST',
          `/api/v1/notification-channels/${id(channelId)}/test`,
          z.object({ delivery: DeliverySummarySchema.optional() }),
        )
      ).delivery ?? null,
    listSubscriptions: async () =>
      (
        await call(
          'GET',
          '/api/v1/report-subscriptions',
          z.object({ subscriptions: z.array(SubscriptionSummarySchema) }),
        )
      ).subscriptions,
    createSubscription: (draft) =>
      call('POST', '/api/v1/report-subscriptions', SubscriptionSummarySchema, draft),
    deleteSubscription: async (subscriptionId) => {
      await call('DELETE', `/api/v1/report-subscriptions/${id(subscriptionId)}`, Ok);
    },
    listDeliveries: async () =>
      (
        await call(
          'GET',
          '/api/v1/report-deliveries',
          z.object({ deliveries: z.array(DeliverySummarySchema) }),
        )
      ).deliveries,
    preview: (window) =>
      call('GET', `/api/v1/report-preview?window=${window}`, ReportPreviewSchema),
  };
}
