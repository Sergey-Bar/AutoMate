import { render, screen } from '@testing-library/react';
import { Grid } from './Grid.js';

describe('Grid', () => {
  it('renders grid', () => {
    render(<Grid data-testid="grid" />);
    expect(screen.getByTestId('grid')).toBeInTheDocument();
  });
  it('applies cols and gap variants', () => {
    render(<Grid data-testid="grid" cols={3} gap={6} />);
    const el = screen.getByTestId('grid');
    expect(el).toHaveClass('grid-cols-3');
    expect(el).toHaveClass('gap-6');
  });
  it('applies custom classes', () => {
    render(<Grid data-testid="grid" className="custom" />);
    expect(screen.getByTestId('grid')).toHaveClass('custom');
  });
});
