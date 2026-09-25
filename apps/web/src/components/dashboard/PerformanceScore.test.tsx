/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PerformanceScore } from './PerformanceScore.js';

describe('PerformanceScore', () => {
  it('renders the score value', () => {
    render(<PerformanceScore score={75} />);
    expect(screen.getByTestId('score-text')).toHaveTextContent('75');
  });

  it('shows green color for score >= 90', () => {
    render(<PerformanceScore score={95} />);
    const el = screen.getByTestId('performance-score');
    expect(el).toHaveAttribute('data-color', 'green');
  });

  it('shows yellow color for score 50-89', () => {
    render(<PerformanceScore score={70} />);
    const el = screen.getByTestId('performance-score');
    expect(el).toHaveAttribute('data-color', 'yellow');
  });

  it('shows red color for score < 50', () => {
    render(<PerformanceScore score={30} />);
    const el = screen.getByTestId('performance-score');
    expect(el).toHaveAttribute('data-color', 'red');
  });

  it('renders label when provided', () => {
    render(<PerformanceScore score={80} label="LCP" />);
    expect(screen.getByText('LCP')).toBeInTheDocument();
  });

  it('clamps score to 100 max', () => {
    render(<PerformanceScore score={150} />);
    expect(screen.getByTestId('score-text')).toHaveTextContent('100');
  });

  it('clamps negative score to 0', () => {
    render(<PerformanceScore score={-10} />);
    expect(screen.getByTestId('score-text')).toHaveTextContent('0');
  });

  it('renders SVG arc element', () => {
    render(<PerformanceScore score={60} />);
    expect(screen.getByTestId('score-arc')).toBeInTheDocument();
  });
});
