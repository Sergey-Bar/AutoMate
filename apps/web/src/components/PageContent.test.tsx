import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { HealthClient } from '../lib/health-client.js';
import { PageContent } from './PageContent.js';

function client(role: string | null): HealthClient {
  return { whoami: vi.fn().mockResolvedValue({ role }) } as unknown as HealthClient;
}

describe('PageContent', () => {
  it('shows no page guide above the sign-in field', async () => {
    render(
      <PageContent health={client(null)} pathname="/dashboard/runs">
        <p>runs page</p>
      </PageContent>,
    );
    expect(await screen.findByRole('button', { name: /sign in/i })).toBeTruthy();
    expect(screen.queryByText('How to use Runs')).toBeNull();
    expect(screen.queryByText('runs page')).toBeNull();
  });

  it('shows the guide and the page to a caller with a role', async () => {
    render(
      <PageContent health={client('viewer')} pathname="/dashboard/runs">
        <p>runs page</p>
      </PageContent>,
    );
    expect(await screen.findByText('runs page')).toBeTruthy();
    expect(screen.getByText('How to use Runs')).toBeTruthy();
  });

  it('keeps the guide out of [data-page], whose rows j and k walk', async () => {
    render(
      <PageContent health={client('viewer')} pathname="/dashboard/runs">
        <ul>
          <li>row</li>
        </ul>
      </PageContent>,
    );
    await screen.findByText('row');
    const page = document.querySelector('[data-page]');
    expect(page?.textContent).toBe('row');
    expect(page?.contains(screen.getByText('How to use Runs'))).toBe(false);
  });

  it('keeps the guide on the pairing page, which is its own credential exchange', () => {
    render(
      <PageContent health={client(null)} pathname="/dashboard/pair">
        <p>pair page</p>
      </PageContent>,
    );
    expect(screen.getByText('pair page')).toBeTruthy();
  });
});
