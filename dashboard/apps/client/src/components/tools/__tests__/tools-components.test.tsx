import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../../../test/test-utils';
import { CodegenPanel } from '../CodegenPanel';

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  promise: vi.fn((promise: Promise<unknown>) => promise),
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    write: vi.fn(),
    writeln: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(),
    onResize: vi.fn(),
    loadAddon: vi.fn(),
    element: document.createElement('div'),
  })),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({ fit: vi.fn(), dispose: vi.fn() })),
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastMocks.success,
    error: toastMocks.error,
    info: toastMocks.info,
    warning: toastMocks.warning,
    promise: toastMocks.promise,
  },
  Toaster: () => null,
}));

describe('tools components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders idle state when not running and no code output', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output: '' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<CodegenPanel isRunning={false} />);

    expect(screen.getByText('Generated Code')).toBeInTheDocument();
    expect(screen.getByText('Click "Start Recording" to begin generating test code.')).toBeInTheDocument();
    expect(screen.getByText('○ Idle')).toBeInTheDocument();
  });

  it('renders recording status and fetched code output', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output: 'test("login", async () => {})\nexpect(true).toBe(true);' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<CodegenPanel isRunning />);

    expect(await screen.findByText(/test\("login", async \(\) => \{\}\)/)).toBeInTheDocument();
    expect(screen.getByText('● Recording')).toBeInTheDocument();
    expect(screen.getByText(/2 lines/)).toBeInTheDocument();
  });

  it('copies generated code to clipboard', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output: 'const a = 1;' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<CodegenPanel isRunning={false} />);

    await screen.findByText('const a = 1;');
    await userEvent.click(screen.getByRole('button', { name: /Copy/i }));

    expect(clipboard.writeText).toHaveBeenCalledWith('const a = 1;');
    expect(toastMocks.success).toHaveBeenCalledWith('Copied to clipboard');
  });

  it('saves generated code to selected path', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: 'const a = 1;' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<CodegenPanel isRunning={false} />);

    await screen.findByText('const a = 1;');
    const pathInput = screen.getByPlaceholderText('tests/my-test.spec.ts');
    await userEvent.clear(pathInput);
    await userEvent.type(pathInput, 'tests/checkout.spec.ts');
    await userEvent.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/codegen/save',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('shows error toast when save mutation fails (line 38: onError)', async () => {
    // Line 38: onError: () => toast.error('Failed to save')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: 'const a = 1;' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'disk full' }), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<CodegenPanel isRunning={false} />);

    await screen.findByText('const a = 1;');
    await userEvent.click(screen.getByRole('button', { name: /Save/i }));

    await waitFor(() => {
      expect(toastMocks.error).toHaveBeenCalledWith('Failed to save');
    });
  });
});
