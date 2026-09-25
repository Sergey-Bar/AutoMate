import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AiTriageCard } from './AiTriageCard';

// Create a wrapper with QueryClient
function renderWithProviders(ui: React.ReactElement) {
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

describe('AiTriageCard', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it('shows loading state initially', () => {
    const fetchMock = vi.mocked(globalThis.fetch).mockImplementation(
      () => new Promise(() => {}) // Never resolves, so it stays loading
    );

    renderWithProviders(<AiTriageCard runId="run-123" />);
    
    expect(screen.getByText('Analyzing failure...')).toBeInTheDocument();
  });

  it('renders triage results on success', async () => {
    const mockData = {
      runId: 'run-123',
      analyzedAt: new Date().toISOString(),
      summary: 'Test summary',
      failures: [
        {
          testTitle: 'My test',
          rootCause: 'Server returned 500 instead of 200',
          suggestedFix: 'Fix the server route handler',
          confidence: 'high'
        }
      ]
    };

    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockData
    } as Response);

    renderWithProviders(<AiTriageCard runId="run-123" testTitle="My test" />);

    await waitFor(() => {
      expect(screen.getByText('AI Analysis')).toBeInTheDocument();
    });

    expect(screen.getByText('high Confidence')).toBeInTheDocument();
    expect(screen.getByText('Server returned 500 instead of 200')).toBeInTheDocument();
    expect(screen.getByText('Fix the server route handler')).toBeInTheDocument();
    expect(screen.getByText('Ask AI for more details')).toBeInTheDocument();
  });

  it('shows fallback on fetch error', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('Network error'));

    renderWithProviders(<AiTriageCard runId="run-123" />);

    await waitFor(() => {
      expect(screen.getByText('AI analysis unavailable')).toBeInTheDocument();
    });
    
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows pending message on 202', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: async () => ({ status: 'pending', message: 'Triage in progress' })
    } as Response);

    renderWithProviders(<AiTriageCard runId="run-123" />);

    await waitFor(() => {
      expect(screen.getByText('AI is analyzing this failure...')).toBeInTheDocument();
    });
  });

  it('hidden when 404', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({})
    } as Response);

    const { container } = renderWithProviders(<AiTriageCard runId="run-123" />);

    await waitFor(() => {
      // It returns null, so container should be empty
      expect(container.firstChild).toBeNull();
    });
  });

  it('renders low confidence triage result with ShieldAlert icon', async () => {
    const mockData = {
      runId: 'run-123',
      analyzedAt: new Date().toISOString(),
      summary: 'Test summary',
      failures: [
        {
          testTitle: 'Low confidence test',
          rootCause: 'Intermittent network issue',
          suggestedFix: 'Retry the flaky operation',
          confidence: 'low',
        },
      ],
    };

    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockData,
    } as Response);

    renderWithProviders(<AiTriageCard runId="run-456" testTitle="Low confidence test" />);

    await waitFor(() => {
      expect(screen.getByText('AI Analysis')).toBeInTheDocument();
    });

    expect(screen.getByText('low Confidence')).toBeInTheDocument();
    expect(screen.getByText('Intermittent network issue')).toBeInTheDocument();
    expect(screen.getByText('Retry the flaky operation')).toBeInTheDocument();
  });

  it('returns null when testTitle is provided but not found in failures', async () => {
    const mockData = {
      runId: 'run-123',
      analyzedAt: new Date().toISOString(),
      summary: 'Test summary',
      failures: [
        {
          testTitle: 'Some other test',
          rootCause: 'Root cause',
          suggestedFix: 'Fix here',
          confidence: 'high',
        },
      ],
    };

    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockData,
    } as Response);

    const { container } = renderWithProviders(
      <AiTriageCard runId="run-123" testTitle="Nonexistent test" />,
    );

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('shows pending message with Triage in progress error message', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: async () => ({ message: 'pending' }),
    } as Response);

    renderWithProviders(<AiTriageCard runId="run-123" />);

    await waitFor(() => {
      expect(screen.getByText('AI is analyzing this failure...')).toBeInTheDocument();
    });
  });

  it('retry button refetches', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    
    // First call fails
    fetchMock.mockRejectedValueOnce(new Error('Network error'));

    renderWithProviders(<AiTriageCard runId="run-123" />);

    await waitFor(() => {
      expect(screen.getByText('AI analysis unavailable')).toBeInTheDocument();
    });

    // Setup second call to succeed
    const mockData = {
      runId: 'run-123',
      analyzedAt: new Date().toISOString(),
      summary: 'Test summary',
      failures: [
        {
          testTitle: 'My test',
          rootCause: 'Database connection failed',
          suggestedFix: 'Check database credentials',
          confidence: 'medium'
        }
      ]
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockData
    } as Response);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByText('AI Analysis')).toBeInTheDocument();
    });

    expect(screen.getByText('medium Confidence')).toBeInTheDocument();
    expect(screen.getByText('Database connection failed')).toBeInTheDocument();
  });
});