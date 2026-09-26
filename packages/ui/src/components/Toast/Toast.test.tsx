import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Toast, ToastTitle, ToastDescription } from './Toast.js';

describe('Toast', () => {
  it('renders correctly', () => {
    render(<Toast data-testid="toast" />);
    expect(screen.getByTestId('toast')).toBeInTheDocument();
  });

  it('renders title and description', () => {
    render(
      <Toast>
        <ToastTitle>Title</ToastTitle>
        <ToastDescription>Description</ToastDescription>
      </Toast>,
    );
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
  });

  it('applies success variant', () => {
    render(<Toast data-testid="toast" variant="success" />);
    expect(screen.getByTestId('toast')).toHaveClass('border-success/50');
  });
});
