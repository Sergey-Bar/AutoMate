import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationsClient } from '../lib/notifications-client.js';
import { expectNoBlockingAxeViolations } from '../test-axe.js';
import { KIND_GUIDES, NotificationsPage } from './Notifications.js';
import { TOAST_MS, ToastProvider, useToast } from './Toasts.js';

const INBOX = {
  id: 'c1',
  kind: 'inbox' as const,
  name: 'Automate inbox',
  settings: {},
  enabled: true,
  createdAt: '2026-10-25T00:00:00.000Z',
};
const SENT = {
  id: 'd1',
  channelId: 'c1',
  subscriptionId: null,
  status: 'sent' as const,
  attempts: 1,
  errorCode: null,
  scheduledFor: '2026-10-25T09:00:00.000Z',
  sentAt: '2026-10-25T09:00:05.000Z',
  rendered: '🟢 Test report from Automate\n3 runs in this period.',
};

function client(overrides: Partial<NotificationsClient> = {}): NotificationsClient {
  return {
    listChannels: vi.fn(async () => [INBOX]),
    createChannel: vi.fn(async (body) => ({
      ...INBOX,
      id: 'c2',
      kind: body.kind,
      name: body.name,
    })),
    deleteChannel: vi.fn(async () => undefined),
    testChannel: vi.fn(async () => SENT),
    listSubscriptions: vi.fn(async () => [
      {
        id: 's1',
        channelId: 'c1',
        name: 'Daily',
        cadence: 'daily' as const,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        enabled: true,
        describe: 'Every day at 09:00',
        nextRunAt: null,
      },
    ]),
    createSubscription: vi.fn(async () => ({
      id: 's2',
      channelId: 'c1',
      name: 'Weekly',
      cadence: 'weekly' as const,
      cronExpr: '0 9 * * 1',
      timezone: 'UTC',
      enabled: true,
      describe: 'Every Monday at 09:00',
      nextRunAt: null,
    })),
    deleteSubscription: vi.fn(async () => undefined),
    listDeliveries: vi.fn(async () => [SENT]),
    preview: vi.fn(async () => ({ status: 'good' as const, text: '🟢 Weekly quality report' })),
    ...overrides,
  };
}

