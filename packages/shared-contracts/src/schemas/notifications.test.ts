import { describe, expect, it } from 'vitest';
import {
  ChannelSummarySchema,
  CreateChannelBodySchema,
  CreateSubscriptionBodySchema,
  DeliverySummarySchema,
} from './notifications.js';

describe('channel bodies', () => {
  it('accepts each kind with its own settings, and defaults the ones that need none', () => {
    const accepted = [
      { kind: 'inbox', name: 'Inbox' },
      { kind: 'slack', name: 'QA', settings: { channel: '#quality' }, secret: 'xoxb-1' },
      { kind: 'teams', name: 'QA', secret: 'https://example.logic.azure.com/x' },
      { kind: 'telegram', name: 'QA', settings: { chatId: '-100123' }, secret: '1:a' },
      { kind: 'telegram', name: 'QA', settings: { chatId: '@qa_channel' }, secret: '1:a' },
      {
        kind: 'whatsapp',
        name: 'QA',
        settings: {
          phoneNumberId: '1234567',
          to: '15551234567',
          template: 'report',
          language: 'en_US',
        },
        secret: 'EAAG',
      },
      {
        kind: 'signal',
        name: 'QA',
        settings: { number: '+15551234567', recipients: '+15557654321' },
        secret: 'http://signal:8080',
      },
    ];
    for (const body of accepted) expect(CreateChannelBodySchema.safeParse(body).success).toBe(true);
    expect(CreateChannelBodySchema.parse({ kind: 'teams', name: 'x', secret: 'y' })).toMatchObject({
      settings: {},
    });
  });

  it('refuses a kind it does not know, a missing secret, and settings that would inject', () => {
    const refused = [
      { kind: 'email', name: 'x' },
      { kind: 'slack', name: 'x', settings: { channel: '#ok' } },
      { kind: 'slack', name: 'x', settings: { channel: '#a b' }, secret: 's' },
      { kind: 'telegram', name: 'x', settings: { chatId: '12; drop' }, secret: 's' },
      { kind: 'whatsapp', name: 'x', settings: { phoneNumberId: 'abc' }, secret: 's' },
      { kind: 'signal', name: 'x', settings: { number: '555', recipients: 'x' }, secret: 's' },
      { kind: 'inbox', name: '' },
    ];
    for (const body of refused) expect(CreateChannelBodySchema.safeParse(body).success).toBe(false);
  });

  it('has no field on a summary that could carry the secret', () => {
    expect(Object.keys(ChannelSummarySchema.shape)).not.toContain('secret');
  });
});

describe('subscription bodies', () => {
  const channelId = '00000000-0000-4000-8000-000000000001';

  it('defaults to 09:00 UTC, Mondays for weekly', () => {
    expect(CreateSubscriptionBodySchema.parse({ channelId, cadence: 'weekly' })).toMatchObject({
      time: '09:00',
      weekday: 1,
      timezone: 'UTC',
      name: 'Quality report',
    });
  });

  it('needs a cron expression only for a custom cadence, and a real time of day', () => {
    expect(CreateSubscriptionBodySchema.safeParse({ channelId, cadence: 'custom' }).success).toBe(
      false,
    );
    expect(
      CreateSubscriptionBodySchema.safeParse({
        channelId,
        cadence: 'custom',
        cronExpr: '0 9 * * 1-5',
      }).success,
    ).toBe(true);
    expect(
      CreateSubscriptionBodySchema.safeParse({ channelId, cadence: 'daily', time: '25:00' })
        .success,
    ).toBe(false);
  });
});

describe('delivery summaries', () => {
  it('carry a status from the closed set', () => {
    const base = {
      id: 'd',
      channelId: null,
      subscriptionId: null,
      attempts: 0,
      errorCode: null,
      scheduledFor: '2026-10-25T09:00:00.000Z',
      sentAt: null,
      rendered: null,
    };
    expect(DeliverySummarySchema.safeParse({ ...base, status: 'sent' }).success).toBe(true);
    expect(DeliverySummarySchema.safeParse({ ...base, status: 'lost' }).success).toBe(false);
  });
});
