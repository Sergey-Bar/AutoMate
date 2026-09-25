import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PerformanceBudget } from './PerformanceBudget.js';
import type { PerformanceMetrics } from '../../services/performance-budget.js';

const goodMetrics: PerformanceMetrics = {
  lcp: 1000,
  fid: 50,
  cls: 0.05,
  tti: 2000,
  bundleSize: 300,
};

const badMetrics: PerformanceMetrics = {
  lcp: 5000,
  fid: 200,
  cls: 0.3,
  tti: 8000,
  bundleSize: 800,
};

describe('PerformanceBudget', () => {
  it('renders the component', () => {
    render(<PerformanceBudget metrics={goodMetrics} />);
    expect(screen.getByTestId('performance-budget')).toBeInTheDocument();
  });

  it('shows PASS for metrics within budget', () => {
    render(<PerformanceBudget metrics={goodMetrics} />);
    const lcpStatus = screen.getByTestId('budget-status-LCP');
    expect(lcpStatus).toHaveTextContent('PASS');
  });

  it('shows FAIL for metrics exceeding budget', () => {
    render(<PerformanceBudget metrics={badMetrics} />);
    const lcpStatus = screen.getByTestId('budget-status-LCP');
    expect(lcpStatus).toHaveTextContent('FAIL');
  });

  it('renders all metric results', () => {
    render(<PerformanceBudget metrics={goodMetrics} />);
    expect(screen.getByTestId('budget-result-LCP')).toBeInTheDocument();
    expect(screen.getByTestId('budget-result-FID')).toBeInTheDocument();
    expect(screen.getByTestId('budget-result-CLS')).toBeInTheDocument();
    expect(screen.getByTestId('budget-result-TTI')).toBeInTheDocument();
    expect(screen.getByTestId('budget-result-Bundle-Size')).toBeInTheDocument();
  });

  it('renders threshold inputs', () => {
    render(<PerformanceBudget metrics={goodMetrics} />);
    expect(screen.getByTestId('threshold-lcp')).toBeInTheDocument();
    expect(screen.getByTestId('threshold-fid')).toBeInTheDocument();
  });
});
