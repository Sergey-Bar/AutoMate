import { render, screen } from '@testing-library/react';
import { Textarea } from './Textarea.js';

describe('Textarea', () => {
  it('renders textarea', () => {
    render(<Textarea data-testid="textarea" />);
    expect(screen.getByTestId('textarea')).toBeInTheDocument();
  });
  it('is disabled when disabled prop is set', () => {
    render(<Textarea disabled data-testid="textarea" />);
    expect(screen.getByTestId('textarea')).toBeDisabled();
  });
  it('applies custom classes', () => {
    render(<Textarea data-testid="textarea" className="custom" />);
    expect(screen.getByTestId('textarea')).toHaveClass('custom');
  });
});
