import { render, screen } from '@testing-library/react';
import { Container } from './Container.js';

describe('Container', () => {
  it('renders container', () => {
    render(<Container data-testid="container" />);
    expect(screen.getByTestId('container')).toBeInTheDocument();
  });
  it('applies size variant', () => {
    render(<Container data-testid="container" size="md" />);
    expect(screen.getByTestId('container')).toHaveClass('max-w-5xl');
  });
  it('applies custom classes', () => {
    render(<Container data-testid="container" className="custom" />);
    expect(screen.getByTestId('container')).toHaveClass('custom');
  });
});
