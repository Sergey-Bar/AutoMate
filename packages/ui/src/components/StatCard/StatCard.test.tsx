import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { StatCard } from './StatCard.js';

test('renders stat card with title and value', () => {
  render(<StatCard title="Total Users" value="1,234" />);
  expect(screen.getByText('Total Users')).toBeInTheDocument();
  expect(screen.getByText('1,234')).toBeInTheDocument();
});

test('renders the description when provided', () => {
  render(<StatCard title="Revenue" value="$10k" trend="up" description="Since last month" />);
  expect(screen.getByText('Since last month')).toBeInTheDocument();
});

test.each([
  ['up', 'Trending up', 'text-success'],
  ['down', 'Trending down', 'text-danger'],
  ['neutral', 'No change', 'text-fg-muted'],
] as const)('names the %s trend in text, not only in colour', (trend, label, tone) => {
  render(<StatCard title="A" value="1" trend={trend} />);
  const named = screen.getByText(label);
  expect(named).toHaveClass('sr-only');
  expect(named.parentElement).toHaveClass(tone);
});

test('renders no trend when none is given', () => {
  render(<StatCard title="A" value="1" />);
  expect(screen.queryByText(/Trending|No change/)).toBeNull();
});

test('sets the value in tabular figures, so a column of cards lines up', () => {
  render(<StatCard title="A" value="98.4%" />);
  expect(screen.getByText('98.4%')).toHaveClass('tabular-nums');
});
