import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from '../../router.js';

/**
 * The three repository-health routes, mounted by the real router with their own clients.
 *
 * The components have their own suite; this one proves the routes are registered, read their
 * parameter, and put the access gate in front of what they render.
 */
function stubApi(role: 'admin' | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url.endsWith('/api/v1/auth/whoami'))
        return reply({ actor: 'anonymous', role, mode: role === null ? 'enforced' : 'open' });
      if (url.endsWith('/api/v1/portfolio')) return reply({ projects: [] });
      if (url.endsWith('/api/v1/access-tokens')) return reply({ tokens: [] });
      if (url.endsWith('/api/v1/members')) return reply({ members: [] });
      if (url.includes('/api/v1/audit?')) return reply({ events: [], next: null });
      if (url.endsWith('/api/v1/workspaces'))
        return reply({
          current: 'default',
          workspaces: [{ id: 'default', name: 'Default', role: 'admin' }],
          canCreate: false,
        });
      return reply({ error: { message: 'No project p-1' } }, 404);
    }),
  );
}

beforeAll(() => {
  Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the repository-health routes', () => {
  it('opens the portfolio', async () => {
    stubApi('admin');
    render(<MemoryRouter initialEntries={['/dashboard/portfolio']} />);
    expect(
      await screen.findByTestId('portfolio-empty', {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
  });

  it('opens a repository by the id in its path, and shows the server’s refusal', async () => {
    stubApi('admin');
    render(<MemoryRouter initialEntries={['/dashboard/repo/p-1']} />);
    expect(await screen.findByText('No project p-1', {}, { timeout: 10_000 })).toBeInTheDocument();
  });

  it('opens the access page', async () => {
    stubApi('admin');
    render(<MemoryRouter initialEntries={['/dashboard/access']} />);
    expect(await screen.findByTestId('access-page', {}, { timeout: 10_000 })).toBeInTheDocument();
  });

  it('opens the members and audit pages, each with its own admin client', async () => {
    stubApi('admin');
    const members = render(<MemoryRouter initialEntries={['/dashboard/members']} />);
    expect(await screen.findByTestId('members-page', {}, { timeout: 10_000 })).toBeInTheDocument();
    members.unmount();
    render(<MemoryRouter initialEntries={['/dashboard/audit']} />);
    expect(await screen.findByTestId('audit-page', {}, { timeout: 10_000 })).toBeInTheDocument();
  });

  it('opens the deployment page with the workspace switcher', async () => {
    stubApi('admin');
    render(<MemoryRouter initialEntries={['/dashboard/deployment']} />);
    expect(
      await screen.findByTestId('deployment-page', {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText('Current workspace', {}, { timeout: 10_000 })).toHaveValue(
      'default',
    );
  });

  it('asks a caller with no role to sign in before any of them', async () => {
    stubApi(null);
    render(<MemoryRouter initialEntries={['/dashboard/repo/p-1']} />);
    expect(await screen.findByTestId('sign-in', {}, { timeout: 10_000 })).toBeInTheDocument();
  });

  it('opens the pairing page with the code from the link, past the sign-in gate', async () => {
    // A device being paired has no credential: the gate must not stand in front of it.
    stubApi(null);
    render(<MemoryRouter initialEntries={['/dashboard/pair?code=04-21-37x']} />);
    expect(await screen.findByTestId('pair-page', {}, { timeout: 10_000 })).toBeInTheDocument();
    expect((screen.getByLabelText('Pairing code') as HTMLInputElement).value).toBe('042137');
  });

  it('opens the pairing page with no code', async () => {
    stubApi(null);
    render(<MemoryRouter initialEntries={['/dashboard/pair']} />);
    expect(await screen.findByTestId('pair-page', {}, { timeout: 10_000 })).toBeInTheDocument();
    expect((screen.getByLabelText('Pairing code') as HTMLInputElement).value).toBe('');
  });
});
