/// <reference types="@testing-library/jest-dom" />

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, waitFor, userEvent } from '../../../test/test-utils';
import { DataRetentionSettings } from '../DataRetentionSettings';

vi.mock('framer-motion', async () => {
  const ReactModule = await import('react');
  return {
    motion: new Proxy({}, {
      get: (_target: unknown, prop: string) => {
        return ({ initial: _initial, animate: _animate, exit: _exit, variants: _variants, transition: _transition, ...rest }: Record<string, unknown>) => {
          const validTags = ['div', 'span', 'button', 'p', 'li', 'section', 'a'];
          const Tag = typeof prop === 'string' && validTags.includes(prop) ? prop : 'div';
          return ReactModule.createElement(Tag, rest);
        };
      },
    }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => ReactModule.createElement(React.Fragment, null, children),
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const defaultConfig = {
  testResultDays: 90,
  nlQueryHistoryDays: 30,
  attachmentDays: 60,
  trendsDays: -1,
  enabled: false,
};

const defaultStats = {
  sizeBytes: 2097152,
  sizeMB: '2.00',
  pageCount: 512,
  pageSize: 4096,
};

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (input) => {
    const url = String(input);
    if (url === '/api/settings/data-retention') return jsonResponse(defaultConfig);
    if (url === '/api/settings/db-stats') return jsonResponse(defaultStats);
    return jsonResponse({});
  });
});

describe('DataRetentionSettings', () => {
  it('renders retention settings section with all four period fields', async () => {
    renderWithProviders(<DataRetentionSettings />);

    expect(await screen.findByText('Data Retention')).toBeInTheDocument();
    expect(screen.getByText('Retention Periods')).toBeInTheDocument();
    expect(screen.getByText('Test Results')).toBeInTheDocument();
    expect(screen.getByText('NL Query History')).toBeInTheDocument();
    expect(screen.getByText('Attachments')).toBeInTheDocument();
    expect(screen.getByText('Trend Data')).toBeInTheDocument();
  });

  it('shows disabled state with warning message when retention is off', async () => {
    renderWithProviders(<DataRetentionSettings />);

    expect(await screen.findByText('Automatic cleanup is disabled. Old data will accumulate indefinitely.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument();
  });

  it('shows enabled state with active message when retention is on', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/settings/data-retention') return jsonResponse({ ...defaultConfig, enabled: true });
      if (url === '/api/settings/db-stats') return jsonResponse(defaultStats);
      return jsonResponse({});
    });

    renderWithProviders(<DataRetentionSettings />);

    expect(await screen.findByText('Automatic cleanup is active. Data older than configured thresholds will be removed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument();
  });

  it('loads config and populates form fields', async () => {
    renderWithProviders(<DataRetentionSettings />);

    const inputs = await screen.findAllByRole('spinbutton');
    // testResultDays=90, nlQueryHistoryDays=30, attachmentDays=60, trendsDays=-1
    expect(inputs[0]).toHaveValue(90);
    expect(inputs[1]).toHaveValue(30);
    expect(inputs[2]).toHaveValue(60);
    expect(inputs[3]).toHaveValue(-1);
  });

  it('displays database stats', async () => {
    renderWithProviders(<DataRetentionSettings />);

    expect(await screen.findByText('512')).toBeInTheDocument();
    expect(screen.getByText('Database Size')).toBeInTheDocument();
  });

  it('enables Save Changes button when form value is changed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DataRetentionSettings />);

    const inputs = await screen.findAllByRole('spinbutton');
    const saveBtn = screen.getByRole('button', { name: 'Save Changes' });
    expect(saveBtn).toBeDisabled();

    await user.clear(inputs[0]);
    await user.type(inputs[0], '30');

    expect(saveBtn).not.toBeDisabled();
  });

  it('saves updated retention config and shows success toast', async () => {
    const { toast } = await import('sonner');
    const user = userEvent.setup();

    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/settings/data-retention' && method === 'GET') return jsonResponse(defaultConfig);
      if (url === '/api/settings/data-retention' && method === 'PUT') return jsonResponse({});
      if (url === '/api/settings/db-stats') return jsonResponse(defaultStats);
      return jsonResponse({});
    });

    renderWithProviders(<DataRetentionSettings />);

    const inputs = await screen.findAllByRole('spinbutton');
    await user.clear(inputs[0]);
    await user.type(inputs[0], '45');

    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/settings/data-retention',
        expect.objectContaining({ method: 'PUT' }),
      );
      expect(toast.success).toHaveBeenCalledWith('Retention policy updated');
    });
  });

  it('shows error toast when save fails', async () => {
    const { toast } = await import('sonner');
    const user = userEvent.setup();

    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/settings/data-retention' && method === 'GET') return jsonResponse(defaultConfig);
      if (url === '/api/settings/data-retention' && method === 'PUT') return jsonResponse({ error: 'server error' }, 500);
      if (url === '/api/settings/db-stats') return jsonResponse(defaultStats);
      return jsonResponse({});
    });

    renderWithProviders(<DataRetentionSettings />);

    const inputs = await screen.findAllByRole('spinbutton');
    await user.clear(inputs[0]);
    await user.type(inputs[0], '45');

    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to update retention policy');
    });
  });

  it('toggles retention on/off and shows appropriate success message', async () => {
    const { toast } = await import('sonner');
    const user = userEvent.setup();

    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/settings/data-retention' && method === 'GET') return jsonResponse(defaultConfig);
      if (url === '/api/settings/data-retention' && method === 'PUT') return jsonResponse({});
      if (url === '/api/settings/db-stats') return jsonResponse(defaultStats);
      return jsonResponse({});
    });

    renderWithProviders(<DataRetentionSettings />);

    await user.click(await screen.findByRole('button', { name: 'Enable' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/settings/data-retention',
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    const putCall = mockFetch.mock.calls.find(
      (c) => String(c[0]) === '/api/settings/data-retention' && (c[1]?.method ?? 'GET') === 'PUT',
    );
    const body = JSON.parse(String(putCall?.[1]?.body));
    expect(body.enabled).toBe(true);
    expect(toast.success).toHaveBeenCalled();
  });

  it('shows error toast when toggle fails', async () => {
    const { toast } = await import('sonner');
    const user = userEvent.setup();

    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/settings/data-retention' && method === 'GET') return jsonResponse(defaultConfig);
      if (url === '/api/settings/data-retention' && method === 'PUT') return jsonResponse({ error: 'server error' }, 500);
      if (url === '/api/settings/db-stats') return jsonResponse(defaultStats);
      return jsonResponse({});
    });

    renderWithProviders(<DataRetentionSettings />);

    await user.click(await screen.findByRole('button', { name: 'Enable' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to update retention policy');
    });
  });

  it('runs cleanup and shows success toast with details', async () => {
    const { toast } = await import('sonner');
    const user = userEvent.setup();

    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/settings/data-retention' && method === 'GET') return jsonResponse(defaultConfig);
      if (url === '/api/settings/data-retention/run' && method === 'POST') {
        return jsonResponse({
          deletedRuns: 12,
          deletedResults: 450,
          deletedNlQueries: 33,
          deletedAttachments: 128,
          durationMs: 250,
        });
      }
      if (url === '/api/settings/db-stats') return jsonResponse(defaultStats);
      return jsonResponse({});
    });

    renderWithProviders(<DataRetentionSettings />);

    await user.click(await screen.findByRole('button', { name: /Run Cleanup/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('12 runs'));
    });
  });

  it('shows error toast when cleanup fails', async () => {
    const { toast } = await import('sonner');
    const user = userEvent.setup();

    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/settings/data-retention' && method === 'GET') return jsonResponse(defaultConfig);
      if (url === '/api/settings/data-retention/run' && method === 'POST') return jsonResponse({ error: 'cleanup error' }, 500);
      if (url === '/api/settings/db-stats') return jsonResponse(defaultStats);
      return jsonResponse({});
    });

    renderWithProviders(<DataRetentionSettings />);

    await user.click(await screen.findByRole('button', { name: /Run Cleanup/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Cleanup failed');
    });
  });

  it('ignores non-numeric input in numeric fields', async () => {
    const user = userEvent.setup();

    renderWithProviders(<DataRetentionSettings />);

    const inputs = await screen.findAllByRole('spinbutton');
    await user.clear(inputs[0]);
    await user.type(inputs[0], 'abc');

    // Value should remain the same (90) since 'abc' is NaN
    expect(inputs[0]).toHaveValue(90);
  });
});
