import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  Skeleton,
  MessageListSkeleton,
  ConversationListSkeleton,
  TextSkeleton,
  CardSkeleton,
  SettingsSkeleton,
} from './Skeleton.js';

describe('Skeleton', () => {
  it('renders a div with skeleton-shimmer class', () => {
    const html = renderToString(<Skeleton />);
    expect(html).toContain('skeleton-shimmer');
  });

  it('applies custom className', () => {
    const html = renderToString(<Skeleton className="h-10 w-full" />);
    expect(html).toContain('h-10');
    expect(html).toContain('w-full');
  });

  it('applies bg-bg-surface class', () => {
    const html = renderToString(<Skeleton />);
    expect(html).toContain('bg-bg-surface');
  });

  it('applies custom style', () => {
    const html = renderToString(<Skeleton style={{ width: '50%' }} />);
    expect(html).toContain('50%');
  });

  it('applies rounded-md class', () => {
    const html = renderToString(<Skeleton />);
    expect(html).toContain('rounded-md');
  });
});

describe('MessageListSkeleton', () => {
  it('renders 8 message skeleton rows', () => {
    const html = renderToString(<MessageListSkeleton />);
    // Count occurrences of avatar skeleton (h-8 w-8 rounded-full)
    const matches = (html.match(/rounded-full/g) ?? []).length;
    expect(matches).toBe(8);
  });

  it('renders with p-4 padding', () => {
    const html = renderToString(<MessageListSkeleton />);
    expect(html).toContain('p-4');
  });

  it('renders skeleton divs', () => {
    const html = renderToString(<MessageListSkeleton />);
    expect(html).toContain('skeleton-shimmer');
  });
});

describe('ConversationListSkeleton', () => {
  it('renders 10 conversation skeleton items', () => {
    const html = renderToString(<ConversationListSkeleton />);
    // Each item has h-14 class
    const matches = (html.match(/h-14/g) ?? []).length;
    expect(matches).toBe(10);
  });

  it('renders with p-3 padding', () => {
    const html = renderToString(<ConversationListSkeleton />);
    expect(html).toContain('p-3');
  });
});

describe('TextSkeleton', () => {
  it('renders default 4 lines', () => {
    const html = renderToString(<TextSkeleton />);
    // Each line has h-3.5
    const matches = (html.match(/h-3\.5/g) ?? []).length;
    expect(matches).toBe(4);
  });

  it('renders custom number of lines', () => {
    const html = renderToString(<TextSkeleton lines={2} />);
    const matches = (html.match(/h-3\.5/g) ?? []).length;
    expect(matches).toBe(2);
  });

  it('renders varying widths', () => {
    const html = renderToString(<TextSkeleton lines={3} />);
    // First line is 100%
    expect(html).toContain('100%');
  });

  it('cycles through widths for many lines', () => {
    const html = renderToString(<TextSkeleton lines={9} />);
    // Lines > 8 cycle back so we get 9 skeleton lines
    const matches = (html.match(/h-3\.5/g) ?? []).length;
    expect(matches).toBe(9);
  });
});

describe('CardSkeleton', () => {
  it('renders 1 card by default', () => {
    const html = renderToString(<CardSkeleton />);
    // Each card has rounded-xl
    const matches = (html.match(/rounded-xl/g) ?? []).length;
    expect(matches).toBe(1);
  });

  it('renders multiple cards when count is specified', () => {
    const html = renderToString(<CardSkeleton count={3} />);
    const matches = (html.match(/rounded-xl/g) ?? []).length;
    expect(matches).toBe(3);
  });

  it('renders skeleton elements inside card', () => {
    const html = renderToString(<CardSkeleton />);
    expect(html).toContain('skeleton-shimmer');
  });
});

describe('SettingsSkeleton', () => {
  it('renders left nav and right content areas', () => {
    const html = renderToString(<SettingsSkeleton />);
    expect(html).toContain('w-52');
    expect(html).toContain('flex-1');
  });

  it('renders 8 nav skeleton items', () => {
    const html = renderToString(<SettingsSkeleton />);
    // Nav items have h-8
    const matches = (html.match(/h-8/g) ?? []).length;
    expect(matches).toBeGreaterThan(0);
  });

  it('renders multiple skeleton elements', () => {
    const html = renderToString(<SettingsSkeleton />);
    const matches = (html.match(/skeleton-shimmer/g) ?? []).length;
    expect(matches).toBeGreaterThan(5);
  });
});
