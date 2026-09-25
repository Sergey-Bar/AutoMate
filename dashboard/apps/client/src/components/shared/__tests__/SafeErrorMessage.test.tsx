import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SafeErrorMessage } from '../SafeErrorMessage';

describe('SafeErrorMessage', () => {
  it('renders friendly message for Error objects', () => {
    render(<SafeErrorMessage error={new Error('SQLITE_ERROR: table not found')} />);
    expect(screen.getByText('A database error occurred. Please try again or contact support.')).toBeInTheDocument();
  });

  it('renders friendly message for string errors', () => {
    render(<SafeErrorMessage error="Failed to fetch" />);
    expect(screen.getByText('Unable to connect to the server. Check your network connection.')).toBeInTheDocument();
  });

  it('renders fallback for non-string/non-Error', () => {
    render(<SafeErrorMessage error={42} />);
    expect(screen.getByText('An unexpected error occurred.')).toBeInTheDocument();
  });

  it('renders custom fallback', () => {
    render(<SafeErrorMessage error={null} fallback="Custom fallback" />);
    expect(screen.getByText('Custom fallback')).toBeInTheDocument();
  });

  it('applies className', () => {
    const { container } = render(<SafeErrorMessage error="test" className="text-red-500" />);
    expect(container.firstChild).toHaveClass('text-red-500');
  });
});
