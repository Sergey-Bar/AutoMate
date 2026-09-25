import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor, fireEvent } from '../../../test/test-utils';
import { BaselineBatchReview } from '../BaselineBatchReview';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) => {
        return ({
          initial: _i,
          animate: _a,
          exit: _e,
          variants: _v,
          whileHover: _wh,
          whileTap: _wt,
          transition: _t,
          layout: _l,
          layoutId: _lid,
          ...rest
        }: Record<string, unknown>) => {
          const tags = [
            'div', 'span', 'button', 'p', 'li', 'section', 'tr', 'td', 'form',
            'ul', 'nav', 'header', 'footer', 'main', 'aside', 'article',
            'label', 'input', 'a', 'h1', 'h2', 'h3', 'h4',
          ];
          const Tag = typeof prop === 'string' && tags.includes(prop) ? prop : 'div';
          return React.createElement(Tag, rest);
        };
      },
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  useAnimation: () => ({ start: vi.fn(), stop: vi.fn() }),
  useMotionValue: (init: number) => ({ get: () => init, set: vi.fn(), on: vi.fn() }),
  useTransform: (_v: unknown, _input: unknown, output: number[]) => ({ get: () => output?.[0] ?? 0 }),
  useSpring: (v: unknown) => v,
}));

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  promise: vi.fn((p: Promise<unknown>) => p),
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastMocks.success,
    error: toastMocks.error,
    info: vi.fn(),
    warning: vi.fn(),
    promise: toastMocks.promise,
  },
  Toaster: () => null,
}));

const baselines = [
  {
    id: 'b1',
    testFile: 'tests/login.spec.ts',
    snapshotName: 'login.png',
    expectedPath: '/exp/login.png',
    actualPath: '/act/login.png',
    diffPath: '/diff/login.png',
    hasActual: true,
    hasDiff: true,
    expectedSizeBytes: 1024,
  },
  {
    id: 'b2',
    testFile: 'tests/dashboard.spec.ts',
    snapshotName: 'dashboard.png',
    expectedPath: '/exp/dashboard.png',
    actualPath: '/act/dashboard.png',
    diffPath: null,
    hasActual: true,
    hasDiff: false,
    expectedSizeBytes: 2048,
  },
  {
    id: 'b3',
    testFile: 'tests/profile.spec.ts',
    snapshotName: 'profile.png',
    expectedPath: '/exp/profile.png',
    actualPath: null,
    diffPath: null,
    hasActual: false,
    hasDiff: false,
    expectedSizeBytes: 512,
  },
];

describe('BaselineBatchReview extra coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ));
  });

  it('renders nothing when baselines array is empty', () => {
    const { container } = renderWithProviders(
      <BaselineBatchReview baselines={[]} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows no actual screenshot placeholder when actualPath is null', () => {
    // b3 has no actualPath
    const threeBaselines = [baselines[2]];
    renderWithProviders(<BaselineBatchReview baselines={threeBaselines} onClose={vi.fn()} />);
    expect(screen.getByText('No actual screenshot')).toBeInTheDocument();
  });

  it('Escape key calls onClose', () => {
    const onClose = vi.fn();
    renderWithProviders(<BaselineBatchReview baselines={baselines} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ArrowRight key navigates to next item', () => {
    renderWithProviders(<BaselineBatchReview baselines={baselines} onClose={vi.fn()} />);
    expect(screen.getByText('login.png')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('dashboard.png')).toBeInTheDocument();
  });

  it('ArrowLeft key navigates to previous item', () => {
    renderWithProviders(<BaselineBatchReview baselines={baselines} onClose={vi.fn()} />);

    // Move forward first
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('dashboard.png')).toBeInTheDocument();

    // Go back
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('login.png')).toBeInTheDocument();
  });

  it('A key accepts the current baseline', async () => {
    renderWithProviders(<BaselineBatchReview baselines={baselines} onClose={vi.fn()} />);

    fireEvent.keyDown(window, { key: 'a' });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/baselines/b1/accept',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('R key skips the current baseline and advances', () => {
    renderWithProviders(<BaselineBatchReview baselines={baselines} onClose={vi.fn()} />);

    expect(screen.getByText('login.png')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'r' });

    expect(screen.getByText('dashboard.png')).toBeInTheDocument();
  });

  it('Prev button is disabled on first item', () => {
    renderWithProviders(<BaselineBatchReview baselines={baselines} onClose={vi.fn()} />);
    const prevBtn = screen.getByRole('button', { name: 'Previous' });
    expect(prevBtn).toBeDisabled();
  });

  it('Next button is disabled on last item', async () => {
    renderWithProviders(<BaselineBatchReview baselines={baselines} onClose={vi.fn()} />);

    // Navigate to last item (index 2)
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('close button on the header calls onClose', async () => {
    const onClose = vi.fn();
    renderWithProviders(<BaselineBatchReview baselines={baselines} onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Close batch review' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows reviewed count badge after accepting an item', async () => {
    renderWithProviders(<BaselineBatchReview baselines={baselines} onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /^Accept$/i }));

    await waitFor(() => {
      expect(screen.getByText('1 reviewed')).toBeInTheDocument();
    });
  });

  it('Accept All button appears when more than 1 undecided item remains', () => {
    renderWithProviders(<BaselineBatchReview baselines={baselines} onClose={vi.fn()} />);
    // 3 items, all undecided → remainingCount = 3 > 1 → button visible
    expect(screen.getByRole('button', { name: /Accept All/i })).toBeInTheDocument();
  });

  it('Accept All button accepts all remaining and calls onClose', async () => {
    const onClose = vi.fn();
    renderWithProviders(<BaselineBatchReview baselines={baselines} onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: /Accept All/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/baselines/b1/accept',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(fetch).toHaveBeenCalledWith(
        '/api/baselines/b2/accept',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(fetch).toHaveBeenCalledWith(
        '/api/baselines/b3/accept',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('backdrop click calls onClose', async () => {
    const onClose = vi.fn();
    const { container } = renderWithProviders(
      <BaselineBatchReview baselines={baselines} onClose={onClose} />,
    );
    // The backdrop div is the first absolute-positioned div inside the dialog
    const backdrop = container.querySelector('[class*="absolute inset-0"]') as HTMLElement;
    if (backdrop) {
      await userEvent.click(backdrop);
      expect(onClose).toHaveBeenCalled();
    }
  });
});
