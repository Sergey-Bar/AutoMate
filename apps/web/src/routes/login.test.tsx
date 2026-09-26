/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { resetAuthState } from '../auth/useAuth.js';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import type { AnyRootRoute } from '@tanstack/react-router';
import { Route as loginRoute } from './login.js';

Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });

beforeEach(() => {
  resetAuthState();
  vi.restoreAllMocks();
});

const renderLogin = (search = '') => {
  const rootRoute = createRootRoute({});
  const testRoute = loginRoute;
  testRoute.options.getParentRoute = () => rootRoute as AnyRootRoute;
  rootRoute.addChildren([testRoute]);

  const history = createMemoryHistory({
    initialEntries: [`/login${search}`],
  });

  const router = createRouter({ routeTree: rootRoute, history });
  return { ...render(<RouterProvider router={router} />), router };
};

describe('Login route', () => {
  it('renders login page with API key input and submit button', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    renderLogin();

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('api-key-input')).toBeInTheDocument();
    expect(screen.getByTestId('login-submit')).toBeInTheDocument();
  });

  it('posts { apiKey } to the canonical session endpoint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    renderLogin();

    await waitFor(() => {
      expect(screen.getByTestId('api-key-input')).toBeInTheDocument();
    });

    fireEvent.change(await screen.findByTestId('api-key-input'), {
      target: { value: 'test-key-123' },
    });
    fireEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/v1/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ apiKey: 'test-key-123' }),
      });
    });
  });

  it('shows error message on failed login', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
    renderLogin();

    await waitFor(() => {
      expect(screen.getByTestId('api-key-input')).toBeInTheDocument();
    });

    fireEvent.change(await screen.findByTestId('api-key-input'), { target: { value: 'bad-key' } });
    fireEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('login-error')).toBeInTheDocument();
      expect(screen.getByTestId('login-error')).toHaveTextContent('Invalid API key');
    });
  });

  it('uses a stable fallback for non-Error login failures', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue('network offline');
    renderLogin();
    fireEvent.change(await screen.findByTestId('api-key-input'), { target: { value: 'key' } });
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('login-error')).toHaveTextContent('Unable to sign in'),
    );
  });

  it('uses a masked API key field', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    renderLogin();

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });

    expect(screen.getByTestId('api-key-input')).toHaveAttribute('type', 'password');
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    expect(passwordInputs).toHaveLength(1);
  });

  it('returns to a valid encoded local path after login', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    const { router } = renderLogin('?return=%2Fdashboard%2Fruns');
    fireEvent.change(await screen.findByTestId('api-key-input'), {
      target: { value: 'valid-key' },
    });
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard/runs'));
  });

  it('rejects absolute external return paths', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    const { router } = renderLogin('?return=https%3A%2F%2Fevil.example');
    fireEvent.change(await screen.findByTestId('api-key-input'), {
      target: { value: 'valid-key' },
    });
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('rejects protocol-relative return paths', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    const { router } = renderLogin('?return=%2F%2Fevil.example');
    fireEvent.change(await screen.findByTestId('api-key-input'), {
      target: { value: 'valid-key' },
    });
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('falls back home for malformed return paths', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    const { router } = renderLogin('?return=%');
    fireEvent.change(await screen.findByTestId('api-key-input'), {
      target: { value: 'valid-key' },
    });
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
