import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Route, RunDetailPage } from './run-detail.js';
import type { ApiClient, Run } from '../../lib/api.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RunDetailPage', () => {
  const mockRun: Run = {
    id: 'run-123',
    projectName: 'Automate',
    status: 'passed',
    startedAt: '2026-05-05T10:00:00.000Z',
    durationMs: 5000,
    total: 10,
    passed: 10,
    failed: 0,
  };

  it('renders loading state initially', () => {
    const mockApi = {
      getRun: vi.fn(() => new Promise<Run>(() => {})),
    } as unknown as ApiClient;

    render(<RunDetailPage id="run-123" api={mockApi} />);
    expect(screen.getByTestId('run-detail-loading')).toBeInTheDocument();
  });

  it('renders 404 state if run not found', async () => {
    const mockApi = {
      getRun: vi.fn(() => Promise.reject(new Error('Run not found (404)'))),
    } as unknown as ApiClient;

    render(<RunDetailPage id="run-999" api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('run-not-found')).toBeInTheDocument();
    });
  });

  it('renders error state for other API errors', async () => {
    const mockApi = {
      getRun: vi.fn(() => Promise.reject(new Error('Internal Server Error'))),
    } as unknown as ApiClient;

    render(<RunDetailPage id="run-123" api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('run-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Internal Server Error')).toBeInTheDocument();
  });

  it('renders run details correctly', async () => {
    const mockApi = {
      getRun: vi.fn(() => Promise.resolve(mockRun)),
    } as unknown as ApiClient;

    render(<RunDetailPage id="run-123" api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });

    expect(screen.getByTestId('run-id')).toHaveTextContent('run-123');
    expect(screen.getByTestId('run-status')).toHaveTextContent('passed');
    expect(screen.getByTestId('run-project')).toHaveTextContent('Automate');
    expect(screen.getByTestId('run-total')).toHaveTextContent('10');
    expect(screen.getByTestId('run-passed')).toHaveTextContent('10');
    expect(screen.getByTestId('run-failed')).toHaveTextContent('0');
    expect(screen.getByTestId('run-duration')).toHaveTextContent('5000ms');
  });

  it('renders N/A duration for running run', async () => {
    const mockApi = {
      getRun: vi.fn(() => Promise.resolve({ ...mockRun, durationMs: null, status: 'running' })),
    } as unknown as ApiClient;
    render(<RunDetailPage id="run-running" api={mockApi} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('run-duration')).toHaveTextContent('N/A');
  });

  // --- Additional tests for full branch coverage ---

  it('renders not-found state when error message contains 404 but not "not found"', async () => {
    const mockApi = {
      getRun: vi.fn(() => Promise.reject(new Error('HTTP error 404'))),
    } as unknown as ApiClient;

    render(<RunDetailPage id="run-999" api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('run-not-found')).toBeInTheDocument();
    });
  });

  it('shows Unknown when projectName is falsy', async () => {
    const mockApi = {
      getRun: vi.fn(() => Promise.resolve({ ...mockRun, projectName: undefined })),
    } as unknown as ApiClient;

    render(<RunDetailPage id="run-123" api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('run-project')).toHaveTextContent('Unknown');
  });

  it('shows 0 for null total, passed, failed counts', async () => {
    const mockApi = {
      getRun: vi.fn(() =>
        Promise.resolve({ ...mockRun, total: null, passed: null, failed: null }),
      ),
    } as unknown as ApiClient;

    render(<RunDetailPage id="run-123" api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('run-total')).toHaveTextContent('0');
    expect(screen.getByTestId('run-passed')).toHaveTextContent('0');
    expect(screen.getByTestId('run-failed')).toHaveTextContent('0');
  });

  it('returns null (empty render) when data is null after loading', async () => {
    const mockApi = {
      getRun: vi.fn(() => Promise.resolve(null as unknown as Run)),
    } as unknown as ApiClient;

    render(<RunDetailPage id="run-123" api={mockApi} />);

    await waitFor(() => {
      expect(screen.queryByTestId('run-detail-loading')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('run-detail-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('run-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('run-not-found')).not.toBeInTheDocument();
  });

  it('loading message includes the run id', () => {
    const mockApi = {
      getRun: vi.fn(() => new Promise<Run>(() => {})),
    } as unknown as ApiClient;

    render(<RunDetailPage id="run-xyz" api={mockApi} />);
    expect(screen.getByTestId('run-detail-loading')).toHaveTextContent('run-xyz');
  });

  // --- Route callback coverage ---

  it('Route getParentRoute callback returns a defined value', () => {
    const options = Route.options as unknown as { getParentRoute: () => unknown };
    expect(options.getParentRoute()).toBeDefined();
  });

  it('Route component factory renders RunDetailPage via useParams spy', async () => {
    const routeWithSpy = Route as unknown as { useParams: () => { id: string } };
    vi.spyOn(routeWithSpy, 'useParams').mockReturnValue({ id: 'run-123' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'run-123',
          projectName: 'Test',
          status: 'passed',
          startedAt: '2026-05-05T10:00:00.000Z',
          durationMs: 5000,
          total: 10,
          passed: 10,
          failed: 0,
        }),
      }),
    );
    const options = Route.options as unknown as { component: () => React.ReactNode };
    render(<>{options.component()}</>);
    await waitFor(() => {
      expect(screen.queryByTestId('run-detail-loading')).not.toBeInTheDocument();
    });
  });
});
