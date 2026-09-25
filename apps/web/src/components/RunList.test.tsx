/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RunList } from './RunList.js';
import type { ApiClient, Run, RunUpdatedEvent } from '../lib/api.js';

describe('RunList', () => {
  const mockRuns: Run[] = [
    { id: 'run-1', projectName: 'project-a', status: 'running', startedAt: '2026-05-05T00:00:00Z' },
    { id: 'run-2', projectName: 'project-b', status: 'passed', startedAt: '2026-05-05T01:00:00Z' },
  ];

  const createMockApi = (
    overrides?: Partial<ApiClient>,
    runs: Run[] = mockRuns
  ): { api: ApiClient; emitUpdate: (e: RunUpdatedEvent) => void } => {
    let callback: ((e: RunUpdatedEvent) => void) | null = null;
    const api: ApiClient = {
      getRuns: vi.fn().mockResolvedValue(runs),
      getRun: vi.fn(),
      getAnalyticsSummary: vi.fn(),
      getQuarantine: vi.fn(),
      addQuarantine: vi.fn(),
      onRunUpdated: vi.fn().mockImplementation((cb) => {
        callback = cb;
        return () => {
          callback = null;
        };
      }),
      ...overrides,
    } as unknown as ApiClient;
    return {
      api,
      emitUpdate: (e: RunUpdatedEvent) => {
        if (callback) {
          act(() => callback!(e));
        }
      },
    };
  };

  it('renders loading state initially', () => {
    const { api } = createMockApi({
      getRuns: () => new Promise(() => {}), // never resolves
    });
    render(<RunList api={api} />);
    expect(screen.getByTestId('runs-loading')).toBeInTheDocument();
  });

  it('renders error state when fetch fails', async () => {
    const { api } = createMockApi({
      getRuns: () => Promise.reject(new Error('Network Error')),
    });
    render(<RunList api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-error')).toBeInTheDocument();
    });
    expect(screen.getByText(/Network Error/)).toBeInTheDocument();
  });

  it('renders empty state when no runs exist', async () => {
    const { api } = createMockApi(undefined, []);
    render(<RunList api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-empty')).toBeInTheDocument();
    });
  });

  it('renders runs list from API', async () => {
    const { api } = createMockApi();
    render(<RunList api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-list')).toBeInTheDocument();
    });
    expect(screen.getByTestId('run-item-run-1')).toBeInTheDocument();
    expect(screen.getByTestId('run-status-run-1')).toHaveTextContent('running');
    expect(screen.getByTestId('run-item-run-2')).toBeInTheDocument();
    expect(screen.getByTestId('run-status-run-2')).toHaveTextContent('passed');
  });

  it('run items have navigation links to run detail', async () => {
    const { api } = createMockApi();
    render(<RunList api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-item-run-1')).toBeInTheDocument();
    });
    const item = screen.getByTestId('run-item-run-1');
    expect(item.tagName.toLowerCase()).toBe('a');
    expect(item).toHaveAttribute('href', '/dashboard/runs/run-1');
  });

  it('updates an existing run in realtime without reload', async () => {
    const { api, emitUpdate } = createMockApi();
    render(<RunList api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-item-run-1')).toBeInTheDocument();
    });

    // Emit update event for run-1
    emitUpdate({
      type: 'run:updated',
      version: '1',
      runId: 'run-1',
      status: 'failed',
      timestamp: new Date().toISOString(),
    });

    await waitFor(() => {
      expect(screen.getByTestId('run-status-run-1')).toHaveTextContent('failed');
    });

    // Ensure it didn't refetch
    expect(api.getRuns).toHaveBeenCalledTimes(1);
  });

  it('adds a new run in realtime', async () => {
    const { api, emitUpdate } = createMockApi();
    render(<RunList api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-list')).toBeInTheDocument();
    });

    emitUpdate({
      type: 'run:updated',
      version: '1',
      runId: 'run-3',
      status: 'started',
      timestamp: new Date().toISOString(),
    });

    await waitFor(() => {
      expect(screen.getByTestId('run-item-run-3')).toBeInTheDocument();
    });
    expect(screen.getByTestId('run-status-run-3')).toHaveTextContent('started');
  });
});
