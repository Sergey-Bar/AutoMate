/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WebwrightIndexPage } from './index.js';
import { WebwrightRunDetail } from './$runId.js';
import type { WebwrightApi } from './index.js';
import type { WebwrightRunApi } from './$runId.js';

function jsonRes(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const neverResolve = () => new Promise<never>(() => {});

describe('WebwrightIndexPage', () => {
  it('renders loading state', () => {
    const api: WebwrightApi = {
      listRuns: vi.fn(neverResolve),
      createRun: vi.fn(neverResolve),
    };
    render(<WebwrightIndexPage api={api} />);
    expect(screen.getByTestId('runs-loading')).toBeInTheDocument();
  });

  it('renders empty state when no runs', async () => {
    const api: WebwrightApi = {
      listRuns: vi.fn(() => Promise.resolve([])),
      createRun: vi.fn(neverResolve),
    };
    render(<WebwrightIndexPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-empty')).toBeInTheDocument();
    });
  });

  it('renders runs list', async () => {
    const api: WebwrightApi = {
      listRuns: vi.fn(() => Promise.resolve([
        { id: 'r1', prompt: 'Go to google.com', status: 'completed' as const, createdAt: '2024-01-01T00:00:00Z' },
        { id: 'r2', prompt: 'Click the login button', status: 'running' as const, createdAt: '2024-01-02T00:00:00Z' },
      ])),
      createRun: vi.fn(neverResolve),
    };
    render(<WebwrightIndexPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-list')).toBeInTheDocument();
    });
    expect(screen.getByTestId('run-item-r1')).toBeInTheDocument();
    expect(screen.getByTestId('run-item-r2')).toBeInTheDocument();
    expect(screen.getByText('Go to google.com')).toBeInTheDocument();
  });

  it('renders error state', async () => {
    const api: WebwrightApi = {
      listRuns: vi.fn(() => Promise.reject(new Error('Network failure'))),
      createRun: vi.fn(neverResolve),
    };
    render(<WebwrightIndexPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('webwright-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Network failure')).toBeInTheDocument();
  });

  it('submits prompt and adds new run to list', async () => {
    const newRun = { id: 'r3', prompt: 'Navigate to example.com', status: 'pending' as const, createdAt: '2024-01-03T00:00:00Z' };
    const api: WebwrightApi = {
      listRuns: vi.fn(() => Promise.resolve([])),
      createRun: vi.fn(() => Promise.resolve(newRun)),
    };
    render(<WebwrightIndexPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-empty')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('prompt-textarea'), { target: { value: 'Navigate to example.com' } });
    fireEvent.click(screen.getByTestId('prompt-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('run-item-r3')).toBeInTheDocument();
    });
    expect(api.createRun).toHaveBeenCalledWith('Navigate to example.com');
  });

  it('renders prompt input', async () => {
    const api: WebwrightApi = {
      listRuns: vi.fn(() => Promise.resolve([])),
      createRun: vi.fn(neverResolve),
    };
    render(<WebwrightIndexPage api={api} />);
    expect(screen.getByTestId('prompt-input')).toBeInTheDocument();
  });

  it('shows error when createRun throws', async () => {
    const api: WebwrightApi = {
      listRuns: vi.fn(() => Promise.resolve([])),
      createRun: vi.fn(() => Promise.reject(new Error('Create run failed'))),
    };
    render(<WebwrightIndexPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-empty')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('prompt-textarea'), { target: { value: 'Test prompt' } });
    fireEvent.click(screen.getByTestId('prompt-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('webwright-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Create run failed')).toBeInTheDocument();
  });

  it('renders danger badge for failed run status', async () => {
    const api: WebwrightApi = {
      listRuns: vi.fn(() => Promise.resolve([
        { id: 'r-fail', prompt: 'Test failed', status: 'failed' as const, createdAt: '2024-01-01T00:00:00Z' },
      ])),
      createRun: vi.fn(neverResolve),
    };
    render(<WebwrightIndexPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-item-r-fail')).toBeInTheDocument();
    });
    expect(screen.getByTestId('run-status-r-fail')).toHaveTextContent('failed');
  });

  it('renders secondary badge for pending run status', async () => {
    const api: WebwrightApi = {
      listRuns: vi.fn(() => Promise.resolve([
        { id: 'r-pend', prompt: 'Pending test', status: 'pending' as const, createdAt: '2024-01-01T00:00:00Z' },
      ])),
      createRun: vi.fn(neverResolve),
    };
    render(<WebwrightIndexPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-item-r-pend')).toBeInTheDocument();
    });
    expect(screen.getByTestId('run-status-r-pend')).toHaveTextContent('pending');
  });
});

describe('WebwrightRunDetail', () => {
  it('renders loading state', () => {
    const api: WebwrightRunApi = {
      getRun: vi.fn(neverResolve),
    };
    render(<WebwrightRunDetail runId="r1" api={api} />);
    expect(screen.getByTestId('run-detail-loading')).toBeInTheDocument();
  });

  it('renders error state', async () => {
    const api: WebwrightRunApi = {
      getRun: vi.fn(() => Promise.reject(new Error('Run not found'))),
    };
    render(<WebwrightRunDetail runId="r1" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Run not found')).toBeInTheDocument();
  });

  it('renders run detail with steps', async () => {
    const api: WebwrightRunApi = {
      getRun: vi.fn(() => Promise.resolve({
        id: 'r1',
        prompt: 'Go to example.com and click login',
        status: 'completed' as const,
        createdAt: '2024-01-01T00:00:00Z',
        steps: [
          { type: 'navigate', description: 'Navigating to example.com', timestamp: '2024-01-01T10:00:00Z' },
          { type: 'click', description: 'Clicking login button', timestamp: '2024-01-01T10:00:05Z' },
        ],
      })),
    };
    render(<WebwrightRunDetail runId="r1" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('run-prompt')).toHaveTextContent('Go to example.com and click login');
    expect(screen.getByTestId('run-status-badge')).toHaveTextContent('completed');
    expect(screen.getByTestId('run-feed')).toBeInTheDocument();
    expect(screen.getByTestId('step-description-0')).toHaveTextContent('Navigating to example.com');
  });

  it('renders empty feed when run has no steps', async () => {
    const api: WebwrightRunApi = {
      getRun: vi.fn(() => Promise.resolve({
        id: 'r1',
        prompt: 'Do something',
        status: 'pending' as const,
        createdAt: '2024-01-01T00:00:00Z',
        steps: [],
      })),
    };
    render(<WebwrightRunDetail runId="r1" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('run-feed-empty')).toBeInTheDocument();
  });

  it('renders danger badge for failed run status', async () => {
    const api: WebwrightRunApi = {
      getRun: vi.fn(() => Promise.resolve({
        id: 'r1',
        prompt: 'Failing task',
        status: 'failed' as const,
        createdAt: '2024-01-01T00:00:00Z',
        steps: [],
      })),
    };
    render(<WebwrightRunDetail runId="r1" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('run-status-badge')).toHaveTextContent('failed');
  });

  it('renders secondary badge for running run status', async () => {
    const api: WebwrightRunApi = {
      getRun: vi.fn(() => Promise.resolve({
        id: 'r1',
        prompt: 'Running task',
        status: 'running' as const,
        createdAt: '2024-01-01T00:00:00Z',
        steps: [],
      })),
    };
    render(<WebwrightRunDetail runId="r1" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('run-status-badge')).toHaveTextContent('running');
  });

  it('returns null when run resolves to null (covers if(!run) branch)', async () => {
    const api: WebwrightRunApi = {
      getRun: vi.fn(() => Promise.resolve(null as unknown as import('./$runId.js').WebwrightRunDetail)),
    };
    render(<WebwrightRunDetail runId="r-null" api={api} />);
    expect(screen.getByTestId('run-detail-loading')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId('run-detail-loading')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('run-detail-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('run-detail-error')).not.toBeInTheDocument();
  });
});

describe('WebwrightIndexPage default api', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('listRuns uses fetch and shows error on HTTP failure', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);
    render(<WebwrightIndexPage />);
    await waitFor(() => {
      expect(screen.getByTestId('webwright-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Failed to fetch runs')).toBeInTheDocument();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith('/api/webwright/runs');
  });

  it('listRuns uses fetch and renders runs on success', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonRes([{ id: 'rx', prompt: 'Default api run', status: 'completed', createdAt: '2024-01-01T00:00:00Z' }]),
    );
    render(<WebwrightIndexPage />);
    await waitFor(() => {
      expect(screen.getByTestId('run-item-rx')).toBeInTheDocument();
    });
  });

  it('createRun uses POST and shows error on failure', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(jsonRes([]))
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);
    render(<WebwrightIndexPage />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-empty')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('prompt-textarea'), { target: { value: 'Default create' } });
    fireEvent.click(screen.getByTestId('prompt-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('webwright-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Failed to create run')).toBeInTheDocument();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenLastCalledWith(
      '/api/webwright/runs',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('createRun uses POST and adds run on success', async () => {
    const newRun = { id: 'rz', prompt: 'New default run', status: 'pending', createdAt: '2024-01-04T00:00:00Z' };
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(jsonRes([]))
      .mockResolvedValueOnce(jsonRes(newRun));
    render(<WebwrightIndexPage />);
    await waitFor(() => {
      expect(screen.getByTestId('runs-empty')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('prompt-textarea'), { target: { value: 'New default run' } });
    fireEvent.click(screen.getByTestId('prompt-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('run-item-rz')).toBeInTheDocument();
    });
  });
});

describe('WebwrightRunDetail default api', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('getRun uses fetch and throws Run not found on 404', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as Response);
    render(<WebwrightRunDetail runId="missing" />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Run not found')).toBeInTheDocument();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith('/api/webwright/runs/missing');
  });

  it('getRun uses fetch and throws generic error on non-404 failure', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);
    render(<WebwrightRunDetail runId="r1" />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Failed to fetch run')).toBeInTheDocument();
  });

  it('getRun uses fetch and renders run on success', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonRes({ id: 'r1', prompt: 'Default api detail', status: 'completed', createdAt: '2024-01-01T00:00:00Z', steps: [] }),
    );
    render(<WebwrightRunDetail runId="r1" />);
    await waitFor(() => {
      expect(screen.getByTestId('run-detail-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('run-prompt')).toHaveTextContent('Default api detail');
  });
});
