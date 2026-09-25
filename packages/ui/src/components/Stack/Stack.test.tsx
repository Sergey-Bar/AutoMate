import { render, screen } from '@testing-library/react';
import { Stack } from './Stack.js';

describe('Stack', () => {
  it('renders stack', () => {
    render(<Stack data-testid="stack" />);
    expect(screen.getByTestId('stack')).toBeInTheDocument();
  });
  it('applies gap and direction variants', () => {
    render(<Stack data-testid="stack" direction="row" gap={6} />);
    const el = screen.getByTestId('stack');
    expect(el).toHaveClass('flex-row');
    expect(el).toHaveClass('gap-6');
  });
  it('applies custom classes', () => {
    render(<Stack data-testid="stack" className="custom" />);
    expect(screen.getByTestId('stack')).toHaveClass('custom');
  });
});
