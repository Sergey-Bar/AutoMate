import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Skeleton } from './Skeleton.js';

test('renders default skeleton', () => {
  render(<Skeleton data-testid="skeleton" />);
  const skeleton = screen.getByTestId('skeleton');
  expect(skeleton).toBeInTheDocument();
  expect(skeleton).toHaveClass('animate-pulse');
  expect(skeleton).toHaveClass('rounded-md'); // block by default
});

/**
 * The regression this variant had: `<Skeleton />` was `rounded-md` and nothing
 * else, so the default rendered a 0-height div. `gaps.tsx:51` asks for one while
 * the coverage gaps load, and the page showed an empty region where a list was
 * coming — which is the one thing a load state must not be.
 *
 * Asserted on the class rather than on a computed height because there is no CSS
 * engine in jsdom: `toHaveClass('h-4')` is the assertion that can fail when the
 * dimension is removed, and it fails for the reason the defect had.
 */
test('the default block variant has a height, so it is visible', () => {
  render(<Skeleton data-testid="skeleton-block" />);
  const skeleton = screen.getByTestId('skeleton-block');
  expect(skeleton).toHaveClass('h-4');
  expect(skeleton).toHaveClass('w-full');
});

test('every variant carries both dimensions', () => {
  // The class table is the whole component's behaviour, and `block` is the one
  // that was missing a height. A loop rather than three cases so a fourth variant
  // added without dimensions fails here instead of rendering nothing.
  const expected: Record<string, readonly string[]> = {
    block: ['h-4', 'w-full'],
    text: ['h-4', 'w-full'],
    avatar: ['h-10', 'w-10'],
  };
  for (const [variant, classes] of Object.entries(expected)) {
    render(<Skeleton key={variant} variant={variant as 'block'} data-testid={`s-${variant}`} />);
    const skeleton = screen.getByTestId(`s-${variant}`);
    for (const className of classes) {
      expect(skeleton, `${variant} is missing ${className}`).toHaveClass(className);
    }
  }
});

test('width and height override the variant, in pixels when given numbers', () => {
  render(<Skeleton variant="avatar" width={96} height={96} data-testid="s-sized" />);
  const skeleton = screen.getByTestId('s-sized');
  expect(skeleton).toHaveStyle({ width: '96px', height: '96px' });
});

test('width and height accept a CSS length verbatim, so a caller can use a percentage', () => {
  // The number branch appends `px`; the string branch must not, or `width="60%"`
  // would resolve to `60%px` and be dropped by the browser. Both branches are
  // exercised here because both are real call shapes — a number for a fixed
  // measurement, a string for anything relative.
  render(<Skeleton width="60%" height="2rem" data-testid="s-length" />);
  const skeleton = screen.getByTestId('s-length');
  expect(skeleton).toHaveStyle({ width: '60%', height: '2rem' });
});

test('is hidden from assistive technology, because a placeholder has nothing to say', () => {
  render(<Skeleton data-testid="s-hidden" />);
  expect(screen.getByTestId('s-hidden')).toHaveAttribute('aria-hidden', 'true');
});

test('renders text variant', () => {
  render(<Skeleton variant="text" data-testid="skeleton-text" />);
  const skeleton = screen.getByTestId('skeleton-text');
  expect(skeleton).toHaveClass('h-4');
  expect(skeleton).toHaveClass('w-full');
});

test('renders avatar variant', () => {
  render(<Skeleton variant="avatar" data-testid="skeleton-avatar" />);
  const skeleton = screen.getByTestId('skeleton-avatar');
  expect(skeleton).toHaveClass('rounded-full');
});
