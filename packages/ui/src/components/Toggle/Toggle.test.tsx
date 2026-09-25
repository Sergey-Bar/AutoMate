import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Toggle } from './Toggle.js';

describe('Toggle', () => {
  it('renders without errors', () => {
    render(<Toggle data-testid="test-toggle" />);
    expect(screen.getByTestId('test-toggle')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('applies disabled state', () => {
    render(<Toggle disabled data-testid="test-toggle" />);
    const toggle = screen.getByTestId('test-toggle');
    expect(toggle).toBeDisabled();
  });

  it('renders with label', () => {
    render(<Toggle id="test-id" label="Test Label" />);
    const label = screen.getByText('Test Label');
    const toggle = screen.getByRole('switch');
    expect(label).toBeInTheDocument();
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('id', 'test-id');
  });

  it('applies checked state', () => {
    render(<Toggle checked readOnly data-testid="test-toggle" />);
    const toggle = screen.getByTestId('test-toggle');
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });
});
