/* eslint-disable @typescript-eslint/no-require-imports */
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      className,
      variants: _variants,
      initial: _initial,
      animate: _animate,
    }: {
      children?: React.ReactNode;
      className?: string;
      variants?: unknown;
      initial?: unknown;
      animate?: unknown;
    }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (require('react') as any).createElement('div', { className }, children),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock motion lib
vi.mock('@/lib/motion.js', () => ({
  prefersReducedMotion: vi.fn(() => false),
  reducedMotionSafe: vi.fn((v: unknown) => v),
  spring: { snappy: {}, smooth: {}, slow: {} },
  messageBubble: {},
  pageVariants: {},
}));

import { PageTransition } from './PageTransition.js';

describe('PageTransition', () => {
  it('renders children', () => {
    const html = renderToString(
      <PageTransition>
        <p>Page content</p>
      </PageTransition>,
    );
    expect(html).toContain('Page content');
  });

  it('wraps children in a div', () => {
    const html = renderToString(
      <PageTransition>
        <span>content</span>
      </PageTransition>,
    );
    expect(html).toContain('<div');
    expect(html).toContain('content');
  });

  it('accepts routeKey prop without error', () => {
    const html = renderToString(
      <PageTransition routeKey="/some/path">
        <div>content</div>
      </PageTransition>,
    );
    expect(html).toContain('content');
  });

  it('renders without routeKey (optional prop)', () => {
    const html = renderToString(
      <PageTransition>
        <div>no key</div>
      </PageTransition>,
    );
    expect(html).toContain('no key');
  });

  it('renders multiple children', () => {
    const html = renderToString(
      <PageTransition>
        <h1>Title</h1>
        <p>Description</p>
      </PageTransition>,
    );
    expect(html).toContain('Title');
    expect(html).toContain('Description');
  });
});
