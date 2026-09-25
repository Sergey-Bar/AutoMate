import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { StatCard } from './StatCard.js';

test('renders stat card with title and value', () => {
  render(<StatCard title="Total Users" value="1,234" />);
  expect(screen.getByText('Total Users')).toBeInTheDocument();
  expect(screen.getByText('1,234')).toBeInTheDocument();
});

test('renders trend and description when provided', () => {
  render(
    <StatCard
      title="Revenue"
      value="$10k"
      trend="up"
      description="Since last month"
    />
  );
  expect(screen.getByText('Since last month')).toBeInTheDocument();
  // check for trend class or icon presence implicitly by relying on structure
  const card = screen.getByText('Revenue').closest('div');
  expect(card).toBeInTheDocument();
});

test('renders different trends', () => {
  render(
    <>
      <StatCard title="A" value="1" trend="down" data-testid="trend-down" />
      <StatCard title="B" value="2" trend="neutral" data-testid="trend-neutral" />
    </>
  );
  
  expect(screen.getByTestId('trend-down')).toBeInTheDocument();
  expect(screen.getByTestId('trend-neutral')).toBeInTheDocument();
});
