/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderHook, act } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import type { AnyRootRoute } from '@tanstack/react-router';
import { useAuth } from './useAuth.js';
import { AuthGuard } from './AuthGuard.js';

Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });

beforeEach(() => {
  sessionStorage.clear();
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ authenticated: false }),
  });
});

describe('useAuth', () => {
  it('starts unauthenticated when sessionStorage is empty', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('starts authenticated when sessionStorage has flag', () => {
    sessionStorage.setItem('automate_authenticated', 'true');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ authenticated: true }),
    });
    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('login posts { apiKey } to /api/auth/login and sets authenticated', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.login('my-secret-key');
    });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'my-secret-key' }),
    });
    expect(result.current.isAuthenticated).toBe(true);
    expect(sessionStorage.getItem('automate_authenticated')).toBe('true');
  });

  it('login throws on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
    const { result } = renderHook(() => useAuth());
    await expect(
      act(async () => {
        await result.current.login('bad-key');
      })
    ).rejects.toThrow('Invalid API key');
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('logout calls /api/auth/logout and clears state', async () => {
    sessionStorage.setItem('automate_authenticated', 'true');
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(true);
    await act(async () => {
      await result.current.logout();
    });
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    expect(result.current.isAuthenticated).toBe(false);
    expect(sessionStorage.getItem('automate_authenticated')).toBeNull();
  });

  it('logout clears state even if fetch throws', async () => {
    sessionStorage.setItem('automate_authenticated', 'true');
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.logout();
    });
    expect(result.current.isAuthenticated).toBe(false);
  });
});

const buildRouter = (initialPath: string, authenticated: boolean) => {
  if (authenticated) {
    sessionStorage.setItem('automate_authenticated', 'true');
  } else {
    sessionStorage.removeItem('automate_authenticated');
  }
  const root = createRootRoute({});
  const protectedR = createRoute({
    getParentRoute: () => root as AnyRootRoute,
    path: '/protected',
    component: () => (
      <AuthGuard>
        <div data-testid="protected-content">Protected</div>
      </AuthGuard>
    ),
  });
  const loginR = createRoute({
    getParentRoute: () => root as AnyRootRoute,
    path: '/login',
    component: () => <div data-testid="login-page">Login</div>,
  });
  root.addChildren([protectedR, loginR]);
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  return createRouter({ routeTree: root, history });
};

describe('AuthGuard', () => {
  const originalAuthRequired = import.meta.env['VITE_AUTH_REQUIRED'];

  afterEach(() => {
    if (originalAuthRequired === undefined) {
      delete import.meta.env['VITE_AUTH_REQUIRED'];
      return;
    }
    import.meta.env['VITE_AUTH_REQUIRED'] = originalAuthRequired;
  });

  it('renders children when authenticated', async () => {
    const router = buildRouter('/protected', true);
    render(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    });
  });

  it('redirects to /login when not authenticated', async () => {
    const router = buildRouter('/protected', false);
    render(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });

  it('renders children when auth is disabled via VITE_AUTH_REQUIRED=false', async () => {
    import.meta.env['VITE_AUTH_REQUIRED'] = 'false';

    const router = buildRouter('/protected', false);
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
  });
});
