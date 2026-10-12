/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { NavBar } from './NavBar';
import { ThemeProvider } from '../theme/ThemeProvider';
import {
  createMemoryHistory,
  RouterProvider,
  createRouter,
  createRootRoute,
} from '@tanstack/react-router';

function makeRouter(initialPath = '/') {
  const rootRoute = createRootRoute({
    component: () => (
      <ThemeProvider>
        <NavBar />
      </ThemeProvider>
    ),
  });
  const router = createRouter({ routeTree: rootRoute });
  const memoryHistory = createMemoryHistory({ initialEntries: [initialPath] });
  router.update({ history: memoryHistory });
  return router;
}

describe('NavBar', () => {
  beforeEach(() => {
    localStorage.clear();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nav-bar element', async () => {
    render(<RouterProvider router={makeRouter()} />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-bar')).toBeInTheDocument();
    });
  });

  it('names the product as the link and MAIN as the wordmark', async () => {
    render(<RouterProvider router={makeRouter()} />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-bar')).toBeInTheDocument();
    });
    // The link is the navigation target, named after the screen it opens.
    expect(screen.getByRole('link', { name: 'Automate' })).toBeInTheDocument();
    // The wordmark is the section name.
    expect(screen.getByTestId('nav-wordmark')).toHaveTextContent('MAIN');
  });

  /**
   * The wordmark is the product's name, and it is the only place it
   * appears in the chrome. The left link is a navigation target and is
   * named after the screen it opens, so the bar carries one brand and
   * one destination rather than two copies of a product name twenty
   * pixels apart.
   */
  it('renders the product wordmark once, in the corner', async () => {
    render(<RouterProvider router={makeRouter()} />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-bar')).toBeInTheDocument();
    });
    // Exactly once. A second copy is the rename having half happened — which is
    // what the retired-name gate in `scripts/lib/product-name.test.mjs` exists for,
    // and the same failure with a different string.
    expect(screen.getAllByText('Automate')).toHaveLength(1);
    expect(screen.queryByText('Release Command Center')).not.toBeInTheDocument();
    expect(screen.queryByText('Cockpit')).not.toBeInTheDocument();
  });

  it('marks the current page on the link, not by colour alone', async () => {
    render(<RouterProvider router={makeRouter('/dashboard')} />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-bar')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'Automate' })).toHaveAttribute('aria-current', 'page');
  });
});
