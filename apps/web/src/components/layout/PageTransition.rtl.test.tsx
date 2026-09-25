/**
 * PageTransition.rtl.test.tsx
 *
 * RTL tests for PageTransition component.
 * Targets line 21: `variants={prefersReducedMotion() ? undefined : pageVariants}`
 * — specifically the branch where prefersReducedMotion() returns true (variants=undefined).
 */
import { render, screen } from '../../test/test-utils.js';

const mockPrefersReducedMotion = vi.fn(() => false);

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
      React.createElement('div', { className }, children),
  },
}));

vi.mock('@/lib/motion.js', () => ({
  prefersReducedMotion: () => mockPrefersReducedMotion(),
  reducedMotionSafe: vi.fn((v: unknown) => v),
  spring: { snappy: {}, smooth: {}, slow: {} },
  messageBubble: {},
  fadeSlideUp: {},
}));

import React from 'react';
import { PageTransition } from './PageTransition.js';

describe('PageTransition RTL', () => {
  beforeEach(() => {
    mockPrefersReducedMotion.mockReturnValue(false);
  });

  it('renders children when prefersReducedMotion is false (variants applied)', () => {
    mockPrefersReducedMotion.mockReturnValue(false);

    render(
      <PageTransition>
        <p>Page content</p>
      </PageTransition>,
    );

    expect(screen.getByText('Page content')).toBeInTheDocument();
  });

  it('renders children when prefersReducedMotion is true — covers line 21 true branch (variants=undefined)', () => {
    mockPrefersReducedMotion.mockReturnValue(true);

    render(
      <PageTransition>
        <span data-testid="child">Reduced motion content</span>
      </PageTransition>,
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Reduced motion content')).toBeInTheDocument();
  });

  it('renders with routeKey prop and prefersReducedMotion=true', () => {
    mockPrefersReducedMotion.mockReturnValue(true);

    render(
      <PageTransition routeKey="/settings">
        <div data-testid="settings-page">Settings</div>
      </PageTransition>,
    );

    expect(screen.getByTestId('settings-page')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders with routeKey prop and prefersReducedMotion=false', () => {
    mockPrefersReducedMotion.mockReturnValue(false);

    render(
      <PageTransition routeKey="/chat">
        <div data-testid="chat-page">Chat content</div>
      </PageTransition>,
    );

    expect(screen.getByTestId('chat-page')).toBeInTheDocument();
  });

  it('renders multiple children with reduced motion', () => {
    mockPrefersReducedMotion.mockReturnValue(true);

    render(
      <PageTransition>
        <h1>Title</h1>
        <p>Paragraph</p>
      </PageTransition>,
    );

    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Paragraph')).toBeInTheDocument();
  });

  it('renders without crashing when routeKey is omitted', () => {
    mockPrefersReducedMotion.mockReturnValue(false);

    render(
      <PageTransition>
        <div>No key</div>
      </PageTransition>,
    );

    expect(screen.getByText('No key')).toBeInTheDocument();
  });
});
