import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { EmptyState } from './EmptyState.js';

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(
      <EmptyState
        title="No items found"
        description="There are no items to display at this time."
      />,
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
      />,
    );

    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
    expect(screen.getByTestId('test-action')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<EmptyState title="Empty" description="Nothing here" className="custom-class" />);

    expect(screen.getByTestId('empty-state')).toHaveClass('custom-class');
  });
});

describe('EmptyState heading level', () => {
  // Inside a panel under an `h2` the title is an `h3`; as a screen's body under its `h1`
  // it is an `h2`, or the heading list skips a level (axe `heading-order`).
  it('is an h3 by default and an h2 when it is the page body', () => {
    const { unmount } = render(<EmptyState title="Nothing here" description="Empty." />);
    expect(screen.getByRole('heading', { level: 3, name: 'Nothing here' })).toBeInTheDocument();
    unmount();
    render(<EmptyState headingLevel={2} title="Nothing here" description="Empty." />);
    expect(screen.getByRole('heading', { level: 2, name: 'Nothing here' })).toBeInTheDocument();
  });
});
