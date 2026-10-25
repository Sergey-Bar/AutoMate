import { expect, test } from '@playwright/test';
import { API_AUTH_HEADERS, API_BASE, WEB_BASE } from '../support/config.js';
import { observedSummary, saveEvidence } from '../support/evidence.js';

/**
 * Scheduled reports, end to end, with no chat account anywhere.
 *
 * The built-in inbox is a real channel: a test send goes through the same queue, the same
 * dispatcher and the same renderer a Telegram report does, and only the last hop differs.
 * So this proves the whole delivery path against the real database, and the page that
 * shows it, before anyone has connected Slack, Teams, Telegram, WhatsApp or Signal.
 */
const EVIDENCE = 'scheduled-reports';
const headers = { ...API_AUTH_HEADERS, 'content-type': 'application/json' };

test.describe('scheduled reports', () => {
  test('an inbox channel receives a report, scheduled and on demand, and the page shows it', async ({
    page,
    request,
  }) => {
    const created = await request.post(`${API_BASE}/api/v1/notification-channels`, {
      headers,
      data: { kind: 'inbox', name: `E2E inbox ${String(Date.now())}` },
    });
    expect(created.status()).toBe(201);
    const channel = (await created.json()) as { id: string; name: string };

    const subscribed = await request.post(`${API_BASE}/api/v1/report-subscriptions`, {
      headers,
      data: {
        channelId: channel.id,
        cadence: 'weekly',
        time: '09:00',
        weekday: 1,
        timezone: 'UTC',
      },
    });
    expect(subscribed.status()).toBe(201);
    expect(await subscribed.json()).toMatchObject({ describe: 'Every Monday at 09:00' });

    const tested = await request.post(
      `${API_BASE}/api/v1/notification-channels/${channel.id}/test`,
      { headers },
    );
    expect(tested.status()).toBe(202);
    const { delivery } = (await tested.json()) as {
      delivery: { id: string; status: string; rendered: string | null };
    };
    expect(delivery.status, 'the inbox is delivered by the dispatcher in the same request').toBe(
      'sent',
    );
    expect(delivery.rendered).toContain('Test report from Automate');

    await page.goto(`${WEB_BASE}/dashboard/reports`);
    await expect(page.getByTestId('notifications-page')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`delivery-${delivery.id}`)).toContainText('sent');
    await expect(page.getByText('Every Monday at 09:00').first()).toBeVisible();
    await expect(page.getByTestId('report-preview')).toContainText('Weekly quality report');

    saveEvidence(EVIDENCE, 'inbox-delivery.json', {
      channelId: channel.id,
      deliveryId: delivery.id,
      rendered: delivery.rendered,
      summary: observedSummary('deliveries', { sent: 1 }),
    });

    // Clean up so a rerun against the same database starts from the same state.
    expect(
      (
        await request.delete(`${API_BASE}/api/v1/notification-channels/${channel.id}`, { headers })
      ).status(),
    ).toBe(200);
  });

  test('the dashboard opens on Now', async ({ page }) => {
    await page.goto(`${WEB_BASE}/`);
    await expect(page).toHaveURL(`${WEB_BASE}/dashboard/now`);
    await expect(page.getByTestId('now-page')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('now-status')).toBeVisible();
  });
});
