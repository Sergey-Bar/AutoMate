/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RunTimeline } from './RunTimeline.js';
import type { TimelineStep } from './RunTimeline.js';

describe('RunTimeline', () => {
  const steps: TimelineStep[] = [
    { name: 'Login test', startMs: 0, durationMs: 500, status: 'passed' },
    { name: 'Checkout test', startMs: 500, durationMs: 300, status: 'failed' },
    { name: 'Search test', startMs: 800, durationMs: 200, status: 'skipped' },
  ];

  it('renders empty state when no steps provided', () => {
    render(<RunTimeline steps={[]} />);
    expect(screen.getByTestId('run-timeline-empty')).toBeInTheDocument();
    expect(screen.getByText(/No timeline steps available/)).toBeInTheDocument();
  });

  it('renders timeline with steps', () => {
    render(<RunTimeline steps={steps} />);
    expect(screen.getByTestId('run-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-step-0')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-step-1')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-step-2')).toBeInTheDocument();
  });

  it('renders step names', () => {
    render(<RunTimeline steps={steps} />);
    expect(screen.getByText('Login test')).toBeInTheDocument();
    expect(screen.getByText('Checkout test')).toBeInTheDocument();
    expect(screen.getByText('Search test')).toBeInTheDocument();
  });

  it('renders status badges for each step', () => {
    render(<RunTimeline steps={steps} />);
    expect(screen.getByTestId('timeline-badge-0')).toHaveTextContent('passed');
    expect(screen.getByTestId('timeline-badge-1')).toHaveTextContent('failed');
    expect(screen.getByTestId('timeline-badge-2')).toHaveTextContent('skipped');
  });

  it('renders duration labels', () => {
    render(<RunTimeline steps={steps} />);
    expect(screen.getByTestId('timeline-duration-0')).toHaveTextContent('500ms');
    expect(screen.getByTestId('timeline-duration-1')).toHaveTextContent('300ms');
  });

  it('renders bars with correct widths proportional to total duration', () => {
    render(<RunTimeline steps={steps} />);
    const bar0 = screen.getByTestId('timeline-bar-0');
    const bar1 = screen.getByTestId('timeline-bar-1');
    // totalMs = 1000, step0 width = 500/1000 * 100 = 50%
    expect(bar0).toHaveStyle({ width: '50%' });
    // step1 width = 300/1000 * 100 = 30%
    expect(bar1).toHaveStyle({ width: '30%' });
  });

  it('renders a single step without errors', () => {
    render(<RunTimeline steps={[{ name: 'Only step', startMs: 0, durationMs: 100, status: 'running' }]} />);
    expect(screen.getByTestId('timeline-step-0')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-badge-0')).toHaveTextContent('running');
  });
});
