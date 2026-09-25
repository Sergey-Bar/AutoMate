import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Route, TestsPage } from './tests.js';
import type { ApiClient, Test } from '../../lib/api.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mockTests: Test[] = [
  {
    id: 'test-1',
    title: 'should login successfully',
    file: 'auth.spec.ts',
    status: 'passed',
    durationMs: 1200,
    suiteName: 'Auth Tests',
  },
  {
    id: 'test-2',
    title: 'should show error on bad credentials',
    file: 'auth.spec.ts',
    status: 'failed',
    durationMs: 800,
    suiteName: 'Auth Tests',
  },
  {
    id: 'test-3',
    title: 'should load dashboard',
    file: 'dashboard.spec.ts',
    status: 'flaky',
    durationMs: null,
    suiteName: 'Dashboard Tests',
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

describe('TestsPage', () => {
  it('renders loading state initially', () => {
    const api = makeApi({
      getTests: vi.fn(() => new Promise<Test[]>(() => {})),
    });
    render(<TestsPage api={api} />);
    expect(screen.getByTestId('tests-loading')).toBeInTheDocument();
  });

  it('renders error state when fetch fails', async () => {
    const api = makeApi({
      getTests: vi.fn(() => Promise.reject(new Error('Failed to fetch tests'))),
    });
    render(<TestsPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('tests-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Failed to fetch tests')).toBeInTheDocument();
  });

  it('renders empty state when no tests', async () => {
    const api = makeApi({ getTests: vi.fn().mockResolvedValue([]) });
    render(<TestsPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('tests-empty')).toBeInTheDocument();
    });
  });

  it('renders tests table with data', async () => {
    const api = makeApi({ getTests: vi.fn().mockResolvedValue(mockTests) });
    render(<TestsPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('tests-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('test-row-test-1')).toBeInTheDocument();
    expect(screen.getByTestId('test-row-test-2')).toBeInTheDocument();
    expect(screen.getByTestId('test-row-test-3')).toBeInTheDocument();
    expect(screen.getByText('should login successfully')).toBeInTheDocument();
    expect(screen.getByText('should show error on bad credentials')).toBeInTheDocument();
  });

  it('renders status badges with correct variants', async () => {
    const api = makeApi({ getTests: vi.fn().mockResolvedValue(mockTests) });
    render(<TestsPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('tests-page')).toBeInTheDocument();
    });
    expect(screen.getByText('passed')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('flaky')).toBeInTheDocument();
  });

  it('shows dash for null duration', async () => {
    const api = makeApi({ getTests: vi.fn().mockResolvedValue(mockTests) });
    render(<TestsPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('tests-page')).toBeInTheDocument();
    });
    // test-3 has null durationMs
    const row = screen.getByTestId('test-row-test-3');
    expect(row).toHaveTextContent('—');
  });

  // --- Additional tests for full branch coverage ---

  it('renders running status badge (default variant)', async () => {
    const runningTest: Test = {
      id: 'test-running',
      title: 'should run in parallel',
      file: 'parallel.spec.ts',
      status: 'running',
      durationMs: null,
      suiteName: 'Parallel',
    };
    const api = makeApi({ getTests: vi.fn().mockResolvedValue([runningTest]) });
    render(<TestsPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('tests-page')).toBeInTheDocument();
    });
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('renders unknown status badge (secondary/default variant)', async () => {
    const unknownTest: Test = {
      id: 'test-unknown',
      title: 'should do something',
      file: 'misc.spec.ts',
      status: 'pending',
      durationMs: 0,
      suiteName: 'Misc',
    };
    const api = makeApi({ getTests: vi.fn().mockResolvedValue([unknownTest]) });
    render(<TestsPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('tests-page')).toBeInTheDocument();
    });
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('shows dash for null suiteName', async () => {
    const noSuiteTest: Test = {
      id: 'test-nosuite',
      title: 'standalone test',
      file: 'standalone.spec.ts',
      status: 'passed',
      durationMs: 500,
      suiteName: undefined,
    };
    const api = makeApi({ getTests: vi.fn().mockResolvedValue([noSuiteTest]) });
    render(<TestsPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('tests-page')).toBeInTheDocument();
    });
    const row = screen.getByTestId('test-row-test-nosuite');
    expect(row).toHaveTextContent('—');
  });

  it('shows dash for null/undefined file', async () => {
    const noFileTest: Test = {
      id: 'test-nofile',
      title: 'test without file',
      file: undefined,
      status: 'passed',
      durationMs: 300,
      suiteName: 'Suite A',
    };
    const api = makeApi({ getTests: vi.fn().mockResolvedValue([noFileTest]) });
    render(<TestsPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('tests-page')).toBeInTheDocument();
    });
    const row = screen.getByTestId('test-row-test-nofile');
    expect(row).toHaveTextContent('—');
  });

  it('renders duration in ms when durationMs is set', async () => {
    const api = makeApi({ getTests: vi.fn().mockResolvedValue([mockTests[0]]) });
    render(<TestsPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('tests-page')).toBeInTheDocument();
    });
    expect(screen.getByText('1200ms')).toBeInTheDocument();
  });

  it('renders the page heading', async () => {
    const api = makeApi({ getTests: vi.fn().mockResolvedValue(mockTests) });
    render(<TestsPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('tests-page')).toBeInTheDocument();
    });
    expect(screen.getByText('Tests')).toBeInTheDocument();
  });

  // --- Route callback coverage ---

  it('Route getParentRoute callback returns a defined value', () => {
    const options = Route.options as unknown as { getParentRoute: () => unknown };
    expect(options.getParentRoute()).toBeDefined();
  });

  it('Route component factory renders TestsPage with default client', async () => {
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
      expect(screen.getByTestId('tests-empty')).toBeInTheDocument();
    });
  });
});
