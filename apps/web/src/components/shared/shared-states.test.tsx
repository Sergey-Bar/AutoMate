/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="No items found" />);
    expect(screen.getByText('No items found')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<EmptyState title="Empty" description="Nothing here yet." />);
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument();
  });

  it('does not render description when omitted', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.queryByText('Nothing here yet.')).not.toBeInTheDocument();
  });

  it('renders action button and fires onClick', () => {
    const onClick = vi.fn();
    render(<EmptyState title="Empty" action={{ label: 'Add item', onClick }} />);
    fireEvent.click(screen.getByText('Add item'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders icon when provided', () => {
    render(<EmptyState title="Empty" icon={<span data-testid="custom-icon">★</span>} />);
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('renders default title and message', () => {
    render(<ErrorState message="Network error occurred." />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Network error occurred.')).toBeInTheDocument();
  });

  it('renders custom title', () => {
    render(<ErrorState title="Load failed" message="Could not load data." />);
    expect(screen.getByText('Load failed')).toBeInTheDocument();
  });

  it('renders retry button and fires onRetry callback', () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Error" onRetry={onRetry} />);
    fireEvent.click(screen.getByTestId('retry-button'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render retry button when onRetry is not provided', () => {
    render(<ErrorState message="Error" />);
    expect(screen.queryByTestId('retry-button')).not.toBeInTheDocument();
  });

  it('renders error icon', () => {
    render(<ErrorState message="Error" />);
    expect(screen.getByTestId('error-icon')).toBeInTheDocument();
  });
});

describe('LoadingState', () => {
  it('renders loading container', () => {
    render(<LoadingState />);
    expect(screen.getByTestId('loading-state')).toBeInTheDocument();
  });

  it('renders skeleton elements', () => {
    render(<LoadingState />);
    expect(screen.getByTestId('skeleton-1')).toBeInTheDocument();
    expect(screen.getByTestId('skeleton-2')).toBeInTheDocument();
    expect(screen.getByTestId('skeleton-3')).toBeInTheDocument();
    expect(screen.getByTestId('skeleton-4')).toBeInTheDocument();
  });
});
