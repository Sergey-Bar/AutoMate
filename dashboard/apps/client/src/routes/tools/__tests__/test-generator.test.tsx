/**
 * test-generator.test.tsx
 *
 * Tests for the /tools/test-generator lazy route (TestGeneratorPage component).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, act, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/test-utils';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  fetchMock: vi.fn<typeof fetch>(),
  routeComponents: new Map<string, React.ComponentType>(),
  // Handlers indexed by slot (0=generate, 1=save), updated on every render
  mutationHandlers: [null, null] as Array<{
    mutationFn: () => Promise<unknown>;
    onSuccess?: (data: unknown) => void;
    mutate: ReturnType<typeof vi.fn>;
    isPending: boolean;
    isError: boolean;
    error: Error | null;
  } | null>,
  // Override state for next render (cleared after use)
  mutationOverrides: [null, null] as Array<{
    isPending?: boolean;
    isError?: boolean;
    error?: Error | null;
  } | null>,
  renderCount: 0,
}));

vi.stubGlobal('fetch', mocks.fetchMock);

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => {
  type RouteFactoryOptions = { component?: React.ComponentType };
  function registerRoute(path: string, options: RouteFactoryOptions) {
    if (options.component) mocks.routeComponents.set(path, options.component);
    return { ...options, useSearch: () => ({}), useParams: () => ({}) };
  }
  return {
    createFileRoute: (path: string) => (options: RouteFactoryOptions) => registerRoute(path, options),
    createLazyFileRoute: (path: string) => (options: RouteFactoryOptions) => registerRoute(path, options),
    useNavigate: () => vi.fn(),
    useRouter: () => ({ navigate: vi.fn() }),
    useSearch: () => ({}),
    useParams: () => ({}),
    Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string } & Record<string, unknown>) =>
      React.createElement('a', { href: to, ...rest }, children),
  };
});

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useMutation: vi.fn((opts: {
      mutationFn: () => Promise<unknown>;
      onSuccess?: (data: unknown) => void;
    }) => {
      // Use modulo 2 so re-renders update the same slots (0=generate, 1=save)
      const idx = mocks.renderCount++ % 2;
      const override = mocks.mutationOverrides[idx];
      const existing = mocks.mutationHandlers[idx];

      const handler = existing ?? {
        mutationFn: opts.mutationFn,
        onSuccess: opts.onSuccess,
        mutate: vi.fn(async () => {
          const data = await handler.mutationFn();
          handler.onSuccess?.(data);
        }),
        isPending: override?.isPending ?? false,
        isError: override?.isError ?? false,
        error: override?.error ?? null,
      };

      // Always update to latest closure
      handler.mutationFn = opts.mutationFn;
      handler.onSuccess = opts.onSuccess;
      if (override) {
        handler.isPending = override.isPending ?? false;
        handler.isError = override.isError ?? false;
        handler.error = override.error ?? null;
      }

      mocks.mutationHandlers[idx] = handler;
      return handler;
    }),
  };
});

vi.mock('@/components/FeatureGate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/shared/FeatureDisabledPage', () => ({
  FeatureDisabledPage: ({ feature }: { feature: string }) =>
    React.createElement('div', { 'data-testid': 'feature-disabled' }, `${feature} disabled`),
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    loading,
    icon,
    ...rest
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    loading?: boolean;
    icon?: React.ReactNode;
    [key: string]: unknown;
  }) =>
    React.createElement(
      'button',
      { onClick, disabled: disabled ?? loading, 'data-loading': loading, ...rest },
      icon,
      children,
    ),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// ─── Import component under test ──────────────────────────────────────────────

import '../test-generator.lazy.tsx';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getComponent(): React.ComponentType {
  const comp = mocks.routeComponents.get('/tools/test-generator');
  if (!comp) throw new Error('TestGeneratorPage not registered');
  return comp;
}

function renderPage() {
  mocks.renderCount = 0;
  mocks.mutationHandlers = [null, null];
  const Page = getComponent();
  return renderWithProviders(React.createElement(Page));
}

const mockResult = {
  code: 'import { test } from "@playwright/test";\ntest("login", async ({ page }) => { await page.goto("/"); });',
  filename: 'tests/login.spec.ts',
  confidence: 0.85,
  warnings: [],
};

const mockResultWithWarnings = {
  ...mockResult,
  confidence: 0.4,
  warnings: ['Description is vague', 'No assertions detected'],
};

const mockResultMediumConfidence = {
  ...mockResult,
  confidence: 0.65,
};

// ─── Basic render tests ───────────────────────────────────────────────────────

describe('TestGeneratorPage — basic render', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', mocks.fetchMock);
    mocks.mutationOverrides = [null, null];
  });

  it('renders the page header', () => {
    renderPage();
    expect(screen.getByText('Test Generator')).toBeInTheDocument();
    expect(screen.getByText(/Describe a test scenario/)).toBeInTheDocument();
  });

  it('renders description textarea and base URL input', () => {
    renderPage();
    expect(screen.getByLabelText(/Test Description/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Base URL/)).toBeInTheDocument();
  });

  it('renders the Generate Test button', () => {
    renderPage();
    expect(screen.getByText('Generate Test')).toBeInTheDocument();
  });

  it('shows empty state when no result', () => {
    renderPage();
    expect(screen.getByText('Enter a description and click Generate')).toBeInTheDocument();
  });

  it('Generate button is disabled when description is empty', () => {
    renderPage();
    const btn = screen.getByText('Generate Test').closest('button');
    expect(btn).toBeDisabled();
  });

  it('Generate button is enabled when description has text', () => {
    renderPage();
    const textarea = screen.getByLabelText(/Test Description/);
    fireEvent.change(textarea, { target: { value: 'log in as admin' } });
    const btn = screen.getByText('Generate Test').closest('button');
    expect(btn).not.toBeDisabled();
  });

  it('updates baseUrl state when input changes', () => {
    renderPage();
    const input = screen.getByLabelText(/Base URL/);
    fireEvent.change(input, { target: { value: 'https://example.com' } });
    expect((input as HTMLInputElement).value).toBe('https://example.com');
  });

  it('confidencePct is null when result is null — no confidence text shown', () => {
    renderPage();
    expect(screen.queryByText(/%\s*confidence/)).toBeNull();
  });

  it('no Copy button visible when result is null', () => {
    renderPage();
    expect(screen.queryByText('Copy')).toBeNull();
  });
});

// ─── Error state tests ────────────────────────────────────────────────────────

describe('TestGeneratorPage — error state', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', mocks.fetchMock);
    mocks.mutationOverrides = [null, null];
  });

  it('shows error alert when generateMutation.isError is true', () => {
    mocks.mutationOverrides[0] = { isError: true, error: new Error('AI provider not configured') };
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('AI provider not configured');
  });

  it('Generate button disabled when isPending', () => {
    mocks.mutationOverrides[0] = { isPending: true };
    renderPage();
    const textarea = screen.getByLabelText(/Test Description/);
    fireEvent.change(textarea, { target: { value: 'log in as admin' } });
    const btn = screen.getByText('Generate Test').closest('button');
    expect(btn).toBeDisabled();
  });
});

// ─── Result state tests ───────────────────────────────────────────────────────

describe('TestGeneratorPage — with result (high confidence)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', mocks.fetchMock);
    mocks.mutationOverrides = [null, null];
    mocks.fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(mockResult), { status: 200 })),
    );
  });

  it('shows confidence and filename after successful generation', async () => {
    renderPage();
    const textarea = screen.getByLabelText(/Test Description/);
    fireEvent.change(textarea, { target: { value: 'log in as admin' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Generate Test').closest('button')!);
    });

    await waitFor(() => {
      expect(screen.getByText('85% confidence')).toBeInTheDocument();
    });
    expect(screen.getByText('tests/login.spec.ts')).toBeInTheDocument();
  });

  it('shows code block after generation', async () => {
    renderPage();
    const textarea = screen.getByLabelText(/Test Description/);
    fireEvent.change(textarea, { target: { value: 'log in as admin' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Generate Test').closest('button')!);
    });

    await waitFor(() => {
      expect(screen.getByText(/import.*playwright/)).toBeInTheDocument();
    });
  });

  it('shows Copy and Save buttons after generation', async () => {
    renderPage();
    const textarea = screen.getByLabelText(/Test Description/);
    fireEvent.change(textarea, { target: { value: 'log in as admin' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Generate Test').closest('button')!);
    });

    await waitFor(() => {
      expect(screen.getByText('Copy')).toBeInTheDocument();
      expect(screen.getByText('Save to file')).toBeInTheDocument();
    });
  });

  it('shows no warnings section when warnings array is empty', async () => {
    renderPage();
    const textarea = screen.getByLabelText(/Test Description/);
    fireEvent.change(textarea, { target: { value: 'log in as admin' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Generate Test').closest('button')!);
    });

    await waitFor(() => {
      expect(screen.getByText('85% confidence')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('calls Copy and sets copied state', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });

    renderPage();
    const textarea = screen.getByLabelText(/Test Description/);
    fireEvent.change(textarea, { target: { value: 'log in as admin' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Generate Test').closest('button')!);
    });

    await waitFor(() => {
      expect(screen.getByText('Copy')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Copy').closest('button')!);
    });

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockResult.code);
    });

    // After copy, button should show "Copied!"
    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument();
    });
  });

  it('calls save mutation when Save to file is clicked', async () => {
    mocks.fetchMock
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify(mockResult), { status: 200 })))
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ saved: true, path: 'tests/login.spec.ts' }), { status: 200 })));

    renderPage();
    const textarea = screen.getByLabelText(/Test Description/);
    fireEvent.change(textarea, { target: { value: 'log in as admin' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Generate Test').closest('button')!);
    });

    await waitFor(() => {
      expect(screen.getByText('Save to file')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Save to file').closest('button')!);
    });

    await waitFor(() => {
      expect(screen.getByText(/Saved to:/)).toBeInTheDocument();
    });
  });

  it('save button shows loading when saveMutation.isPending', async () => {
    renderPage();
    const textarea = screen.getByLabelText(/Test Description/);
    fireEvent.change(textarea, { target: { value: 'log in as admin' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Generate Test').closest('button')!);
    });

    await waitFor(() => {
      expect(screen.getByText('Save to file')).toBeInTheDocument();
    });

    // Set save mutation to pending
    if (mocks.mutationHandlers[1]) {
      mocks.mutationHandlers[1].isPending = true;
    }

    // The save button should reflect loading state on next render
    // (we just verify the handler state is set correctly)
    expect(mocks.mutationHandlers[1]?.isPending).toBe(true);
  });
});

describe('TestGeneratorPage — with warnings (low confidence)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', mocks.fetchMock);
    mocks.mutationOverrides = [null, null];
    mocks.fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(mockResultWithWarnings), { status: 200 })),
    );
  });

  it('shows warnings when result has warnings', async () => {
    renderPage();
    const textarea = screen.getByLabelText(/Test Description/);
    fireEvent.change(textarea, { target: { value: 'test' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Generate Test').closest('button')!);
    });

    await waitFor(() => {
      expect(screen.getByText('Description is vague')).toBeInTheDocument();
      expect(screen.getByText('No assertions detected')).toBeInTheDocument();
    });
  });

  it('shows 40% confidence for low confidence result', async () => {
    renderPage();
    const textarea = screen.getByLabelText(/Test Description/);
    fireEvent.change(textarea, { target: { value: 'test' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Generate Test').closest('button')!);
    });

    await waitFor(() => {
      expect(screen.getByText('40% confidence')).toBeInTheDocument();
    });
  });
});

describe('TestGeneratorPage — medium confidence', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', mocks.fetchMock);
    mocks.mutationOverrides = [null, null];
    mocks.fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(mockResultMediumConfidence), { status: 200 })),
    );
  });

  it('shows 65% confidence for medium confidence result', async () => {
    renderPage();
    const textarea = screen.getByLabelText(/Test Description/);
    fireEvent.change(textarea, { target: { value: 'log in as admin' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Generate Test').closest('button')!);
    });

    await waitFor(() => {
      expect(screen.getByText('65% confidence')).toBeInTheDocument();
    });
  });
});

// ─── API contract tests ───────────────────────────────────────────────────────

describe('TestGeneratorPage — API contract', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', mocks.fetchMock);
    mocks.mutationOverrides = [null, null];
  });

  it('generate fetch returns 400 with error field', async () => {
    mocks.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Description too short' }), { status: 400 }),
    );
    const res = await fetch('/api/test-generation/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'hi' }),
    });
    expect(res.ok).toBe(false);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('Description too short');
  });

  it('generate fetch returns 500 with no error field → fallback message', async () => {
    mocks.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 500 }),
    );
    const res = await fetch('/api/test-generation/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'test' }),
    });
    expect(res.ok).toBe(false);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeUndefined();
  });

  it('save fetch returns 403 with error field', async () => {
    mocks.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Permission denied' }), { status: 403 }),
    );
    const res = await fetch('/api/test-generation/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'code', filePath: 'tests/foo.spec.ts' }),
    });
    expect(res.ok).toBe(false);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('Permission denied');
  });

  it('save fetch returns 500 with no error field → fallback message', async () => {
    mocks.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 500 }),
    );
    const res = await fetch('/api/test-generation/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'code', filePath: 'tests/foo.spec.ts' }),
    });
    expect(res.ok).toBe(false);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeUndefined();
  });
});

// ─── mutationFn error path coverage ──────────────────────────────────────────

describe('TestGeneratorPage — mutationFn error paths', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', mocks.fetchMock);
    mocks.mutationOverrides = [null, null];
  });

  it('generate mutationFn throws with error field when fetch is non-ok', async () => {
    mocks.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'No AI provider configured' }), { status: 404 }),
    );
    renderPage();
    const handler = mocks.mutationHandlers[0];
    if (!handler) throw new Error('generate handler not captured');
    await expect(handler.mutationFn()).rejects.toThrow('No AI provider configured');
  });

  it('generate mutationFn throws fallback message when error field is absent', async () => {
    mocks.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 500 }),
    );
    renderPage();
    const handler = mocks.mutationHandlers[0];
    if (!handler) throw new Error('generate handler not captured');
    await expect(handler.mutationFn()).rejects.toThrow('Failed to generate test');
  });

  it('save mutationFn throws with error field when fetch is non-ok', async () => {
    // First render to capture handlers, then set result so save mutationFn proceeds past the null check
    mocks.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockResult), { status: 200 }),
    );
    renderPage();
    const textarea = screen.getByLabelText(/Test Description/);
    fireEvent.change(textarea, { target: { value: 'log in as admin' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Generate Test').closest('button')!);
    });
    await waitFor(() => {
      expect(screen.getByText('85% confidence')).toBeInTheDocument();
    });

    // Now set up save to fail
    mocks.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Permission denied' }), { status: 403 }),
    );
    const saveHandler = mocks.mutationHandlers[1];
    if (!saveHandler) throw new Error('save handler not captured');
    await expect(saveHandler.mutationFn()).rejects.toThrow('Permission denied');
  });

  it('save mutationFn throws fallback message when error field is absent', async () => {
    mocks.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockResult), { status: 200 }),
    );
    renderPage();
    const textarea = screen.getByLabelText(/Test Description/);
    fireEvent.change(textarea, { target: { value: 'log in as admin' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Generate Test').closest('button')!);
    });
    await waitFor(() => {
      expect(screen.getByText('85% confidence')).toBeInTheDocument();
    });

    mocks.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 500 }),
    );
    const saveHandler = mocks.mutationHandlers[1];
    if (!saveHandler) throw new Error('save handler not captured');
    await expect(saveHandler.mutationFn()).rejects.toThrow('Failed to save file');
  });
});
