import { render, screen, fireEvent, waitFor, act } from '../test/test-utils.js';
import { ModelSettingsPage } from './settings.model.js';

function mockFetchGet(data: object) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => data,
  });
}

const defaultConfig = {
  provider: 'ollama',
  model: 'llama3.1',
  endpoint: 'http://localhost:11434',
  temperature: 0.7,
  maxTokens: 4096,
};

describe('ModelSettingsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads and displays config from API', async () => {
    mockFetchGet(defaultConfig);

    render(<ModelSettingsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Model')).toHaveValue('llama3.1');
    });

    expect(screen.getByLabelText('Endpoint')).toHaveValue('http://localhost:11434');
    expect(screen.getByLabelText('Max Tokens')).toHaveValue(4096);
  });

  it('shows error message when GET /api/model-config fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    render(<ModelSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText(/HTTP 500/i)).toBeInTheDocument();
    });
  });

  it('shows error message when GET throws network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    render(<ModelSettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('updates model field via user input', async () => {
    mockFetchGet(defaultConfig);

    render(<ModelSettingsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Model')).toHaveValue('llama3.1');
    });

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'llama3.2' } });
    expect(screen.getByLabelText('Model')).toHaveValue('llama3.2');
  });

  it('updates provider via select', async () => {
    mockFetchGet(defaultConfig);

    render(<ModelSettingsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Provider')).toHaveValue('ollama');
    });

    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai' } });
    expect(screen.getByLabelText('Provider')).toHaveValue('openai');
  });

  it('shows "Saved ✓" label after successful save', async () => {
    // GET then PUT — both succeed
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => defaultConfig }) // load
      .mockResolvedValueOnce({ ok: true, json: async () => defaultConfig }); // save

    render(<ModelSettingsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Model')).toHaveValue('llama3.1');
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Saved ✓/i })).toBeInTheDocument();
    });
  });

  it('shows error when PUT /api/model-config fails', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => defaultConfig }) // load
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }); // save fails

    render(<ModelSettingsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Model')).toHaveValue('llama3.1');
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });

    await waitFor(() => {
      expect(screen.getByText(/HTTP 500/i)).toBeInTheDocument();
    });
  });

  it('save button is disabled while saving', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => defaultConfig })
      .mockReturnValueOnce(new Promise(() => {})); // save never resolves

    render(<ModelSettingsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });

    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
  });

  it('updates max tokens field', async () => {
    mockFetchGet(defaultConfig);

    render(<ModelSettingsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Max Tokens')).toHaveValue(4096);
    });

    fireEvent.change(screen.getByLabelText('Max Tokens'), { target: { value: '8192' } });
    expect(screen.getByLabelText('Max Tokens')).toHaveValue(8192);
  });
});
