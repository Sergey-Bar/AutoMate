import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { EmptyState } from './EmptyState.js';

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(
      <EmptyState
        title="No items found"
        description="There are no items to display at this time."
      />
    );

    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No items found')).toBeInTheDocument();
    expect(screen.getByText('There are no items to display at this time.')).toBeInTheDocument();
  });

  it('renders optional icon and action', () => {
    render(
      <EmptyState
        title="Empty"
        description="Nothing here"
        icon={<div data-testid="test-icon">Icon</div>}
        action={<button data-testid="test-action">Action</button>}
      />
    );

    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
    expect(screen.getByTestId('test-action')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(
      <EmptyState
        title="Empty"
        description="Nothing here"
        className="custom-class"
      />
    );

    expect(screen.getByTestId('empty-state')).toHaveClass('custom-class');
  });
});
