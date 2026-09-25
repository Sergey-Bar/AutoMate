import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RunsListPage } from './index.js';
import type { ApiClient, Run } from '../../lib/api.js';

const mockRuns: Run[] = [
  {
    id: 'run-abc12345',
    projectName: 'Automate',
    status: 'passed',
    startedAt: '2026-05-26T10:00:00.000Z',
    durationMs: 3000,
    total: 20,
    passed: 20,
    failed: 0,
  },
  {
    id: 'run-def67890',
    projectName: 'Dashboard',
    status: 'failed',
    startedAt: '2026-05-26T09:00:00.000Z',
    durationMs: 5000,
    total: 15,
    passed: 10,
    failed: 5,
  },
];

function makeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getRuns: vi.fn().mockResolvedValue([]),
    getRun: vi.fn(),
    getSuites: vi.fn().mockResolvedValue([]),
    getTests: vi.fn().mockResolvedValue([]),
    getAnalyticsSummary: vi.fn(),
    getQuarantine: vi.fn(),
    addQuarantine: vi.fn(),
    onRunUpdated: vi.fn(() => () => undefined),
    getConversations: vi.fn(),
    createConversation: vi.fn(),
    sendMessage: vi.fn(),
    getMessages: vi.fn(),
    getModelConfig: vi.fn(),
    updateModelConfig: vi.fn(),
    getConnectors: vi.fn().mockResolvedValue([]),
    getVaultSecrets: vi.fn().mockResolvedValue([]),
    deleteVaultSecret: vi.fn().mockResolvedValue(undefined),
    getA11yAudit: vi.fn().mockResolvedValue({ violations: [], pagesScanned: 0, scannedAt: '' }),
    ...overrides,
  };
}

