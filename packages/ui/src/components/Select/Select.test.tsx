import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Select } from './Select.js';

const mockOptions = [
  { value: '1', label: 'Option 1' },
  { value: '2', label: 'Option 2' },
];

describe('Select', () => {
  it('renders without errors', () => {
    render(<Select options={mockOptions} data-testid="test-select" />);
    expect(screen.getByTestId('test-select')).toBeInTheDocument();
    expect(screen.getByText('Option 1')).toBeInTheDocument();
  });

  it('applies disabled state', () => {
    render(<Select disabled options={mockOptions} data-testid="test-select" />);
    const select = screen.getByTestId('test-select');
    expect(select).toBeDisabled();
    expect(select).toHaveClass('disabled:opacity-50');
  });

  it('renders with label and associates correctly', () => {
    render(<Select id="test-id" label="Test Label" options={mockOptions} />);
    const label = screen.getByText('Test Label');
    const select = screen.getByLabelText('Test Label');
    expect(label).toBeInTheDocument();
    expect(select).toBeInTheDocument();
    expect(select).toHaveAttribute('id', 'test-id');
  });

  it('renders error message and applies error class', () => {
    render(<Select id="error-id" error="Error message" options={mockOptions} data-testid="test-select" />);
    const select = screen.getByTestId('test-select');
    const errorMessage = screen.getByText('Error message');

    expect(errorMessage).toBeInTheDocument();
    expect(select).toHaveClass('border-error');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAttribute('aria-describedby', 'error-id-error');
  });

  it('renders placeholder option', () => {
    render(<Select placeholder="Select an option" options={mockOptions} data-testid="test-select" />);
    const placeholder = screen.getByText('Select an option');
    expect(placeholder).toBeInTheDocument();
    expect(placeholder).toHaveAttribute('value', '');
    expect(placeholder).toBeDisabled();
  });
});
