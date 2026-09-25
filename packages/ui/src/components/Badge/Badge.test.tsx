import { render, screen } from '@testing-library/react';
import { Badge } from './Badge.js';

describe('Badge', () => {
  it('renders badge', () => {
    render(<Badge data-testid="badge">Badge</Badge>);
    expect(screen.getByTestId('badge')).toBeInTheDocument();
  });
  it('renders variant', () => {
    render(<Badge data-testid="badge" variant="outline">Badge</Badge>);
    expect(screen.getByTestId('badge')).toHaveClass('text-fg');
  });
  it('applies custom classes', () => {
    render(<Badge data-testid="badge" className="custom">Badge</Badge>);
    expect(screen.getByTestId('badge')).toHaveClass('custom');
  });
});
