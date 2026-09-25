import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import * as matchers from 'vitest-axe/matchers';
expect.extend(matchers);
import { render, renderWithProviders, screen, userEvent, waitFor } from '../../../test/test-utils';
import { BaselineBatchReview } from '../BaselineBatchReview';
import { BaselineCard } from '../BaselineCard';
import { ScreenshotDiff } from '../ScreenshotDiff';
import { TraceViewer } from '../TraceViewer';
import { VideoPlayer } from '../VideoPlayer';
import type { Attachment, Step } from '../../../lib/types';

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  promise: vi.fn((promise: Promise<unknown>) => promise),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) => {
        return ({ initial: _initial, animate: _animate, exit: _exit, variants: _variants, whileHover: _whileHover, whileTap: _whileTap, transition: _transition, layout: _layout, layoutId: _layoutId, ...rest }: Record<string, unknown>) => {
          const tags = ['div', 'span', 'button', 'p', 'li', 'section', 'tr', 'td', 'form', 'ul', 'nav', 'header', 'footer', 'main', 'aside', 'article', 'label', 'input', 'a', 'h1', 'h2', 'h3', 'h4'];
          const Tag = typeof prop === 'string' && tags.includes(prop) ? prop : 'div';
          return React.createElement(Tag, rest);
        };
      },
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useAnimation: () => ({ start: vi.fn(), stop: vi.fn() }),
  useMotionValue: (init: number) => ({ get: () => init, set: vi.fn(), on: vi.fn() }),
  useTransform: (_v: unknown, _input: unknown, output: number[]) => ({ get: () => output?.[0] ?? 0 }),
  useSpring: (v: unknown) => v,
}));