function page(api: NotificationsClient) {
  return render(
    <ToastProvider>
      <NotificationsPage client={api} />
    </ToastProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('NotificationsPage', () => {
  it('shows where, when, the preview and the history, without blocking axe findings', async () => {
    const { container } = page(client());
    expect(await screen.findByText('Every day at 09:00')).toBeTruthy();
    expect(await screen.findByTestId('report-preview')).toHaveTextContent('Weekly quality report');
    expect(screen.getByTestId('delivery-d1')).toHaveTextContent('sent');
    await expectNoBlockingAxeViolations(container);
  });

  it('adds a Telegram channel with its own fields and help, and says so', async () => {
    const user = userEvent.setup();
    const api = client();
    page(api);
    await screen.findByText('Every day at 09:00');
    await user.selectOptions(screen.getByLabelText('Where'), 'telegram');
    expect(screen.getByTestId('kind-help')).toHaveTextContent('@BotFather');
    await user.type(screen.getByLabelText('Chat id'), '-1001');
    await user.type(screen.getByLabelText('Bot token'), '1:abc');
    await user.click(screen.getByRole('button', { name: 'Add Telegram' }));
    expect(api.createChannel).toHaveBeenCalledWith({
      kind: 'telegram',
      name: 'Telegram',
      settings: { chatId: '-1001' },
      secret: '1:abc',
    });
    expect(await screen.findByText('Telegram added')).toBeTruthy();
  });

  it('adds the inbox with no credential at all', async () => {
    const user = userEvent.setup();
    const api = client();
    page(api);
    await screen.findByText('Every day at 09:00');
    await user.type(screen.getByLabelText('Name'), 'Team inbox');
    await user.click(screen.getByRole('button', { name: 'Add Automate inbox' }));
    expect(api.createChannel).toHaveBeenCalledWith({
      kind: 'inbox',
      name: 'Team inbox',
      settings: {},
    });
  });

  it('sends a test and reports the outcome in a toast', async () => {
    const user = userEvent.setup();
    const api = client({
      testChannel: vi
        .fn()
        .mockResolvedValueOnce(SENT)
        .mockResolvedValueOnce({ ...SENT, status: 'failed', errorCode: 'telegram_rejected_401' })
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(
          Object.assign(new Error('x'), { detail: 'This needs the admin role' }),
        ),
    });
    page(api);
    const row = await screen.findByTestId('channel-c1');
    const send = within(row).getByRole('button', { name: 'Send a test' });
    await user.click(send);
    expect(await screen.findByText('Test sent to Automate inbox')).toBeTruthy();
    await user.click(send);
    expect(await screen.findByText('telegram_rejected_401')).toBeTruthy();
    await user.click(send);
    expect((await screen.findAllByText('Test queued for Automate inbox')).length).toBeGreaterThan(
      0,
    );
    await user.click(send);
    expect(await screen.findByText('This needs the admin role')).toBeTruthy();
  });

  it('schedules a weekly report and a custom one, in the browser’s timezone', async () => {
    const user = userEvent.setup();
    const api = client();
    page(api);
    await screen.findByText('Every day at 09:00');
    await user.click(screen.getByRole('button', { name: 'Weekly, Monday 09:00' }));
    await user.selectOptions(screen.getByLabelText('Send to'), 'c1');
    await user.clear(screen.getByLabelText('At'));
    await user.type(screen.getByLabelText('At'), '08:30');
    await user.clear(screen.getByLabelText('Timezone'));
    await user.type(screen.getByLabelText('Timezone'), 'Asia/Jerusalem');
    await user.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(api.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'c1',
        cadence: 'weekly',
        weekday: 1,
        time: '08:30',
        timezone: 'Asia/Jerusalem',
      }),
    );
    expect(await screen.findByText('Report scheduled')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Custom' }));
    await user.clear(screen.getByLabelText('Cron (minute hour day month weekday)'));
    await user.type(screen.getByLabelText('Cron (minute hour day month weekday)'), '0 8 * * 1-5');
    await user.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(api.createSubscription).toHaveBeenLastCalledWith(
      expect.objectContaining({ cadence: 'custom', cronExpr: '0 8 * * 1-5' }),
    );
  });

  it('removes a channel and a schedule, and says when it cannot', async () => {
    const user = userEvent.setup();
    const api = client({
      deleteSubscription: vi.fn(async () => Promise.reject(new Error('offline'))),
      createSubscription: vi.fn(async () => Promise.reject(new Error('offline'))),
      createChannel: vi.fn(async () => Promise.reject(new Error('offline'))),
      deleteChannel: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('offline')),
    });
    page(api);
    const row = await screen.findByTestId('channel-c1');
    await user.click(within(row).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Automate inbox removed')).toBeTruthy();
    await user.click(
      within(await screen.findByTestId('channel-c1')).getByRole('button', { name: 'Remove' }),
    );
    expect((await screen.findAllByText('Could not remove it')).length).toBeGreaterThan(0);
    const schedules = screen.getByRole('list', { name: 'Scheduled reports' });
    await user.click(within(schedules).getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(await screen.findByText('Could not schedule it')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add Automate inbox' }));
    expect(await screen.findByText('Could not add the channel')).toBeTruthy();
  });

  it('reads a delivered report in place, and closes it again', async () => {
    const user = userEvent.setup();
    page(client());
    await user.click(await screen.findByRole('button', { name: 'Read' }));
    expect(screen.getByText(/3 runs in this period/u)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText(/3 runs in this period/u)).toBeNull();
  });

  it('asks for a channel first, and says when nothing has been sent or scheduled', async () => {
    page(
      client({
        listChannels: vi.fn(async () => []),
        listSubscriptions: vi.fn(async () => []),
        listDeliveries: vi.fn(async () => []),
      }),
    );
    expect(await screen.findByText('Add a channel first.')).toBeTruthy();
    expect(await screen.findByText('No report has been sent yet.')).toBeTruthy();
    expect(await screen.findByText('Nothing scheduled.')).toBeTruthy();
    expect(screen.getByText(/Start with the Automate inbox/u)).toBeTruthy();
  });

  it('says so when any part cannot be read', async () => {
    const fail = vi.fn(async () => Promise.reject(new Error('offline')));
    const first = page(client({ listChannels: fail, listDeliveries: fail, preview: fail }));
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(3));
    first.unmount();
    page(client({ listSubscriptions: fail }));
    expect((await screen.findByRole('alert')).textContent).toBe('offline');
  });

  it('has a setup guide for every channel kind', () => {
    for (const guide of Object.values(KIND_GUIDES)) expect(guide.help.length).toBeGreaterThan(20);
  });
});

describe('toasts', () => {
  function Trigger() {
    const toast = useToast();
    return (
      <button
        type="button"
        onClick={() => toast({ tone: 'info', title: `t${String(Date.now())}` })}
      >
        go
      </button>
    );
  }

  it('keeps three at most, and each goes away on its own', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    for (let index = 0; index < 4; index += 1) {
      act(() => {
        vi.setSystemTime(Date.now() + 1);
        screen.getByRole('button', { name: 'go' }).click();
      });
    }
    expect(screen.getAllByTestId('toast')).toHaveLength(3);
    act(() => {
      vi.advanceTimersByTime(TOAST_MS + 10);
    });
    await waitFor(() => expect(screen.queryAllByTestId('toast')).toHaveLength(0));
  });

  it('is a no-op without a provider', () => {
    render(<Trigger />);
    expect(() => screen.getByRole('button', { name: 'go' }).click()).not.toThrow();
  });
});
