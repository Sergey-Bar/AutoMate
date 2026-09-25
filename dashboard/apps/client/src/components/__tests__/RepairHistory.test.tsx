import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RepairHistory } from '../RepairHistory';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock the feature store so we can control the feature gate
vi.mock('@/store/featureStore', () => ({
  useFeature: vi.fn((flag) => flag === 'agent-repair'),
  useFeatureStore: vi.fn(() => ({ loaded: true })),
}));

function renderWithProviders(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
}

describe('RepairHistory', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading skeleton', () => {
    (globalThis.fetch as any).mockImplementation(() => new Promise(() => {})); // Never resolves
    const { container } = renderWithProviders(<RepairHistory sessionId="sess-1" />);
    expect(container.querySelector('.skeleton-shimmer')).not.toBeNull();
  });

  it('renders empty state when no attempts', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    
    renderWithProviders(<RepairHistory sessionId="sess-1" />);
    
    await waitFor(() => {
      expect(screen.getByText('No repair attempts')).toBeInTheDocument();
    });
  });

  it('renders error state on fetch failure', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: false,
    });
    
    renderWithProviders(<RepairHistory sessionId="sess-1" />);
    
    await waitFor(() => {
      expect(screen.getByText('Failed to load repair history')).toBeInTheDocument();
    });
  });

  it('renders list of repair attempts', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: 'att-1',
          sessionId: 'sess-1',
          runId: 'run-1',
          attemptNumber: 1,
          status: 'payload_built',
          commentUrl: null,
          commentId: null,
          errorMessage: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'att-2',
          sessionId: 'sess-1',
          runId: 'run-2',
          attemptNumber: 2,
          status: 'comment_posted',
          commentUrl: 'https://github.com/test',
          commentId: null,
          errorMessage: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      ],
    });
    
    renderWithProviders(<RepairHistory sessionId="sess-1" />);
    
    await waitFor(() => {
      expect(screen.getByText('Attempt 1')).toBeInTheDocument();
      expect(screen.getByText('Attempt 2')).toBeInTheDocument();
      expect(screen.getByText('payload built')).toBeInTheDocument();
      expect(screen.getByText('comment posted')).toBeInTheDocument();
      expect(screen.getByText('View Comment')).toHaveAttribute('href', 'https://github.com/test');
    });
  });

  it('expands row to fetch and show detail payload', async () => {
    const user = userEvent.setup({ delay: null });
    
    // First mock for the list
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: 'att-1',
          sessionId: 'sess-1',
          runId: 'run-1',
          attemptNumber: 1,
          status: 'payload_built',
          commentUrl: null,
          commentId: null,
          errorMessage: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      ],
    });
    
    renderWithProviders(<RepairHistory sessionId="sess-1" />);
    
    await waitFor(() => {
      expect(screen.getByText('Attempt 1')).toBeInTheDocument();
    });
    
    // Second mock for the detail
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'att-1',
        sessionId: 'sess-1',
        runId: 'run-1',
        attemptNumber: 1,
        status: 'payload_built',
        commentUrl: null,
        commentId: null,
        errorMessage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        payload: '```json\n{"foo":"bar"}\n```',
      }),
    });
    
    await user.click(screen.getByText('Attempt 1'));
    
    await waitFor(() => {
      expect(screen.getByText('Repair Payload')).toBeInTheDocument();
      expect(screen.getByText(/{"foo":"bar"}/)).toBeInTheDocument();
    });
  });
});