describe('RunsListPage', () => {
  it('renders loading state initially', () => {
    const api = makeApi({
      getRuns: vi.fn(() => new Promise<Run[]>(() => {})),
    });
    render(<RunsListPage api={api} />);
    expect(screen.getByTestId('runs-list-loading')).toBeInTheDocument();
  });

  it('renders error state when fetch fails', async () => {
    const api = makeApi({
      getRuns: vi.fn(() => Promise.reject(new Error('Network error'))),
    });
    render(<RunsListPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-list-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('renders empty state when no runs', async () => {
    const api = makeApi({ getRuns: vi.fn().mockResolvedValue([]) });
    render(<RunsListPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-list-empty')).toBeInTheDocument();
    });
  });

  it('renders runs table with data', async () => {
    const api = makeApi({ getRuns: vi.fn().mockResolvedValue(mockRuns) });
    render(<RunsListPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-list-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('run-row-run-abc12345')).toBeInTheDocument();
    expect(screen.getByTestId('run-row-run-def67890')).toBeInTheDocument();
    expect(screen.getByText('passed')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  it('renders stat cards with correct counts', async () => {
    const api = makeApi({ getRuns: vi.fn().mockResolvedValue(mockRuns) });
    render(<RunsListPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-list-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('stat-total')).toHaveTextContent('2');
    expect(screen.getByTestId('stat-passed')).toHaveTextContent('1');
    expect(screen.getByTestId('stat-failed')).toHaveTextContent('1');
  });

  // --- Additional tests for full branch coverage ---

  it('renders flaky status badge', async () => {
    const flakyRun: Run = {
      id: 'run-flaky01',
      projectName: 'Project',
      status: 'flaky',
      startedAt: '2026-05-26T08:00:00.000Z',
      durationMs: 2000,
      total: 5,
      passed: 4,
      failed: 1,
    };
    const api = makeApi({ getRuns: vi.fn().mockResolvedValue([flakyRun]) });
    render(<RunsListPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-list-page')).toBeInTheDocument();
    });
    expect(screen.getByText('flaky')).toBeInTheDocument();
  });

  it('renders running status badge', async () => {
    const runningRun: Run = {
      id: 'run-run0001',
      projectName: 'Project',
      status: 'running',
      startedAt: '2026-05-26T08:00:00.000Z',
      durationMs: null,
      total: undefined,
      passed: undefined,
      failed: undefined,
    };
    const api = makeApi({ getRuns: vi.fn().mockResolvedValue([runningRun]) });
    render(<RunsListPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-list-page')).toBeInTheDocument();
    });
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('renders unknown/default status badge', async () => {
    const unknownRun: Run = {
      id: 'run-unk0001',
      projectName: 'Project',
      status: 'pending',
      startedAt: '2026-05-26T08:00:00.000Z',
    };
    const api = makeApi({ getRuns: vi.fn().mockResolvedValue([unknownRun]) });
    render(<RunsListPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-list-page')).toBeInTheDocument();
    });
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('shows dash for null durationMs', async () => {
    const nullDurationRun: Run = {
      id: 'run-nodur01',
      projectName: 'Project',
      status: 'running',
      startedAt: '2026-05-26T08:00:00.000Z',
      durationMs: null,
    };
    const api = makeApi({ getRuns: vi.fn().mockResolvedValue([nullDurationRun]) });
    render(<RunsListPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-list-page')).toBeInTheDocument();
    });
    const row = screen.getByTestId('run-row-run-nodur01');
    expect(row).toHaveTextContent('—');
  });

  it('shows dash for null projectName', async () => {
    const nullProjectRun: Run = {
      id: 'run-noproj1',
      projectName: undefined,
      status: 'passed',
      startedAt: '2026-05-26T08:00:00.000Z',
      durationMs: 1000,
      total: 1,
      passed: 1,
      failed: 0,
    };
    const api = makeApi({ getRuns: vi.fn().mockResolvedValue([nullProjectRun]) });
    render(<RunsListPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-list-page')).toBeInTheDocument();
    });
    const row = screen.getByTestId('run-row-run-noproj1');
    expect(row).toHaveTextContent('—');
  });

  it('shows dash for null total in tests column', async () => {
    const nullTotalRun: Run = {
      id: 'run-notot01',
      projectName: 'Project',
      status: 'passed',
      startedAt: '2026-05-26T08:00:00.000Z',
      durationMs: 1000,
      total: undefined,
      passed: undefined,
      failed: 0,
    };
    const api = makeApi({ getRuns: vi.fn().mockResolvedValue([nullTotalRun]) });
    render(<RunsListPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-list-page')).toBeInTheDocument();
    });
    const row = screen.getByTestId('run-row-run-notot01');
    expect(row).toHaveTextContent('—');
  });

  it('shows stat-running count', async () => {
    const runningRun: Run = {
      id: 'run-running1',
      projectName: 'Project',
      status: 'running',
      startedAt: '2026-05-26T08:00:00.000Z',
    };
    const api = makeApi({ getRuns: vi.fn().mockResolvedValue([runningRun]) });
    render(<RunsListPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-list-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('stat-running')).toHaveTextContent('1');
  });

  it('shows zero stat-running when no running runs', async () => {
    const api = makeApi({ getRuns: vi.fn().mockResolvedValue(mockRuns) });
    render(<RunsListPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-list-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('stat-running')).toHaveTextContent('0');
  });

  it('renders all stat cards even when list is empty', async () => {
    const api = makeApi({ getRuns: vi.fn().mockResolvedValue([]) });
    render(<RunsListPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-list-empty')).toBeInTheDocument();
    });
    expect(screen.getByTestId('stat-total')).toHaveTextContent('0');
    expect(screen.getByTestId('stat-passed')).toHaveTextContent('0');
    expect(screen.getByTestId('stat-failed')).toHaveTextContent('0');
    expect(screen.getByTestId('stat-running')).toHaveTextContent('0');
  });

  it('shows passed/total in tests column', async () => {
    const api = makeApi({ getRuns: vi.fn().mockResolvedValue([mockRuns[0]]) });
    render(<RunsListPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-list-page')).toBeInTheDocument();
    });
    const row = screen.getByTestId('run-row-run-abc12345');
    expect(row).toHaveTextContent('20/20');
  });
});
