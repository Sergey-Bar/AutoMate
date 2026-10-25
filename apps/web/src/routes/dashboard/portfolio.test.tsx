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

  it('asks a caller with no role to sign in before any of them', async () => {
    stubApi(null);
    render(<MemoryRouter initialEntries={['/dashboard/repo/p-1']} />);
    expect(await screen.findByTestId('sign-in', {}, { timeout: 10_000 })).toBeInTheDocument();
  });
});
