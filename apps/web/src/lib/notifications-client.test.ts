import { describe, expect, it, vi } from 'vitest';
import { createNotificationsClient } from './notifications-client.js';

const CHANNEL = {
  id: 'c1',
  kind: 'telegram',
  name: 'QA',
  settings: { chatId: '-1' },
  enabled: true,
  createdAt: '2026-10-25T00:00:00.000Z',
};
const SUBSCRIPTION = {
  id: 's1',
  channelId: 'c1',
  name: 'Daily',
  cadence: 'daily',
  cronExpr: '0 9 * * *',
  timezone: 'UTC',
  enabled: true,
  describe: 'Every day at 09:00',
  nextRunAt: '2026-10-26T09:00:00.000Z',
};
const DELIVERY = {
  id: 'd1',
  channelId: 'c1',
  subscriptionId: null,
  status: 'pending',
  attempts: 0,
  errorCode: null,
  scheduledFor: '2026-10-25T09:00:00.000Z',
  sentAt: null,
  rendered: null,
};

function server(routes: Record<string, unknown>) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? 'GET';
    calls.push({
      method,
      path,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const key = `${method} ${path.split('?')[0] ?? ''}`;
    return new Response(JSON.stringify(routes[key] ?? { error: { message: 'no route' } }), {
      status: key in routes ? 200 : 404,
    });
  });
  return { client: createNotificationsClient('', fetchImpl as unknown as typeof fetch), calls };
}

describe('createNotificationsClient', () => {
  it('reads and writes channels, subscriptions, deliveries and the preview', async () => {
    const { client, calls } = server({
      'GET /api/v1/notification-channels': { channels: [CHANNEL] },
      'POST /api/v1/notification-channels': CHANNEL,
      'DELETE /api/v1/notification-channels/c%201': { ok: true },
      'POST /api/v1/notification-channels/c1/test': { delivery: DELIVERY },
      'GET /api/v1/report-subscriptions': { subscriptions: [SUBSCRIPTION] },
      'POST /api/v1/report-subscriptions': SUBSCRIPTION,
      'DELETE /api/v1/report-subscriptions/s1': { ok: true },
      'GET /api/v1/report-deliveries': { deliveries: [DELIVERY] },
      'GET /api/v1/report-preview': { status: 'good', text: '🟢 Weekly quality report' },
    });
    expect(await client.listChannels()).toEqual([CHANNEL]);
    expect(
      await client.createChannel({
        kind: 'telegram',
        name: 'QA',
        settings: { chatId: '-1' },
        secret: 's',
      }),
    ).toEqual(CHANNEL);
    await client.deleteChannel('c 1');
    expect(await client.testChannel('c1')).toEqual(DELIVERY);
    expect(await client.listSubscriptions()).toEqual([SUBSCRIPTION]);
    expect(
      await client.createSubscription({ channelId: 'c1', cadence: 'daily', timezone: 'UTC' }),
    ).toEqual(SUBSCRIPTION);
    await client.deleteSubscription('s1');
    expect(await client.listDeliveries()).toEqual([DELIVERY]);
    expect((await client.preview('weekly')).status).toBe('good');
    expect(calls.map((call) => `${call.method} ${call.path}`)).toContain(
      'GET /api/v1/report-preview?window=weekly',
    );
    expect(calls[1]?.body).toMatchObject({ kind: 'telegram', secret: 's' });
  });

  it('answers a test send with no delivery as null', async () => {
    const { client } = server({ 'POST /api/v1/notification-channels/c1/test': {} });
    expect(await client.testChannel('c1')).toBeNull();
  });
});
