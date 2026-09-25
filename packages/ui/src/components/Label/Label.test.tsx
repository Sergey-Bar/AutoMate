import { render, screen } from '@testing-library/react';
import { Label } from './Label.js';

describe('Label', () => {
  it('renders label', () => {
    render(<Label data-testid="label">Label</Label>);
    expect(screen.getByTestId('label')).toBeInTheDocument();
  });
  it('applies custom classes', () => {
    render(<Label data-testid="label" className="custom">Label</Label>);
    expect(screen.getByTestId('label')).toHaveClass('custom');
  });
  it('forwards props', () => {
    render(<Label data-testid="label" htmlFor="input-id">Label</Label>);
    expect(screen.getByTestId('label')).toHaveAttribute('for', 'input-id');
  });
});
