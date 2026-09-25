import React from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import type { AnyRootRoute } from '@tanstack/react-router';
import { AuthGuard } from './AuthGuard.js';
import { resetAuthState, useAuth } from './useAuth.js';

Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });

beforeEach(() => {
  resetAuthState();
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
});

describe('useAuth', () => {
  it('checks the server session instead of browser storage', async () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.isChecking).toBe(true);
    await waitFor(() => expect(result.current.isAuthenticated).toBe(false));
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/v1/auth/session', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
  });

  it('logs in with same-origin credentials', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.login('my-secret-key');
    });
    expect(result.current.isAuthenticated).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/v1/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ apiKey: 'my-secret-key' }),
    });
  });

  it('does not claim logout when the server rejects it', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      if (String(url).endsWith('/login')) return { ok: true };
      if (String(url).endsWith('/logout')) return { ok: false, status: 500 };
      return { ok: true, status: 200 };
    });
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.login('key');
    });
    await expect(
      act(async () => {
        await result.current.logout();
      }),
    ).rejects.toThrow('Logout failed');
    expect(result.current.isAuthenticated).toBe(true);
  });
});

const buildRouter = (initialPath: string, authenticated: boolean) => {
  globalThis.fetch = vi
    .fn()
    .mockResolvedValue({ ok: authenticated, status: authenticated ? 200 : 401 });
  const root = createRootRoute({});
  const protectedRoute = createRoute({
    getParentRoute: () => root as AnyRootRoute,
    path: '/protected',
    component: () => (
      <AuthGuard>
        <div data-testid="protected-content">Protected</div>
      </AuthGuard>
    ),
  });
  const loginRoute = createRoute({
    getParentRoute: () => root as AnyRootRoute,
    path: '/login',
    component: () => <div data-testid="login-page">Login</div>,
  });
  root.addChildren([protectedRoute, loginRoute]);
  return createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
};

describe('AuthGuard', () => {
  it('waits for a server-authenticated session before rendering', async () => {
    const router = buildRouter('/protected', true);
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(screen.getByTestId('protected-content')).toBeInTheDocument());
  });

  it('redirects an unauthenticated session to login', async () => {
    const router = buildRouter('/protected', false);
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument());
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });
});
