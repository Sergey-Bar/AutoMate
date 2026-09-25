/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
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

  it('renders all threshold inputs (cls, tti, bundleSize)', () => {
    render(<PerformanceBudget metrics={goodMetrics} />);
    expect(screen.getByTestId('threshold-cls')).toBeInTheDocument();
    expect(screen.getByTestId('threshold-tti')).toBeInTheDocument();
    expect(screen.getByTestId('threshold-bundleSize')).toBeInTheDocument();
  });

  it('updating LCP threshold to lower value causes PASS → FAIL', () => {
    const { getByTestId } = render(<PerformanceBudget metrics={goodMetrics} />);
    // goodMetrics.lcp = 1000; default threshold = 2500 → PASS
    expect(getByTestId('budget-status-LCP')).toHaveTextContent('PASS');
    // lower threshold below current value so it fails
    fireEvent.change(getByTestId('threshold-lcp'), { target: { value: '500' } });
    expect(getByTestId('budget-status-LCP')).toHaveTextContent('FAIL');
  });

  it('updating LCP threshold to higher value causes FAIL → PASS', () => {
    const { getByTestId } = render(<PerformanceBudget metrics={badMetrics} />);
    // badMetrics.lcp = 5000; default threshold = 2500 → FAIL
    expect(getByTestId('budget-status-LCP')).toHaveTextContent('FAIL');
    // raise threshold above current value so it passes
    fireEvent.change(getByTestId('threshold-lcp'), { target: { value: '6000' } });
    expect(getByTestId('budget-status-LCP')).toHaveTextContent('PASS');
  });

  it('ignores NaN threshold input (no state change)', () => {
    const { getByTestId } = render(<PerformanceBudget metrics={goodMetrics} />);
    const input = getByTestId('threshold-lcp') as HTMLInputElement;
    const valueBefore = input.value;
    fireEvent.change(input, { target: { value: 'not-a-number' } });
    // value in the DOM input changes but threshold state is unchanged
    expect(getByTestId('budget-status-LCP')).toHaveTextContent('PASS');
    // The displayed value is the state value, still original
    expect(input.value).toBe(valueBefore);
  });

  it('ignores zero threshold input (no state change)', () => {
    const { getByTestId } = render(<PerformanceBudget metrics={goodMetrics} />);
    fireEvent.change(getByTestId('threshold-lcp'), { target: { value: '0' } });
    // threshold not updated — LCP 1000 vs default 2500 still PASS
    expect(getByTestId('budget-status-LCP')).toHaveTextContent('PASS');
  });

  it('ignores negative threshold input (no state change)', () => {
    const { getByTestId } = render(<PerformanceBudget metrics={goodMetrics} />);
    fireEvent.change(getByTestId('threshold-lcp'), { target: { value: '-100' } });
    expect(getByTestId('budget-status-LCP')).toHaveTextContent('PASS');
  });

  it('does not render Bundle Size row when bundleSize is absent from metrics', () => {
    const metricsWithoutBundle: PerformanceMetrics = {
      lcp: 1000,
      fid: 50,
      cls: 0.05,
      tti: 2000,
      // bundleSize intentionally omitted
    };
    render(<PerformanceBudget metrics={metricsWithoutBundle} />);
    expect(screen.queryByTestId('budget-result-Bundle-Size')).toBeNull();
  });

  it('shows mixed PASS and FAIL results', () => {
    const mixedMetrics: PerformanceMetrics = {
      lcp: 1000,  // PASS
      fid: 200,   // FAIL (> 100ms)
      cls: 0.05,  // PASS
      tti: 2000,  // PASS
      bundleSize: 800, // FAIL (> 500KB)
    };
    render(<PerformanceBudget metrics={mixedMetrics} />);
    expect(screen.getByTestId('budget-status-LCP')).toHaveTextContent('PASS');
    expect(screen.getByTestId('budget-status-FID')).toHaveTextContent('FAIL');
    expect(screen.getByTestId('budget-status-TTI')).toHaveTextContent('PASS');
    expect(screen.getByTestId('budget-status-Bundle-Size')).toHaveTextContent('FAIL');
  });

  it('can update multiple thresholds independently', () => {
    const { getByTestId } = render(<PerformanceBudget metrics={goodMetrics} />);
    fireEvent.change(getByTestId('threshold-fid'), { target: { value: '30' } });
    // goodMetrics.fid = 50 which is now > 30 → FAIL
    expect(getByTestId('budget-status-FID')).toHaveTextContent('FAIL');
    // LCP still PASS (unchanged threshold)
    expect(getByTestId('budget-status-LCP')).toHaveTextContent('PASS');
  });
});
