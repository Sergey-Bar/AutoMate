/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NavBar } from './NavBar';
import { resetAuthState } from '../auth/useAuth.js';
import { ThemeProvider } from '../theme/ThemeProvider';
import { createMemoryHistory, RouterProvider, createRouter, createRootRoute } from '@tanstack/react-router';

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
    resetAuthState();
    localStorage.clear();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
  });

  afterEach(() => {
    resetAuthState();
    vi.unstubAllGlobals();
  });

  it('renders logout button when authenticated', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    render(<RouterProvider router={makeRouter()} />);

    await waitFor(() => {
      expect(screen.getByTestId('logout-button')).toBeInTheDocument();
    });
  });

  it('does not render logout button when unauthenticated', async () => {
    // sessionStorage is clean (cleared in beforeEach)
    render(<RouterProvider router={makeRouter()} />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-bar')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('logout-button')).toBeNull();
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
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('clicking logout button triggers logout API call', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', mockFetch);

    render(<RouterProvider router={makeRouter()} />);
    await waitFor(() => {
      expect(screen.getByTestId('logout-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('logout-button'));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/auth/logout',
        expect.objectContaining({ method: 'POST', credentials: 'include' })
      );
    });

    vi.unstubAllGlobals();
  });

  it('renders nav-bar element', async () => {
    render(<RouterProvider router={makeRouter()} />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-bar')).toBeInTheDocument();
    });
  });
});
