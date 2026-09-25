/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NavBar } from './NavBar';
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
  const mockSessionFetch = (authenticated: boolean) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ authenticated }),
      } as Response),
    );
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mockSessionFetch(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders logout button when authenticated', async () => {
    sessionStorage.setItem('automate_authenticated', 'true');
    mockSessionFetch(true);
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
    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('Tools')).toBeInTheDocument();
    expect(screen.getByText('Integrations')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('clicking logout button triggers logout API call', async () => {
    sessionStorage.setItem('automate_authenticated', 'true');
    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString();
      if (path === '/api/auth/session') {
        return {
          ok: true,
          json: async () => ({ authenticated: true }),
        } as Response;
      }
      return { ok: true } as Response;
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<RouterProvider router={makeRouter()} />);
    await waitFor(() => {
      expect(screen.getByTestId('logout-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('logout-button'));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/auth/logout',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('renders nav-bar element', async () => {
    render(<RouterProvider router={makeRouter()} />);
    await waitFor(() => {
      expect(screen.getByTestId('nav-bar')).toBeInTheDocument();
    });
  });
});