vi.mock('react-compare-slider', () => ({
  ReactCompareSlider: ({ itemOne, itemTwo }: { itemOne: React.ReactNode; itemTwo: React.ReactNode }) => (
    <div data-testid="compare-slider">
      {itemOne}
      {itemTwo}
    </div>
  ),
  ReactCompareSliderImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
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

describe('artifacts components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })));
  });

  describe('BaselineBatchReview', () => {
    const baselines = [
      {
        id: 'b1',
        testFile: 'tests/auth.spec.ts',
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
        testFile: 'tests/cart.spec.ts',
        snapshotName: 'cart.png',
        expectedPath: '/exp/cart.png',
        actualPath: '/act/cart.png',
        diffPath: null,
        hasActual: true,
        hasDiff: false,
        expectedSizeBytes: 2048,
      },
    ];

    it('renders current baseline content and accepts current item', async () => {
      renderWithProviders(<BaselineBatchReview baselines={baselines} onClose={vi.fn()} />);

      expect(screen.getByText('Batch Review')).toBeInTheDocument();
      expect(screen.getByText('login.png')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /^Accept$/i }));

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/baselines/b1/accept', expect.objectContaining({ method: 'POST' }));
      });
    });

    it('skips current and navigates to next baseline', async () => {
      renderWithProviders(<BaselineBatchReview baselines={baselines} onClose={vi.fn()} />);

      await userEvent.click(screen.getByRole('button', { name: /Skip/i }));
      expect(await screen.findByText('cart.png')).toBeInTheDocument();
    });
  });

  describe('BaselineCard', () => {
    it('renders diff preview and accepts changed baseline', async () => {
      const baseline = {
        id: 'b1',
        testFile: 'tests/auth.spec.ts',
        snapshotName: 'login.png',
        expectedPath: '/exp/login.png',
        actualPath: '/act/login.png',
        diffPath: '/diff/login.png',
        hasActual: true,
        hasDiff: true,
        expectedSizeBytes: 4096,
      };

      renderWithProviders(<BaselineCard baseline={baseline} />);

      expect(screen.getByAltText('Diff: login.png')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /Accept/i }));

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/baselines/b1/accept', expect.objectContaining({ method: 'POST' }));
      });
    });

    it('renders expected preview when no diff exists', () => {
      const baseline = {
        id: 'b2',
        testFile: 'tests/cart.spec.ts',
        snapshotName: 'cart.png',
        expectedPath: '/exp/cart.png',
        actualPath: null,
        diffPath: null,
        hasActual: false,
        hasDiff: false,
        expectedSizeBytes: 1024,
      };

      renderWithProviders(<BaselineCard baseline={baseline} />);
      expect(screen.getByAltText('cart.png')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Accept/i })).not.toBeInTheDocument();
    });

    it('shows Compare button only when hasActual is true', () => {
      const withActual = {
        id: 'b1',
        testFile: 'test.ts',
        snapshotName: 'snap.png',
        expectedPath: '/exp',
        actualPath: '/act',
        diffPath: null,
        hasActual: true,
        hasDiff: true,
        expectedSizeBytes: 100,
      };

      const withoutActual = { ...withActual, hasActual: false };

      const { unmount } = renderWithProviders(<BaselineCard baseline={withActual} />);
      expect(screen.getByRole('button', { name: /Compare/i })).toBeInTheDocument();
      unmount();

      renderWithProviders(<BaselineCard baseline={withoutActual} />);
      expect(screen.queryByRole('button', { name: /Compare/i })).not.toBeInTheDocument();
    });

    it('toggles compareMode and shows slider when Compare is clicked', async () => {
      const baseline = {
        id: 'b1',
        testFile: 'test.ts',
        snapshotName: 'snap.png',
        expectedPath: '/exp.png',
        actualPath: '/act.png',
        diffPath: null,
        hasActual: true,
        hasDiff: true,
        expectedSizeBytes: 100,
      };

      renderWithProviders(<BaselineCard baseline={baseline} />);

      // Default: side-by-side grid
      expect(screen.queryByRole('slider')).not.toBeInTheDocument();

      // Click compare
      const compareBtn = screen.getByRole('button', { name: /Compare/i });
      await userEvent.click(compareBtn);

      // Now in compare mode
      expect(screen.getByRole('slider', { name: /Image comparison slider/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Split/i })).toBeInTheDocument();

      // Click split (back to grid)
      await userEvent.click(screen.getByRole('button', { name: /Split/i }));
      expect(screen.queryByRole('slider')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Compare/i })).toBeInTheDocument();
    });

    it('has no accessibility violations in either mode', async () => {
      const baseline = {
        id: 'b1',
        testFile: 'test.ts',
        snapshotName: 'snap.png',
        expectedPath: '/exp.png',
        actualPath: '/act.png',
        diffPath: '/diff.png',
        hasActual: true,
        hasDiff: true,
        expectedSizeBytes: 100,
      };

      const { container } = renderWithProviders(<BaselineCard baseline={baseline} />);

      let results = await axe(container);
      expect(results).toHaveNoViolations();

      const compareBtn = screen.getByRole('button', { name: /Compare/i });
      await userEvent.click(compareBtn);

      results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  describe('ScreenshotDiff', () => {
    it('derives expected/actual/diff urls from attachment path', () => {
      const attachment: Attachment = {
        name: 'diff',
        contentType: 'image/png',
        path: 'results/auth/login-diff.png',
      };

      render(<ScreenshotDiff attachment={attachment} />);

      expect(screen.getByTestId('compare-slider')).toBeInTheDocument();
      expect(screen.getAllByRole('img', { name: 'Expected' })[0]).toHaveAttribute('src', '/artifacts/results/auth/login-expected.png');
      expect(screen.getAllByRole('img', { name: 'Actual' })[0]).toHaveAttribute('src', '/artifacts/results/auth/login-actual.png');
      expect(screen.getByRole('img', { name: 'Diff' })).toHaveAttribute('src', '/artifacts/results/auth/login-diff.png');
    });

    it('uses explicit expected and actual urls when passed', () => {
      const attachment: Attachment = {
        name: 'diff',
        contentType: 'image/png',
        path: 'x/diff.png',
      };

      render(<ScreenshotDiff attachment={attachment} expectedUrl="/custom/exp.png" actualUrl="/custom/act.png" />);

      expect(screen.getAllByRole('img', { name: 'Expected' })[0]).toHaveAttribute('src', '/custom/exp.png');
      expect(screen.getAllByRole('img', { name: 'Actual' })[0]).toHaveAttribute('src', '/custom/act.png');
    });
  });

  describe('TraceViewer', () => {
    it('renders iframe and open link with encoded trace URL', () => {
      render(<TraceViewer tracePath="runs/trace.zip" />);

      const iframe = screen.getByTitle('Playwright Trace Viewer');
      expect(iframe).toBeInTheDocument();
      expect(iframe).toHaveAttribute('src', expect.stringContaining('https://trace.playwright.dev/?trace='));
      expect(screen.getByRole('link', { name: /Open in full tab/i })).toHaveAttribute('href', expect.stringContaining('trace.playwright.dev'));
    });
  });

  describe('VideoPlayer', () => {
    const steps: Step[] = [
      { title: 'Open page', category: 'test.step', startTime: 1000, steps: [] },
      { title: 'Submit form', category: 'test.step', startTime: 3000, error: { message: 'failed' }, steps: [] },
    ];

    it('renders video source and playback controls', () => {
      render(<VideoPlayer path="videos/run.mp4" steps={steps} totalDurationMs={5000} />);

      const video = document.querySelector('video');
      expect(video).toBeInTheDocument();
      expect(video).toHaveAttribute('src', '/artifacts/videos/run.mp4');
      expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    });

    it('toggles play/pause and mute/unmute controls', async () => {
      const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
      const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});

      render(<VideoPlayer path="videos/run.mp4" steps={steps} totalDurationMs={5000} />);
      const buttons = screen.getAllByRole('button');

      await userEvent.click(buttons[0]);
      expect(playSpy).toHaveBeenCalled();

      await userEvent.click(buttons[0]);
      expect(pauseSpy).toHaveBeenCalled();

      await userEvent.click(buttons[1]);
      playSpy.mockRestore();
      pauseSpy.mockRestore();
    });
  });
});
