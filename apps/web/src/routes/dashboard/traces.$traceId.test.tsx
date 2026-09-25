import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Route, TraceViewerPage } from './traces.$traceId.js';
import type { Trace } from '../../hooks/useTrace.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mockTrace: Trace = {
  id: 'trace-abc123',
  testName: 'Login flow should succeed',
  status: 'passed',
  durationMs: 3200,
  startedAt: '2026-05-26T10:00:00.000Z',
  traceUrl: null,
  actions: [
    { type: 'click', title: 'Click login button', durationMs: 120 },
    { type: 'fill', title: 'Fill email field', durationMs: 45 },
  ],
  networkRequests: [
    { method: 'POST', url: '/api/auth/login', status: 200 },
  ],
  consoleLogs: [
    { level: 'info', message: 'Login successful' },
  ],
};

function makeFetch(response: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(response),
  } as Response);
}

function makeFailFetch(status: number): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({}),
  } as Response);
}

describe('TraceViewerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', () => {
    const fetchFn = vi.fn(() => new Promise<Response>(() => {}));
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    expect(screen.getByTestId('trace-loading')).toBeInTheDocument();
  });

  it('renders trace metadata and tabs after successful fetch', async () => {
    const fetchFn = makeFetch(mockTrace);
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-viewer-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('trace-status')).toHaveTextContent('passed');
    expect(screen.getByTestId('trace-test-name')).toHaveTextContent('Login flow should succeed');
    expect(screen.getByTestId('trace-duration')).toHaveTextContent('3.20s');
    expect(screen.getByTestId('trace-metadata')).toBeInTheDocument();
  });

  it('renders not-found state for 404 errors', async () => {
    const fetchFn = makeFailFetch(404);
    render(<TraceViewerPage traceId="trace-missing" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-not-found')).toBeInTheDocument();
    });
  });

  it('renders error state for other errors', async () => {
    const fetchFn = makeFailFetch(500);
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-error')).toBeInTheDocument();
    });
  });

  it('renders actions tab content', async () => {
    const fetchFn = makeFetch(mockTrace);
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('tab-actions')).toBeInTheDocument();
    });
    expect(screen.getByText('Click login button')).toBeInTheDocument();
    expect(screen.getByText('Fill email field')).toBeInTheDocument();
  });

  it('renders empty actions message when no actions', async () => {
    const fetchFn = makeFetch({ ...mockTrace, actions: [] });
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('tab-actions')).toBeInTheDocument();
    });
    expect(screen.getByText('No actions recorded.')).toBeInTheDocument();
  });

  it('does not render iframe when traceUrl is null', async () => {
    const fetchFn = makeFetch({ ...mockTrace, traceUrl: null });
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-viewer-page')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('trace-iframe')).not.toBeInTheDocument();
  });

  it('renders iframe when traceUrl is provided', async () => {
    const fetchFn = makeFetch({ ...mockTrace, traceUrl: 'https://example.com/trace.zip' });
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-iframe')).toBeInTheDocument();
    });
  });

  // --- Additional tests for full branch coverage ---

  it('renders flaky status badge', async () => {
    const fetchFn = makeFetch({ ...mockTrace, status: 'flaky' });
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-viewer-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('trace-status')).toHaveTextContent('flaky');
  });

  it('renders running status badge', async () => {
    const fetchFn = makeFetch({ ...mockTrace, status: 'running', durationMs: null });
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-viewer-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('trace-status')).toHaveTextContent('running');
  });

  it('renders unknown/default status badge', async () => {
    const fetchFn = makeFetch({ ...mockTrace, status: 'pending' });
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-viewer-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('trace-status')).toHaveTextContent('pending');
  });

  it('shows dash for null durationMs (formatDuration null)', async () => {
    const fetchFn = makeFetch({ ...mockTrace, durationMs: null });
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-viewer-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('trace-duration')).toHaveTextContent('—');
  });

  it('shows ms for durationMs < 1000 (formatDuration ms)', async () => {
    const fetchFn = makeFetch({ ...mockTrace, durationMs: 500 });
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-viewer-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('trace-duration')).toHaveTextContent('500ms');
  });

  it('renders network tab content with requests when Network tab is clicked', async () => {
    const fetchFn = makeFetch({
      ...mockTrace,
      networkRequests: [
        { method: 'GET', url: '/api/users', status: 200 },
        { method: 'POST', url: '/api/items', status: 201 },
      ],
    });
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-viewer-page')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Network' }));
    expect(screen.getByTestId('tab-network')).toBeInTheDocument();
    expect(screen.getByText('/api/users')).toBeInTheDocument();
    expect(screen.getByText('/api/items')).toBeInTheDocument();
    expect(screen.getByText('GET')).toBeInTheDocument();
    expect(screen.getByText('POST')).toBeInTheDocument();
  });

  it('renders danger badge for network request status >= 400', async () => {
    const fetchFn = makeFetch({
      ...mockTrace,
      networkRequests: [{ method: 'GET', url: '/api/fail', status: 404 }],
    });
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-viewer-page')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Network' }));
    expect(screen.getByText('404')).toBeInTheDocument();
  });

  it('renders success badge for network request status < 400', async () => {
    const fetchFn = makeFetch({
      ...mockTrace,
      networkRequests: [{ method: 'GET', url: '/api/ok', status: 200 }],
    });
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-viewer-page')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Network' }));
    expect(screen.getByText('200')).toBeInTheDocument();
  });

  it('omits status badge when network request status is null', async () => {
    const fetchFn = makeFetch({
      ...mockTrace,
      networkRequests: [{ method: 'GET', url: '/api/nostat', status: null }],
    });
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-viewer-page')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Network' }));
    expect(screen.getByTestId('tab-network')).toBeInTheDocument();
    expect(screen.getByText('/api/nostat')).toBeInTheDocument();
  });

  it('renders empty network message when no network requests', async () => {
    const fetchFn = makeFetch({ ...mockTrace, networkRequests: [] });
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-viewer-page')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Network' }));
    expect(screen.getByText('No network requests recorded.')).toBeInTheDocument();
  });

  it('renders console tab content when Console tab is clicked', async () => {
    const fetchFn = makeFetch({
      ...mockTrace,
      consoleLogs: [
        { level: 'error', message: 'Uncaught TypeError' },
        { level: 'warn', message: 'Deprecated API' },
        { level: 'info', message: 'App started' },
      ],
    });
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-viewer-page')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Console' }));
    expect(screen.getByTestId('tab-console')).toBeInTheDocument();
    expect(screen.getByText('Uncaught TypeError')).toBeInTheDocument();
    expect(screen.getByText('Deprecated API')).toBeInTheDocument();
    expect(screen.getByText('App started')).toBeInTheDocument();
  });

  it('renders danger badge for error console log level', async () => {
    const fetchFn = makeFetch({
      ...mockTrace,
      consoleLogs: [{ level: 'error', message: 'Fatal error' }],
    });
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-viewer-page')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Console' }));
    expect(screen.getByText('error')).toBeInTheDocument();
  });

  it('renders warning badge for warn console log level', async () => {
    const fetchFn = makeFetch({
      ...mockTrace,
      consoleLogs: [{ level: 'warn', message: 'Warning message' }],
    });
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-viewer-page')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Console' }));
    expect(screen.getByText('warn')).toBeInTheDocument();
  });

  it('renders secondary badge for other console log levels', async () => {
    const fetchFn = makeFetch({
      ...mockTrace,
      consoleLogs: [{ level: 'info', message: 'Info message' }],
    });
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-viewer-page')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Console' }));
    expect(screen.getByText('info')).toBeInTheDocument();
  });

  it('renders empty console message when no console logs', async () => {
    const fetchFn = makeFetch({ ...mockTrace, consoleLogs: [] });
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-viewer-page')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Console' }));
    expect(screen.getByText('No console logs recorded.')).toBeInTheDocument();
  });

  it('returns null when data is null after loading', async () => {
    const fetchFn = makeFetch({ ...mockTrace, id: undefined as unknown as string });
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    // If trace parsing fails, error state is shown
    await waitFor(() => {
      expect(screen.queryByTestId('trace-loading')).not.toBeInTheDocument();
    });
  });

  it('renders started-at timestamp in metadata', async () => {
    const fetchFn = makeFetch(mockTrace);
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-started-at')).toBeInTheDocument();
    });
  });

  it('formats action durations in actions tab', async () => {
    const fetchFn = makeFetch({
      ...mockTrace,
      actions: [
        { type: 'click', title: 'Click button', durationMs: 120 },
        { type: 'fill', title: 'Fill field', durationMs: null },
      ],
    });
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('tab-actions')).toBeInTheDocument();
    });
    expect(screen.getByText('120ms')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders failed status badge variant (covers statusVariant case)', async () => {
    const fetchFn = makeFetch({ ...mockTrace, status: 'failed' });
    render(<TraceViewerPage traceId="trace-abc123" fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('trace-viewer-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('trace-status')).toHaveTextContent('failed');
  });

  // --- Route callback coverage ---

  it('Route getParentRoute callback returns a defined value', () => {
    const options = Route.options as unknown as { getParentRoute: () => unknown };
    expect(options.getParentRoute()).toBeDefined();
  });

  it('Route component factory renders TraceViewerPage via useParams spy', async () => {
    const routeWithSpy = Route as unknown as { useParams: () => { traceId: string } };
    vi.spyOn(routeWithSpy, 'useParams').mockReturnValue({ traceId: 'trace-abc123' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          ...mockTrace,
          id: 'trace-abc123',
        }),
      }),
    );
    const options = Route.options as unknown as { component: () => React.ReactNode };
    render(<>{options.component()}</>);
    await waitFor(() => {
      expect(screen.queryByTestId('trace-loading')).not.toBeInTheDocument();
    });
  });
});
