import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PerformancePage } from './performance.js';

describe('PerformancePage', () => {
  it('renders the page', () => {
    render(<PerformancePage />);
    expect(screen.getByTestId('performance-page')).toBeInTheDocument();
  });

  it('shows the page heading', () => {
    render(<PerformancePage />);
    expect(screen.getByText('Performance Audit')).toBeInTheDocument();
  });

  it('renders metric cards for LCP, FID, CLS, TTI', () => {
    render(<PerformancePage />);
    expect(screen.getByTestId('metric-card-lcp')).toBeInTheDocument();
    expect(screen.getByTestId('metric-card-fid')).toBeInTheDocument();
    expect(screen.getByTestId('metric-card-cls')).toBeInTheDocument();
    expect(screen.getByTestId('metric-card-tti')).toBeInTheDocument();
  });

  it('renders performance budget section', () => {
    render(<PerformancePage />);
    expect(screen.getByTestId('performance-budget')).toBeInTheDocument();
  });
});
