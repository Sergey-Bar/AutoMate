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
