/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GitHubPRConfig } from '../../../components/automate/GitHubPRConfig.js';
import { renderHook, act } from '@testing-library/react';
import { useGitHubIntegration } from '../../../hooks/useGitHubIntegration.js';
import type { GitHubConfig, GitHubConnectionStatus } from '../../../hooks/useGitHubIntegration.js';

vi.mock('../../__root.js', () => ({
  Route: { id: '__root__' },
}));

const defaultConfig: GitHubConfig = {
  repoUrl: '',
  token: '',
  events: { push: false, pull_request: true, schedule: false },
};

const defaultStatus: GitHubConnectionStatus = { connected: false, checkedAt: null };

describe('GitHubPRConfig component', () => {
  it('renders form with repo URL, token, and event checkboxes', () => {
    render(
      <GitHubPRConfig
        config={defaultConfig}
        status={defaultStatus}
        isSaving={false}
        isTesting={false}
        error={null}
        saveSuccess={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onTestConnection={vi.fn()}
      />
    );

    expect(screen.getByTestId('github-pr-config')).toBeInTheDocument();
    expect(screen.getByTestId('repo-url-input')).toBeInTheDocument();
    expect(screen.getByTestId('token-input')).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('event-push')).toBeInTheDocument();
    expect(screen.getByTestId('event-pull-request')).toBeInTheDocument();
    expect(screen.getByTestId('event-schedule')).toBeInTheDocument();
  });

  it('shows disconnected status badge by default', () => {
    render(
      <GitHubPRConfig
        config={defaultConfig}
        status={defaultStatus}
        isSaving={false}
        isTesting={false}
        error={null}
        saveSuccess={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onTestConnection={vi.fn()}
      />
    );

    expect(screen.getByTestId('connection-status')).toHaveTextContent('Disconnected');
  });

  it('shows connected status badge when connected', () => {
    render(
      <GitHubPRConfig
        config={defaultConfig}
        status={{ connected: true, checkedAt: '2024-01-01T00:00:00Z' }}
        isSaving={false}
        isTesting={false}
        error={null}
        saveSuccess={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onTestConnection={vi.fn()}
      />
    );

    expect(screen.getByTestId('connection-status')).toHaveTextContent('Connected');
  });

  it('calls onSave with current config when form is submitted', () => {
    const onSave = vi.fn();
    const config: GitHubConfig = {
      repoUrl: 'https://github.com/owner/repo',
      token: 'ghp_test123',
      events: { push: true, pull_request: true, schedule: false },
    };

    render(
      <GitHubPRConfig
        config={config}
        status={defaultStatus}
        isSaving={false}
        isTesting={false}
        error={null}
        saveSuccess={false}
        onChange={vi.fn()}
        onSave={onSave}
        onTestConnection={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('save-button'));
    expect(onSave).toHaveBeenCalledWith(config);
  });

  it('calls onTestConnection when test connection button is clicked', () => {
    const onTestConnection = vi.fn();
    const config: GitHubConfig = {
      repoUrl: 'https://github.com/owner/repo',
      token: 'ghp_test123',
      events: { push: false, pull_request: true, schedule: false },
    };

    render(
      <GitHubPRConfig
        config={config}
        status={defaultStatus}
        isSaving={false}
        isTesting={false}
        error={null}
        saveSuccess={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onTestConnection={onTestConnection}
      />
    );

    fireEvent.click(screen.getByTestId('test-connection-button'));
    expect(onTestConnection).toHaveBeenCalledWith(config);
  });

  it('disables test connection button when repoUrl or token is empty', () => {
    render(
      <GitHubPRConfig
        config={defaultConfig}
        status={defaultStatus}
        isSaving={false}
        isTesting={false}
        error={null}
        saveSuccess={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onTestConnection={vi.fn()}
      />
    );

    expect(screen.getByTestId('test-connection-button')).toBeDisabled();
  });

  it('calls onChange when repo URL is changed', () => {
    const onChange = vi.fn();

    render(
      <GitHubPRConfig
        config={defaultConfig}
        status={defaultStatus}
        isSaving={false}
        isTesting={false}
        error={null}
        saveSuccess={false}
        onChange={onChange}
        onSave={vi.fn()}
        onTestConnection={vi.fn()}
      />
    );

    fireEvent.change(screen.getByTestId('repo-url-input'), {
      target: { value: 'https://github.com/owner/repo' },
    });

    expect(onChange).toHaveBeenCalledWith({
      ...defaultConfig,
      repoUrl: 'https://github.com/owner/repo',
    });
  });

  it('displays error message when error prop is set', () => {
    render(
      <GitHubPRConfig
        config={defaultConfig}
        status={defaultStatus}
        isSaving={false}
        isTesting={false}
        error="Failed to save config"
        saveSuccess={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onTestConnection={vi.fn()}
      />
    );

    expect(screen.getByTestId('config-error')).toHaveTextContent('Failed to save config');
  });

  it('displays success message when saveSuccess is true', () => {
    render(
      <GitHubPRConfig
        config={defaultConfig}
        status={defaultStatus}
        isSaving={false}
        isTesting={false}
        error={null}
        saveSuccess={true}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onTestConnection={vi.fn()}
      />
    );

    expect(screen.getByTestId('save-success')).toBeInTheDocument();
  });
});

describe('useGitHubIntegration hook', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads config on mount', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        repoUrl: 'https://github.com/owner/repo',
        token: 'ghp_abc',
        events: { push: true, pull_request: false, schedule: false },
      }),
    });

    const { result } = renderHook(() => useGitHubIntegration({ fetchFn: mockFetch as typeof fetch }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.config.repoUrl).toBe('https://github.com/owner/repo');
    expect(result.current.config.events.push).toBe(true);
  });

  it('handles 404 gracefully (no config yet)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    const { result } = renderHook(() => useGitHubIntegration({ fetchFn: mockFetch as typeof fetch }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.config.repoUrl).toBe('');
  });

  it('saveConfig sends PUT request with correct payload', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          repoUrl: 'https://github.com/owner/repo',
          token: 'ghp_saved',
          events: { push: false, pull_request: true, schedule: false },
        }),
      });

    const { result } = renderHook(() => useGitHubIntegration({ fetchFn: mockFetch as typeof fetch }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const cfg: GitHubConfig = {
      repoUrl: 'https://github.com/owner/repo',
      token: 'ghp_saved',
      events: { push: false, pull_request: true, schedule: false },
    };

    await act(async () => {
      await result.current.saveConfig(cfg);
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/integrations/github', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify(cfg),
    }));
    expect(result.current.config.token).toBe('ghp_saved');
  });

  it('testConnection sends POST and updates status', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ connected: true }),
      });

    const { result } = renderHook(() => useGitHubIntegration({ fetchFn: mockFetch as typeof fetch }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const cfg: GitHubConfig = {
      repoUrl: 'https://github.com/owner/repo',
      token: 'ghp_test',
      events: { push: false, pull_request: true, schedule: false },
    };

    await act(async () => {
      await result.current.testConnection(cfg);
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/integrations/github/test', expect.objectContaining({
      method: 'POST',
    }));
    expect(result.current.status.connected).toBe(true);
  });

  it('sets error when fetch fails', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useGitHubIntegration({ fetchFn: mockFetch as typeof fetch }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Network error');
  });
});

