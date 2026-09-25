import { render, screen, waitFor, act } from '../test/test-utils.js';
import { useConversations } from './use-conversations.js';

// Helper component to surface hook state
function Harness() {
  const { conversations, loading, error, create, clearError } = useConversations();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{error ?? 'null'}</span>
      <ul data-testid="list">
        {conversations.map((c) => (
          <li key={c.id} data-testid={`conv-${c.id}`}>{c.title ?? 'untitled'}</li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => create('New Chat').catch(() => { /* error surfaced via state */ })}
        data-testid="create-btn"
      >
        Create
      </button>
      <button
        type="button"
        onClick={clearError}
        data-testid="clear-error-btn"
      >
        Clear Error
      </button>
    </div>
  );
}

describe('useConversations', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with loading=true', () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as typeof globalThis.fetch; // never resolves
    render(<Harness />);
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
  });

  it('loads conversations successfully', async () => {
    const data = [
      { id: '1', title: 'First chat', createdAt: '2024-01-01T00:00:00Z' },
      { id: '2', title: 'Second chat', createdAt: '2024-01-02T00:00:00Z' },
    ];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => data,
    }) as typeof globalThis.fetch;

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('conv-1')).toHaveTextContent('First chat');
    expect(screen.getByTestId('conv-2')).toHaveTextContent('Second chat');
    expect(screen.getByTestId('error')).toHaveTextContent('null');
  });

  it('sets error when fetch returns non-ok status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    }) as typeof globalThis.fetch;

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('error')).toHaveTextContent('Failed to fetch conversations');
    expect(screen.getByTestId('list').children).toHaveLength(0);
  });

  it('sets error on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as typeof globalThis.fetch;

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId('error')).not.toHaveTextContent('null');
    });

    expect(screen.getByTestId('error')).toHaveTextContent('Network error');
  });

  it('clearError resets error to null', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as typeof globalThis.fetch;

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId('error')).not.toHaveTextContent('null');
    });

    await act(async () => {
      screen.getByTestId('clear-error-btn').click();
    });

    expect(screen.getByTestId('error')).toHaveTextContent('null');
  });

  it('create() adds new conversation to list', async () => {
    // First call: initial load (empty list)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'new-1', title: 'New Chat', createdAt: '2024-01-03T00:00:00Z' }),
      });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    await act(async () => {
      screen.getByTestId('create-btn').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('conv-new-1')).toHaveTextContent('New Chat');
    });
  });

  it('create() sets error when POST fails', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] }) // initial load
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) }) as typeof globalThis.fetch; // create fails

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    await act(async () => {
      screen.getByTestId('create-btn').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('Failed to create conversation');
    });
  });

  it('create() calls fetch with correct POST payload', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'c1', title: 'New Chat', createdAt: '' }),
      });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    await act(async () => {
      screen.getByTestId('create-btn').click();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Chat' }),
    });
  });
});
