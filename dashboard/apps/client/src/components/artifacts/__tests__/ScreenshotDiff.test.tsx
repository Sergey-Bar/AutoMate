/**
 * ScreenshotDiff.test.tsx — tests for the aiAnalysis and diffStage props
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '../../../test/test-utils';
import { ScreenshotDiff } from '../ScreenshotDiff';
import type { Attachment } from '../../../lib/types';

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

vi.mock('react-compare-slider', () => ({
  ReactCompareSlider: ({
    itemOne,
    itemTwo,
  }: {
    itemOne: React.ReactNode;
    itemTwo: React.ReactNode;
  }) => React.createElement('div', { 'data-testid': 'compare-slider' }, itemOne, itemTwo),
  ReactCompareSliderImage: ({ src, alt }: { src: string; alt: string }) =>
    React.createElement('img', { src, alt }),
}));

const baseAttachment: Attachment = {
  name: 'diff',
  contentType: 'image/png',
  path: 'results/home/snapshot-diff.png',
};

describe('ScreenshotDiff — AI analysis props', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without AI props (existing behavior preserved)', () => {
    render(<ScreenshotDiff attachment={baseAttachment} />);

    expect(screen.getByText('Screenshot diff')).toBeInTheDocument();
    expect(screen.getByTestId('compare-slider')).toBeInTheDocument();
    expect(screen.queryByText('Significant')).not.toBeInTheDocument();
    expect(screen.queryByText('Cosmetic')).not.toBeInTheDocument();
  });

  it('renders "Significant" badge and description when aiAnalysis.significant is true', () => {
    render(
      <ScreenshotDiff
        attachment={baseAttachment}
        diffStage="ai"
        aiAnalysis={{ significant: true, description: 'Layout shifted dramatically' }}
      />,
    );

    expect(screen.getByText('Significant')).toBeInTheDocument();
    expect(screen.getByText('Layout shifted dramatically')).toBeInTheDocument();
    expect(screen.queryByText('Cosmetic')).not.toBeInTheDocument();
  });

  it('renders "Cosmetic" badge and description when aiAnalysis.significant is false', () => {
    render(
      <ScreenshotDiff
        attachment={baseAttachment}
        diffStage="ai"
        aiAnalysis={{ significant: false, description: 'Minor color variation only' }}
      />,
    );

    expect(screen.getByText('Cosmetic')).toBeInTheDocument();
    expect(screen.getByText('Minor color variation only')).toBeInTheDocument();
    expect(screen.queryByText('Significant')).not.toBeInTheDocument();
  });

  it('renders stage pill "Stage: pixel" when diffStage is "pixel" without aiAnalysis', () => {
    render(<ScreenshotDiff attachment={baseAttachment} diffStage="pixel" />);

    expect(screen.getByText('Stage: pixel')).toBeInTheDocument();
    expect(screen.queryByText('Significant')).not.toBeInTheDocument();
    expect(screen.queryByText('Cosmetic')).not.toBeInTheDocument();
  });

  it('renders stage pill "Stage: perceptual" when diffStage is "perceptual" without aiAnalysis', () => {
    render(<ScreenshotDiff attachment={baseAttachment} diffStage="perceptual" />);

    expect(screen.getByText('Stage: perceptual')).toBeInTheDocument();
    expect(screen.queryByText('Significant')).not.toBeInTheDocument();
    expect(screen.queryByText('Cosmetic')).not.toBeInTheDocument();
  });

  it('renders "Stage: ai" pill when diffStage is "ai"', () => {
    render(
      <ScreenshotDiff
        attachment={baseAttachment}
        diffStage="ai"
        aiAnalysis={{ significant: true, description: 'Elements missing' }}
      />,
    );

    expect(screen.getByText('Stage: ai')).toBeInTheDocument();
  });

  it('does not render stage pill when diffStage is not provided', () => {
    render(<ScreenshotDiff attachment={baseAttachment} />);

    expect(screen.queryByText(/Stage:/)).not.toBeInTheDocument();
  });

  it('does not render AI analysis section when aiAnalysis is not provided', () => {
    render(<ScreenshotDiff attachment={baseAttachment} diffStage="pixel" />);

    expect(screen.queryByText('Significant')).not.toBeInTheDocument();
    expect(screen.queryByText('Cosmetic')).not.toBeInTheDocument();
  });
});
