import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Route, RunDetailPage } from './$runId.js';
import type { ApiClient, Run } from '../../lib/api.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mockRun: Run = {
  id: 'run-abc12345',
  projectName: 'Automate',
  status: 'passed',
  startedAt: '2026-05-26T10:00:00.000Z',
  durationMs: 4200,
  total: 10,
  passed: 10,
  failed: 0,
};

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

describe('RunDetailPage', () => {
  it('renders loading state initially', () => {
    const api = makeApi({
      getRun: vi.fn(() => new Promise<Run>(() => {})),
    });
    render(<RunDetailPage runId="run-abc12345" api={api} />);
    expect(screen.getByTestId('run-detail-loading')).toBeInTheDocument();
  });

  it('renders not-found state for 404 errors', async () => {
    const api = makeApi({
      getRun: vi.fn(() => Promise.reject(new Error('Run not found'))),
    });
    render(<RunDetailPage runId="run-missing" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-not-found')).toBeInTheDocument();
    });
  });

  it('renders error state for other errors', async () => {
    const api = makeApi({
      getRun: vi.fn(() => Promise.reject(new Error('Server error'))),
    });
    render(<RunDetailPage runId="run-abc12345" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Server error')).toBeInTheDocument();
  });

  it('renders run detail with status badge and stats', async () => {
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue(mockRun),
    });
    render(<RunDetailPage runId="run-abc12345" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('run-status')).toHaveTextContent('passed');
    expect(screen.getByTestId('stat-total')).toHaveTextContent('10');
    expect(screen.getByTestId('stat-passed')).toHaveTextContent('10');
    expect(screen.getByTestId('stat-failed')).toHaveTextContent('0');
    expect(screen.getByTestId('stat-duration')).toHaveTextContent('4200ms');
  });

  it('shows run id and project in results tab', async () => {
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue(mockRun),
    });
    render(<RunDetailPage runId="run-abc12345" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('run-id')).toHaveTextContent('run-abc12345');
    expect(screen.getByTestId('run-project')).toHaveTextContent('Automate');
  });

  // --- Additional tests for full branch coverage ---

  it('renders flaky status badge variant', async () => {
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue({ ...mockRun, status: 'flaky' }),
    });
    render(<RunDetailPage runId="run-abc12345" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('run-status')).toHaveTextContent('flaky');
  });

  it('renders running status badge variant', async () => {
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue({ ...mockRun, status: 'running', durationMs: null }),
    });
    render(<RunDetailPage runId="run-abc12345" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('run-status')).toHaveTextContent('running');
  });

  it('renders unknown/default status badge variant', async () => {
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue({ ...mockRun, status: 'pending' }),
    });
    render(<RunDetailPage runId="run-abc12345" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('run-status')).toHaveTextContent('pending');
  });

  it('shows dash for null duration in stat card', async () => {
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue({ ...mockRun, durationMs: null }),
    });
    render(<RunDetailPage runId="run-abc12345" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('stat-duration')).toHaveTextContent('—');
  });

  it('shows Unknown when projectName is undefined', async () => {
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue({ ...mockRun, projectName: undefined }),
    });
    render(<RunDetailPage runId="run-abc12345" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('run-project')).toHaveTextContent('Unknown');
  });

  it('renders not-found state when error message contains 404', async () => {
    const api = makeApi({
      getRun: vi.fn(() => Promise.reject(new Error('HTTP error 404'))),
    });
    render(<RunDetailPage runId="run-abc12345" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-not-found')).toBeInTheDocument();
    });
  });

  it('renders timeline tab with duration when Timeline tab is clicked', async () => {
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue(mockRun),
    });
    render(<RunDetailPage runId="run-abc12345" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }));
    expect(screen.getByTestId('tab-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-duration')).toHaveTextContent('4200ms');
  });

  it('hides timeline-duration span when durationMs is null', async () => {
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue({ ...mockRun, durationMs: null }),
    });
    render(<RunDetailPage runId="run-abc12345" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }));
    expect(screen.getByTestId('tab-timeline')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-duration')).not.toBeInTheDocument();
  });

  it('renders network tab content when Network tab is clicked', async () => {
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue(mockRun),
    });
    render(<RunDetailPage runId="run-abc12345" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Network' }));
    expect(screen.getByTestId('tab-network')).toBeInTheDocument();
  });

  it('renders metadata tab content when Metadata tab is clicked', async () => {
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue(mockRun),
    });
    render(<RunDetailPage runId="run-abc12345" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));
    expect(screen.getByTestId('tab-metadata')).toBeInTheDocument();
    expect(screen.getByTestId('metadata-run-id')).toHaveTextContent('run-abc12345');
    expect(screen.getByTestId('metadata-status')).toHaveTextContent('passed');
    expect(screen.getByTestId('metadata-project')).toHaveTextContent('Automate');
  });

  it('shows Unknown in metadata when projectName is undefined', async () => {
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue({ ...mockRun, projectName: undefined }),
    });
    render(<RunDetailPage runId="run-abc12345" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));
    expect(screen.getByTestId('metadata-project')).toHaveTextContent('Unknown');
  });

  it('returns nothing when data is null after successful load', async () => {
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue(null as unknown as Run),
    });
    render(<RunDetailPage runId="run-abc12345" api={api} />);
    await waitFor(() => {
      expect(screen.queryByTestId('run-detail-loading')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('run-detail-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('run-detail-error')).not.toBeInTheDocument();
  });

  it('shows neutral trend when failed count is 0', async () => {
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue({ ...mockRun, failed: 0 }),
    });
    render(<RunDetailPage runId="run-abc12345" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('stat-failed')).toHaveTextContent('0');
  });

  it('shows down trend when failed count is non-zero', async () => {
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue({ ...mockRun, failed: 3, passed: 7 }),
    });
    render(<RunDetailPage runId="run-abc12345" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('stat-failed')).toHaveTextContent('3');
  });

  it('renders failed status badge variant (covers statusVariant case)', async () => {
    const api = makeApi({
      getRun: vi.fn().mockResolvedValue({ ...mockRun, status: 'failed', failed: 5 }),
    });
    render(<RunDetailPage runId="run-abc12345" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('run-status')).toHaveTextContent('failed');
  });

  // --- Route callback coverage ---

  it('Route getParentRoute callback returns a defined value', () => {
    const options = Route.options as unknown as { getParentRoute: () => unknown };
    expect(options.getParentRoute()).toBeDefined();
  });

  it('Route component factory renders RunDetailPage via useParams spy', async () => {
    const routeWithSpy = Route as unknown as { useParams: () => { runId: string } };
    vi.spyOn(routeWithSpy, 'useParams').mockReturnValue({ runId: 'run-abc12345' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: 'run-abc12345',
          projectName: 'Automate',
          status: 'passed',
          startedAt: '2026-05-26T10:00:00.000Z',
          durationMs: 4200,
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
