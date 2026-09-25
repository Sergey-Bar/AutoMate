import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Input } from './Input.js';

describe('Input', () => {
  it('renders without errors', () => {
    render(<Input data-testid="test-input" />);
    expect(screen.getByTestId('test-input')).toBeInTheDocument();
  });

  it('applies disabled state', () => {
    render(<Input disabled data-testid="test-input" />);
    const input = screen.getByTestId('test-input');
    expect(input).toBeDisabled();
    expect(input).toHaveClass('disabled:opacity-50');
  });

  it('renders with label and associates correctly', () => {
    render(<Input id="test-id" label="Test Label" />);
    const label = screen.getByText('Test Label');
    const input = screen.getByLabelText('Test Label');
    expect(label).toBeInTheDocument();
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('id', 'test-id');
  });

  it('renders error message and applies error class', () => {
    render(<Input id="error-id" error="Error message" data-testid="test-input" />);
    const input = screen.getByTestId('test-input');
    const errorMessage = screen.getByText('Error message');
    
    expect(errorMessage).toBeInTheDocument();
    expect(input).toHaveClass('border-error');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'error-id-error');
  });

  it('renders helper text when no error is present', () => {
    render(<Input id="helper-id" helperText="Helper text" data-testid="test-input" />);
    const helperText = screen.getByText('Helper text');
    const input = screen.getByTestId('test-input');
    
    expect(helperText).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-describedby', 'helper-id-helper');
  });
});
