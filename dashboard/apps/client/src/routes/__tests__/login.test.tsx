import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '@/test/test-utils';
import { LoginPage } from '../login';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  authState: {
    enabled: true,
    authenticated: false,
    loading: false,
    error: null as string | null,
    login: vi.fn<() => Promise<boolean>>(),
  },
  fetchMock: vi.fn<() => Promise<Response>>(),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (options: Record<string, unknown>) => ({ ...options }),
  useNavigate: () => mocks.navigate,
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: typeof mocks.authState) => unknown) => selector(mocks.authState),
}));

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authState.enabled = true;
    mocks.authState.authenticated = false;
    mocks.authState.loading = false;
    mocks.authState.error = null;
    mocks.authState.login.mockResolvedValue(true);

    // Default: SAML not configured
    mocks.fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ configured: false }),
    } as Response);
    globalThis.fetch = mocks.fetchMock;
  });

  it('renders API key form and sign in button', () => {
    renderWithProviders(<LoginPage />);

    expect(screen.getByRole('heading', { name: 'Automate' })).toBeInTheDocument();
    expect(screen.getByLabelText('API Key')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('toggles API key visibility', async () => {
    renderWithProviders(<LoginPage />);

    const input = screen.getByLabelText('API Key');
    expect(input).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(input).toHaveAttribute('type', 'text');

    await userEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('shows error on failed login', async () => {
    mocks.authState.login.mockResolvedValue(false);

    renderWithProviders(<LoginPage />);
    await userEvent.type(screen.getByLabelText('API Key'), 'bad-key');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid API key')).toBeInTheDocument();
    });
  });

  it('navigates to dashboard on successful login', async () => {
    mocks.authState.login.mockResolvedValue(true);

    renderWithProviders(<LoginPage />);
    await userEvent.type(screen.getByLabelText('API Key'), 'valid-key');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith({ to: '/' });
    });
  });

  it('redirects to / when auth is disabled', async () => {
    mocks.authState.enabled = false;

    renderWithProviders(<LoginPage />);

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith({ to: '/' });
    });
  });

  describe('SSO button', () => {
    it('does not render SSO button when SAML is not configured', async () => {
      renderWithProviders(<LoginPage />);

      await waitFor(() => {
        expect(mocks.fetchMock).toHaveBeenCalledWith('/api/auth/saml/status');
      });

      expect(screen.queryByTestId('sso-login-button')).not.toBeInTheDocument();
    });

    it('renders SSO button when SAML is configured', async () => {
      mocks.fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ configured: true }),
      } as Response);

      renderWithProviders(<LoginPage />);

      await waitFor(() => {
        expect(screen.getByTestId('sso-login-button')).toBeInTheDocument();
      });
      expect(screen.getByTestId('sso-login-button')).toHaveAttribute('href', '/api/auth/saml/login');
    });

    it('does not render SSO button when status fetch returns non-ok', async () => {
      mocks.fetchMock.mockResolvedValue({
        ok: false,
        json: async () => ({ configured: false }),
      } as Response);

      renderWithProviders(<LoginPage />);

      await waitFor(() => {
        expect(mocks.fetchMock).toHaveBeenCalledWith('/api/auth/saml/status');
      });
      expect(screen.queryByTestId('sso-login-button')).not.toBeInTheDocument();
    });

    it('does not render SSO button when status fetch fails', async () => {
      mocks.fetchMock.mockRejectedValue(new Error('Network error'));

      renderWithProviders(<LoginPage />);

      await waitFor(() => {
        expect(mocks.fetchMock).toHaveBeenCalledWith('/api/auth/saml/status');
      });
      expect(screen.queryByTestId('sso-login-button')).not.toBeInTheDocument();
    });
  });
});