// ─── GitHubIntegrationPage ────────────────────────────────────────────────────

import { GitHubIntegrationPage, Route as GitHubRoute } from './github.js';

describe('GitHubIntegrationPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading state while config is being fetched', () => {
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {}));
    render(<GitHubIntegrationPage />);
    expect(screen.getByTestId('github-integration-loading')).toBeInTheDocument();
  });

  it('renders page container after loading (404 = no config yet)', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 404 } as Response)
    );
    render(<GitHubIntegrationPage />);
    await waitFor(() => {
      expect(screen.getByTestId('github-integration-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('github-pr-config')).toBeInTheDocument();
  });

  it('renders page with pre-filled config when API returns config', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          repoUrl: 'https://github.com/owner/repo',
          token: 'ghp_test',
          events: { push: true, pull_request: true, schedule: false },
        }),
      } as Response)
    );
    render(<GitHubIntegrationPage />);
    await waitFor(() => {
      expect(screen.getByTestId('github-pr-config')).toBeInTheDocument();
    });
    expect(screen.getByTestId('repo-url-input')).toHaveValue('https://github.com/owner/repo');
  });

  it('shows error banner when API returns a non-404 error', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 500 } as Response)
    );
    render(<GitHubIntegrationPage />);
    await waitFor(() => {
      expect(screen.getByTestId('config-error')).toBeInTheDocument();
    });
  });

  it('shows disconnected status when loaded with empty config', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 404 } as Response)
    );
    render(<GitHubIntegrationPage />);
    await waitFor(() => {
      expect(screen.getByTestId('connection-status')).toBeInTheDocument();
    });
    expect(screen.getByTestId('connection-status')).toHaveTextContent('Disconnected');
  });

  it('handles config change via onChange prop', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 404 } as Response)
    );
    render(<GitHubIntegrationPage />);
    await waitFor(() => {
      expect(screen.getByTestId('repo-url-input')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('repo-url-input'), {
      target: { value: 'https://github.com/test/repo' },
    });
    expect(screen.getByTestId('repo-url-input')).toHaveValue('https://github.com/test/repo');
  });

  it('saves config when save button is clicked', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          repoUrl: 'https://github.com/owner/repo',
          token: 'ghp_saved',
          events: { push: false, pull_request: true, schedule: false },
        }),
      } as Response);

    render(<GitHubIntegrationPage />);
    await waitFor(() => {
      expect(screen.getByTestId('repo-url-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('repo-url-input'), {
      target: { value: 'https://github.com/owner/repo' },
    });
    fireEvent.change(screen.getByTestId('token-input'), {
      target: { value: 'ghp_saved' },
    });
    fireEvent.click(screen.getByTestId('save-button'));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
  });

  it('Route.options.getParentRoute returns defined parent', () => {
    const opts = (GitHubRoute as unknown as { options: { getParentRoute: () => unknown } }).options;
    expect(opts.getParentRoute()).toBeDefined();
  });

  it('Route.options.component renders GitHubIntegrationPage', async () => {
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {}));
    const opts = (GitHubRoute as unknown as { options: { component: React.ComponentType } }).options;
    render(React.createElement(opts.component));
    expect(screen.getByTestId('github-integration-loading')).toBeInTheDocument();
  });
});
