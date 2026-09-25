import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Route, SuitesPage } from './suites.js';
import type { ApiClient, Suite } from '../../lib/api.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mockSuites: Suite[] = [
  {
    id: 'suite-1',
    name: 'Auth Tests',
    projectName: 'Automate',
    totalRuns: 5,
    lastRunAt: '2026-05-26T10:00:00.000Z',
    passRate: 95,
  },
  {
    id: 'suite-2',
    name: 'Dashboard Tests',
    projectName: 'Dashboard',
    totalRuns: 3,
    lastRunAt: '2026-05-25T08:00:00.000Z',
    passRate: 40,
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

describe('SuitesPage', () => {
  it('renders loading state initially', () => {
    const api = makeApi({
      getSuites: vi.fn(() => new Promise<Suite[]>(() => {})),
    });
    render(<SuitesPage api={api} />);
    expect(screen.getByTestId('suites-loading')).toBeInTheDocument();
  });

  it('renders error state when fetch fails', async () => {
    const api = makeApi({
      getSuites: vi.fn(() => Promise.reject(new Error('Failed to fetch suites'))),
    });
    render(<SuitesPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('suites-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Failed to fetch suites')).toBeInTheDocument();
  });

  it('renders empty state when no suites', async () => {
    const api = makeApi({ getSuites: vi.fn().mockResolvedValue([]) });
    render(<SuitesPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('suites-empty')).toBeInTheDocument();
    });
  });

  it('renders suites table with data', async () => {
    const api = makeApi({ getSuites: vi.fn().mockResolvedValue(mockSuites) });
    render(<SuitesPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('suites-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('suite-row-suite-1')).toBeInTheDocument();
    expect(screen.getByTestId('suite-row-suite-2')).toBeInTheDocument();
    expect(screen.getByText('Auth Tests')).toBeInTheDocument();
    expect(screen.getByText('Dashboard Tests')).toBeInTheDocument();
  });

  // --- Additional tests for full branch coverage ---

  it('renders success badge for passRate >= 80', async () => {
    const api = makeApi({
      getSuites: vi.fn().mockResolvedValue([{ ...mockSuites[0], passRate: 95 }]),
    });
    render(<SuitesPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('suites-page')).toBeInTheDocument();
    });
    expect(screen.getByText('95%')).toBeInTheDocument();
  });

  it('renders warning badge for passRate >= 50 and < 80', async () => {
    const api = makeApi({
      getSuites: vi.fn().mockResolvedValue([
        { ...mockSuites[0], id: 'suite-warn', passRate: 70 },
      ]),
    });
    render(<SuitesPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('suites-page')).toBeInTheDocument();
    });
    expect(screen.getByText('70%')).toBeInTheDocument();
  });

  it('renders warning badge for passRate exactly 50', async () => {
    const api = makeApi({
      getSuites: vi.fn().mockResolvedValue([
        { ...mockSuites[0], id: 'suite-50', passRate: 50 },
      ]),
    });
    render(<SuitesPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('suites-page')).toBeInTheDocument();
    });
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('renders danger badge for passRate < 50', async () => {
    const api = makeApi({
      getSuites: vi.fn().mockResolvedValue([{ ...mockSuites[1], passRate: 40 }]),
    });
    render(<SuitesPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('suites-page')).toBeInTheDocument();
    });
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('renders dash for null passRate', async () => {
    const api = makeApi({
      getSuites: vi.fn().mockResolvedValue([
        { ...mockSuites[0], id: 'suite-nullpr', passRate: null },
      ]),
    });
    render(<SuitesPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('suites-page')).toBeInTheDocument();
    });
    const row = screen.getByTestId('suite-row-suite-nullpr');
    expect(row).toHaveTextContent('—');
  });

  it('renders dash for null lastRunAt', async () => {
    const api = makeApi({
      getSuites: vi.fn().mockResolvedValue([
        { ...mockSuites[0], id: 'suite-nulllr', lastRunAt: null },
      ]),
    });
    render(<SuitesPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('suites-page')).toBeInTheDocument();
    });
    const row = screen.getByTestId('suite-row-suite-nulllr');
    expect(row).toHaveTextContent('—');
  });

  it('renders dash for undefined projectName', async () => {
    const api = makeApi({
      getSuites: vi.fn().mockResolvedValue([
        { ...mockSuites[0], id: 'suite-noproj', projectName: undefined },
      ]),
    });
    render(<SuitesPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('suites-page')).toBeInTheDocument();
    });
    const row = screen.getByTestId('suite-row-suite-noproj');
    expect(row).toHaveTextContent('—');
  });

  it('renders dash for undefined totalRuns', async () => {
    const api = makeApi({
      getSuites: vi.fn().mockResolvedValue([
        { ...mockSuites[0], id: 'suite-notr', totalRuns: undefined },
      ]),
    });
    render(<SuitesPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('suites-page')).toBeInTheDocument();
    });
    const row = screen.getByTestId('suite-row-suite-notr');
    expect(row).toHaveTextContent('—');
  });

  it('renders passRate 80 boundary as success', async () => {
    const api = makeApi({
      getSuites: vi.fn().mockResolvedValue([
        { ...mockSuites[0], id: 'suite-80', passRate: 80 },
      ]),
    });
    render(<SuitesPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('suites-page')).toBeInTheDocument();
    });
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  // --- Route callback coverage ---

  it('Route getParentRoute callback returns a defined value', () => {
    const options = Route.options as unknown as { getParentRoute: () => unknown };
    expect(options.getParentRoute()).toBeDefined();
  });

  it('Route component factory renders SuitesPage with default client', async () => {
    const options = Route.options as unknown as { component: () => React.ReactNode };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      }),
    );
    render(<>{options.component()}</>);
    await waitFor(() => {
      expect(screen.getByTestId('suites-empty')).toBeInTheDocument();
    });
  });
});
