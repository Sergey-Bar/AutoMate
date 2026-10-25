import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from '../../router.js';

/** The reports route, mounted by the real router with its own client. */
beforeAll(() => {
  Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the reports route', () => {
  it('opens the reports page and reads its four parts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
        if (url.endsWith('/api/v1/auth/whoami'))
          return reply({ actor: 'anonymous', role: 'admin', mode: 'open' });
        if (url.includes('/api/v1/notification-channels')) return reply({ channels: [] });
        if (url.includes('/api/v1/report-subscriptions')) return reply({ subscriptions: [] });
        if (url.includes('/api/v1/report-deliveries')) return reply({ deliveries: [] });
        if (url.includes('/api/v1/report-preview'))
          return reply({ status: 'good', text: '🟢 Weekly quality report' });
        return reply({});
      }),
    );
    render(<MemoryRouter initialEntries={['/dashboard/reports']} />);
    expect(
      await screen.findByTestId('notifications-page', {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('report-preview')).toHaveTextContent('Weekly quality report');
  });
});
