/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import type { AnyRootRoute } from '@tanstack/react-router';
import { Route as loginRoute } from './login.js';

Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });

beforeEach(() => {
  sessionStorage.clear();
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

  it('posts { apiKey } to /api/auth/login on submit', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    renderLogin();

    await waitFor(() => {
      expect(screen.getByTestId('api-key-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('api-key-input'), { target: { value: 'test-key-123' } });
    fireEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

    fireEvent.change(screen.getByTestId('api-key-input'), { target: { value: 'bad-key' } });
    fireEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('login-error')).toBeInTheDocument();
      expect(screen.getByTestId('login-error')).toHaveTextContent('Invalid API key');
    });
  });

  it('does not have a password field', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    renderLogin();

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });

    expect(screen.queryByRole('textbox', { name: /password/i })).not.toBeInTheDocument();
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    expect(passwordInputs).toHaveLength(0);
  });
});
