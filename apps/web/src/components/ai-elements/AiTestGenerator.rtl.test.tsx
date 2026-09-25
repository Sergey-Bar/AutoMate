import { render, screen, fireEvent, waitFor, act } from '../../test/test-utils.js';
import { AiTestGenerator } from './AiTestGenerator.js';

function mockFetchSuccess(payload: object) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => payload,
  }) as typeof globalThis.fetch;
}

function mockFetchError(status: number, payload: object = {}) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => payload,
  }) as typeof globalThis.fetch;
}

describe('AiTestGenerator — RTL', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders heading, file path input, source code textarea and generate button', () => {
    render(<AiTestGenerator />);

    expect(screen.getByText('AI Test Generator')).toBeInTheDocument();
    expect(screen.getByLabelText('File Path')).toBeInTheDocument();
    expect(screen.getByLabelText('Source Code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Tests' })).toBeInTheDocument();
  });

  it('generate button is disabled when inputs are empty', () => {
    render(<AiTestGenerator />);
    expect(screen.getByRole('button', { name: 'Generate Tests' })).toBeDisabled();
  });

  it('generate button remains disabled when only file path is filled', () => {
    render(<AiTestGenerator />);
    fireEvent.change(screen.getByLabelText('File Path'), { target: { value: 'foo.ts' } });
    expect(screen.getByRole('button', { name: 'Generate Tests' })).toBeDisabled();
  });

  it('generate button remains disabled when only source code is filled', () => {
    render(<AiTestGenerator />);
    fireEvent.change(screen.getByLabelText('Source Code'), { target: { value: 'const x = 1;' } });
    expect(screen.getByRole('button', { name: 'Generate Tests' })).toBeDisabled();
  });

  it('generate button becomes enabled when both inputs have values', () => {
    render(<AiTestGenerator />);
    fireEvent.change(screen.getByLabelText('File Path'), { target: { value: 'foo.ts' } });
    fireEvent.change(screen.getByLabelText('Source Code'), { target: { value: 'const x = 1;' } });
    expect(screen.getByRole('button', { name: 'Generate Tests' })).toBeEnabled();
  });

  it('shows loading state while fetching', async () => {
    // Never resolves during this test
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as typeof globalThis.fetch;

    render(<AiTestGenerator />);
    fireEvent.change(screen.getByLabelText('File Path'), { target: { value: 'foo.ts' } });
    fireEvent.change(screen.getByLabelText('Source Code'), { target: { value: 'const x = 1;' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate Tests' }));
    });

    expect(screen.getByRole('button', { name: 'Generating...' })).toBeDisabled();
  });

  it('displays generated result after successful fetch', async () => {
    mockFetchSuccess({
      testCode: 'it("works", () => {})',
      testFileName: 'foo.test.ts',
      functionsAnalyzed: ['foo', 'bar'],
      prompt: 'generate tests for foo',
    });

    render(<AiTestGenerator />);
    fireEvent.change(screen.getByLabelText('File Path'), { target: { value: 'foo.ts' } });
    fireEvent.change(screen.getByLabelText('Source Code'), { target: { value: 'const x = 1;' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate Tests' }));
    });

    await waitFor(() => {
      expect(screen.getByText(/foo\.test\.ts/)).toBeInTheDocument();
      expect(screen.getByText(/2 functions analyzed/)).toBeInTheDocument();
      expect(screen.getByText('it("works", () => {})')).toBeInTheDocument();
    });
  });

  it('shows Copy to Clipboard button after successful fetch', async () => {
    mockFetchSuccess({
      testCode: 'it("x", () => {})',
      testFileName: 'x.test.ts',
      functionsAnalyzed: ['x'],
      prompt: 'p',
    });

    render(<AiTestGenerator />);
    fireEvent.change(screen.getByLabelText('File Path'), { target: { value: 'x.ts' } });
    fireEvent.change(screen.getByLabelText('Source Code'), { target: { value: 'export function x(){}' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate Tests' }));
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copy to Clipboard' })).toBeInTheDocument();
    });
  });

  it('shows error alert when server returns non-ok response with error field', async () => {
    mockFetchError(500, { error: 'LLM unavailable' });

    render(<AiTestGenerator />);
    fireEvent.change(screen.getByLabelText('File Path'), { target: { value: 'foo.ts' } });
    fireEvent.change(screen.getByLabelText('Source Code'), { target: { value: 'const x = 1;' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate Tests' }));
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('LLM unavailable');
    });
  });

  it('shows error alert with fallback message when error field is absent', async () => {
    mockFetchError(503, {});

    render(<AiTestGenerator />);
    fireEvent.change(screen.getByLabelText('File Path'), { target: { value: 'foo.ts' } });
    fireEvent.change(screen.getByLabelText('Source Code'), { target: { value: 'const x = 1;' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate Tests' }));
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Request failed: 503');
    });
  });

  it('shows error alert on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as typeof globalThis.fetch;

    render(<AiTestGenerator />);
    fireEvent.change(screen.getByLabelText('File Path'), { target: { value: 'foo.ts' } });
    fireEvent.change(screen.getByLabelText('Source Code'), { target: { value: 'const x = 1;' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate Tests' }));
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network error');
    });
  });

  it('calls fetch with correct payload', async () => {
    mockFetchSuccess({
      testCode: 'it("t", () => {})',
      testFileName: 'bar.test.ts',
      functionsAnalyzed: ['bar'],
      prompt: 'p',
    });

    render(<AiTestGenerator />);
    fireEvent.change(screen.getByLabelText('File Path'), { target: { value: 'bar.ts' } });
    fireEvent.change(screen.getByLabelText('Source Code'), { target: { value: 'export function bar(){}' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate Tests' }));
    });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/ai/generate-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceCode: 'export function bar(){}', filePath: 'bar.ts' }),
      });
    });
  });
});
