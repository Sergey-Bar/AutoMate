/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  it('toggles theme', async () => {
    render(<RouterProvider router={makeRouter()} />);

    await waitFor(() => {
      expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
    });

    const themeBtn = screen.getByTestId('theme-toggle');
    fireEvent.click(themeBtn);
    expect(localStorage.getItem('automate-theme')).toBeDefined();
  });

  /*
   * The cycle is `dark → light → system → dark`, which is the declaration order of
   * `THEMES` in `ThemeProvider.tsx` and the order a reader meets from the
   * provider's default of `system`.
   *
   * **Both expectations changed, and the old ones were wrong.** They encoded the
   * cycle of the *inline* copy `NavBar` used to render — a second theme control
   * with its own idea of what "toggle" meant. `NavBar` now renders `ThemeToggle`,
   * so there is one control and one cycle. These two cases are kept because they
   * exercise the real provider and real `localStorage`; `ThemeToggle.test.tsx` covers
   * the same three transitions against a mocked hook, which proves the arithmetic
   * rather than the wiring.
   */
  it('theme cycles: light → system when starting from light', async () => {
    localStorage.setItem('automate-theme', 'light');
    render(<RouterProvider router={makeRouter()} />);
    await waitFor(() => {
      expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('theme-toggle'));
    expect(localStorage.getItem('automate-theme')).toBe('system');
  });

  it('theme cycles: dark → light when starting from dark', async () => {
    localStorage.setItem('automate-theme', 'dark');
    render(<RouterProvider router={makeRouter()} />);
    await waitFor(() => {
      expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('theme-toggle'));
    expect(localStorage.getItem('automate-theme')).toBe('light');
  });

  it('renders all navigation link labels', async () => {
    render(<RouterProvider router={makeRouter()} />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-bar')).toBeInTheDocument();
    });
    expect(screen.getByText('Cockpit')).toBeInTheDocument();
  });

  /**
   * The wordmark is the product's name, and it is the only place it appears in the
   * chrome. The left link is a navigation target and is named after the screen it
   * opens, so the bar carries one brand and one destination rather than two copies
   * of a product name twenty pixels apart.
   */
  it('renders the product wordmark once, in the corner', async () => {
    render(<RouterProvider router={makeRouter()} />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-bar')).toBeInTheDocument();
    });
    expect(screen.getByTestId('nav-wordmark')).toHaveTextContent('Automate');
    // Exactly once. A second copy is the rename having half happened — which is
    // what the retired-name gate in `scripts/lib/product-name.test.mjs` exists for,
    // and the same failure with a different string.
    expect(screen.getAllByText('Automate')).toHaveLength(1);
    expect(screen.queryByText('Release Command Center')).not.toBeInTheDocument();
  });

  it('renders nav-bar element', async () => {
    render(<RouterProvider router={makeRouter()} />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-bar')).toBeInTheDocument();
    });
  });
});
