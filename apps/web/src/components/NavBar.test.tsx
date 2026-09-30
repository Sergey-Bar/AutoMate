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

  it('theme cycles: light → dark when starting from light', async () => {
    localStorage.setItem('automate-theme', 'light');
    render(<RouterProvider router={makeRouter()} />);
    await waitFor(() => {
      expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('theme-toggle'));
    expect(localStorage.getItem('automate-theme')).toBe('dark');
  });

  it('theme cycles: dark → system when starting from dark', async () => {
    localStorage.setItem('automate-theme', 'dark');
    render(<RouterProvider router={makeRouter()} />);
    await waitFor(() => {
      expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('theme-toggle'));
    expect(localStorage.getItem('automate-theme')).toBe('system');
  });

  it('renders all navigation link labels', async () => {
    render(<RouterProvider router={makeRouter()} />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-bar')).toBeInTheDocument();
    });
    expect(screen.getByText('Release Command Center')).toBeInTheDocument();
  });

  it('renders nav-bar element', async () => {
    render(<RouterProvider router={makeRouter()} />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-bar')).toBeInTheDocument();
    });
  });
});
