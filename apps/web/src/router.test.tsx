import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configure } from '@testing-library/dom';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from './router.js';
import { resetAuthState } from './auth/useAuth.js';
import { visibleRoutes } from './route-manifest.js';

/**
 * A render assertion with a 15s budget, on a machine also running 160 test files.
 *
 * This test timed out intermittently under load. The assertion is a render that
 * normally takes single-digit milliseconds, so a failure meant the event loop
 * was busy, not that the route was wrong — and a red test here is a lie about
 * the product. The assertion is unchanged; only the time it is allowed to take.
 *
 * The budget has to be set on the *test*, not only on `waitFor`: Vitest's own
 * per-test timeout is 5s and fires first, so a generous `asyncUtilTimeout` on
 * its own just guarantees the test times out at 5s with a clearer message about
 * the wrong thing.
 */
const RENDER_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 30_000;
configure({ asyncUtilTimeout: RENDER_TIMEOUT_MS });
window.scrollTo = () => undefined;

function mockAuthenticatedApi(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/session')) return new Response('{}', { status: 200 });
      if (url.endsWith('/api/v1/runs')) return new Response('[]', { status: 200 });
      return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 });
    }),
  );
}

beforeAll(() => {
  Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetAuthState();
});

describe('router', { timeout: TEST_TIMEOUT_MS }, () => {
  it('activates the dashboard route and renders the release command center', async () => {
    mockAuthenticatedApi();
    render(<MemoryRouter initialEntries={['/dashboard']} />);
    await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Release Command Center' })).toBeInTheDocument();
  });

  it('redirects the root route to the command center instead of a placeholder home', async () => {
    mockAuthenticatedApi();
    render(<MemoryRouter initialEntries={['/']} />);
    await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeInTheDocument(), {
      timeout: RENDER_TIMEOUT_MS,
    });
  });

  it('navigates from the canonical run list back to the command center', async () => {
    mockAuthenticatedApi();
    render(<MemoryRouter initialEntries={['/dashboard/runs']} />);
    await waitFor(() => expect(screen.getByTestId('runs-list-page')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('link', { name: 'Command Center' }));
    await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeInTheDocument(), {
      timeout: RENDER_TIMEOUT_MS,
    });
  });

  it('exposes only registered visible navigation targets', async () => {
    mockAuthenticatedApi();
    render(<MemoryRouter initialEntries={['/dashboard']} />);
    await waitFor(() => expect(screen.getByTestId('sidebar')).toBeInTheDocument());
    const hrefs = [...screen.getByTestId('sidebar').querySelectorAll('a')].map((link) =>
      link.getAttribute('href'),
    );
    expect(hrefs).toEqual(visibleRoutes.map((route) => route.path));
  });

  it('leaves legacy reporting unreachable', async () => {
    mockAuthenticatedApi();
    render(<MemoryRouter initialEntries={['/reporting/run-1']} />);
    await waitFor(() => expect(screen.getByText('Not Found')).toBeInTheDocument(), {
      timeout: RENDER_TIMEOUT_MS,
    });
  });
});
