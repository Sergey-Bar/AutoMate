import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, waitFor } from '@/test/test-utils';
import { ProtectedRoute } from '../ProtectedRoute';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  authState: {
    enabled: true,
    authenticated: false,
    loading: false,
  },
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: typeof mocks.authState) => unknown) => selector(mocks.authState),
}));

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    mocks.authState.enabled = true;
    mocks.authState.authenticated = false;
    mocks.authState.loading = false;
  });

  it('shows loading indicator while auth status is loading', () => {
    mocks.authState.loading = true;

    renderWithProviders(
      <ProtectedRoute>
        <div>Private Content</div>
      </ProtectedRoute>,
    );

    expect(screen.getByTestId('auth-loading')).toBeInTheDocument();
    expect(screen.getByText('Private Content')).toBeInTheDocument();
  });

  it('redirects to /login when auth is enabled and unauthenticated', async () => {
    renderWithProviders(
      <ProtectedRoute>
        <div>Private Content</div>
      </ProtectedRoute>,
    );

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith({ to: '/login' });
    });
  });

  it('does not redirect when already on /login', async () => {
    window.history.replaceState({}, '', '/login');

    renderWithProviders(
      <ProtectedRoute>
        <div>Login Content</div>
      </ProtectedRoute>,
    );

    await waitFor(() => {
      expect(mocks.navigate).not.toHaveBeenCalled();
    });
    expect(screen.getByText('Login Content')).toBeInTheDocument();
  });

  it('renders children when auth is disabled', () => {
    mocks.authState.enabled = false;

    renderWithProviders(
      <ProtectedRoute>
        <div>Open Content</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText('Open Content')).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('renders children when authenticated', () => {
    mocks.authState.authenticated = true;

    renderWithProviders(
      <ProtectedRoute>
        <div>Private Content</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText('Private Content')).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
