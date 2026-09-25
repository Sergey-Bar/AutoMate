import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Splitter } from './Splitter.js';

describe('Splitter', () => {
  it('renders correctly', () => {
    render(<Splitter data-testid="splitter" />);
    expect(screen.getByTestId('splitter')).toBeInTheDocument();
  });

  it('renders horizontally by default', () => {
    render(<Splitter data-testid="splitter" />);
    expect(screen.getByTestId('splitter')).toHaveClass('h-px');
  });

  it('renders vertically when specified', () => {
    render(<Splitter data-testid="splitter" orientation="vertical" />);
    expect(screen.getByTestId('splitter')).toHaveClass('w-px');
  });
});
