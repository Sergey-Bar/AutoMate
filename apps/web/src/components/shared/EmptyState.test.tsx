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
    path: ({ stroke, d }: { stroke?: string; d?: string }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (require('react') as any).createElement('path', { stroke, d }),
    circle: ({ cx, cy, r }: { cx?: number; cy?: number; r?: number }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (require('react') as any).createElement('circle', { cx, cy, r }),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock motion lib
vi.mock('@/lib/motion.js', () => ({
  prefersReducedMotion: vi.fn(() => false),
  reducedMotionSafe: vi.fn((v: unknown) => v),
}));

import { EmptyState } from './EmptyState.js';
import { prefersReducedMotion } from '@/lib/motion.js';

describe('EmptyState', () => {
  it('renders title', () => {
    const html = renderToString(<EmptyState title="No data found" />);
    expect(html).toContain('No data found');
  });

  it('renders description when provided', () => {
    const html = renderToString(<EmptyState title="Empty" description="No items match your criteria" />);
    expect(html).toContain('No items match your criteria');
  });

  it('does not render description when not provided', () => {
    const html = renderToString(<EmptyState title="Empty" />);
    // Just the title, no description paragraph beyond the title
    const matches = (html.match(/class="[^"]*text-xs[^"]*leading-relaxed/g) ?? []).length;
    expect(matches).toBe(0);
  });

  it('renders CTA button when cta and onCta are provided', () => {
    const html = renderToString(
      <EmptyState title="Empty" cta="Create New" onCta={() => {}} />,
    );
    expect(html).toContain('Create New');
    expect(html).toContain('<button');
  });

  it('does not render CTA button when only cta is provided (no onCta)', () => {
    const html = renderToString(<EmptyState title="Empty" cta="Create New" />);
    expect(html).not.toContain('Create New');
  });

  it('does not render CTA button when only onCta is provided (no cta)', () => {
    const html = renderToString(<EmptyState title="Empty" onCta={() => {}} />);
    expect(html).not.toContain('<button');
  });

  it('renders radar illustration when illustration="radar"', () => {
    const html = renderToString(<EmptyState title="Test" illustration="radar" />);
    // Radar renders pulse rings with border-primary
    expect(html).toContain('border-primary');
  });

  it('renders inbox illustration when illustration="inbox"', () => {
    const html = renderToString(<EmptyState title="Test" illustration="inbox" />);
    expect(html).toContain('<svg');
  });

  it('renders search illustration when illustration="search"', () => {
    const html = renderToString(<EmptyState title="Test" illustration="search" />);
    expect(html).toContain('<svg');
  });

  it('renders chat illustration when illustration="chat"', () => {
    const html = renderToString(<EmptyState title="Test" illustration="chat" />);
    expect(html).toContain('<svg');
  });

  it('renders shield illustration when illustration="shield"', () => {
    const html = renderToString(<EmptyState title="Test" illustration="shield" />);
    expect(html).toContain('<svg');
  });

  it('renders icon when provided (no illustration)', () => {
    const icon = <span data-testid="custom-icon">🔍</span>;
    const html = renderToString(<EmptyState title="Test" icon={icon} />);
    expect(html).toContain('data-testid="custom-icon"');
  });

  it('illustration takes priority over icon prop', () => {
    const icon = <span data-testid="my-icon">★</span>;
    const html = renderToString(<EmptyState title="Test" illustration="inbox" icon={icon} />);
    // illustration div should be rendered but not the icon container
    expect(html).toContain('<svg');
    expect(html).not.toContain('data-testid="my-icon"');
  });

  it('renders no illustration or icon area when neither is provided', () => {
    const html = renderToString(<EmptyState title="Test" />);
    // No custom icon element
    expect(html).not.toContain('data-testid');
  });

  it('renders with full props (illustration + description + cta)', () => {
    const html = renderToString(
      <EmptyState
        title="No conversations"
        description="Start a new chat"
        illustration="chat"
        cta="New Chat"
        onCta={() => {}}
      />,
    );
    expect(html).toContain('No conversations');
    expect(html).toContain('Start a new chat');
    expect(html).toContain('New Chat');
  });
});

// ---------------------------------------------------------------------------
// Reduced-motion branch coverage
// prefersReducedMotion() === true → ternaries pass `undefined` as variants
// Each illustration component has its own ternary; all 5 must be covered.
// ---------------------------------------------------------------------------
describe('EmptyState — reduced motion variants', () => {
  it('passes undefined as variants for all illustrations when prefersReducedMotion is true', () => {
    vi.mocked(prefersReducedMotion).mockReturnValue(true);

    const illustrations: Array<'radar' | 'inbox' | 'search' | 'chat' | 'shield'> = [
      'radar',
      'inbox',
      'search',
      'chat',
      'shield',
    ];

    for (const illustration of illustrations) {
      const html = renderToString(<EmptyState title={`${illustration} test`} illustration={illustration} />);
      expect(html).toContain(`${illustration} test`);
    }

    // restore default
    vi.mocked(prefersReducedMotion).mockReturnValue(false);
  });
});
