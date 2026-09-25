/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FlakyFixPanel } from './FlakyFixPanel.js';
import type { FlakyTest } from '../../services/flaky-detection.js';

const flakyTest: FlakyTest = {
  testId: 'test-1',
  testName: 'user can click button',
  suiteName: 'Auth Suite',
  flakinessScore: 0.8,
  recentResults: ['passed', 'failed', 'passed', 'failed', 'passed', 'failed'],
};

const stableTest: FlakyTest = {
  testId: 'test-2',
  testName: 'page loads',
  suiteName: '',
  flakinessScore: 0.1,
  recentResults: ['passed', 'passed', 'passed'],
};

describe('FlakyFixPanel', () => {
  it('renders the panel with test name', () => {
    render(<FlakyFixPanel test={flakyTest} />);
    expect(screen.getByTestId('flaky-fix-panel')).toBeInTheDocument();
    expect(screen.getByText('user can click button')).toBeInTheDocument();
  });

  it('renders suggestions list for a flaky test', () => {
    render(<FlakyFixPanel test={flakyTest} />);
    expect(screen.getByTestId('suggestions-list')).toBeInTheDocument();
  });

  it('renders no-suggestions state for a stable test', () => {
    render(<FlakyFixPanel test={stableTest} />);
    expect(screen.getByTestId('no-suggestions')).toBeInTheDocument();
  });

  it('shows add-wait suggestion for high alternation rate', () => {
    render(<FlakyFixPanel test={flakyTest} />);
    expect(screen.getByTestId('suggestion-add-wait')).toBeInTheDocument();
  });

  it('shows code before and after for each suggestion', () => {
    render(<FlakyFixPanel test={flakyTest} />);
    const beforeEl = screen.getByTestId('code-before-add-wait');
    const afterEl = screen.getByTestId('code-after-add-wait');
    expect(beforeEl).toBeInTheDocument();
    expect(afterEl).toBeInTheDocument();
    expect(beforeEl.textContent).toBeTruthy();
    expect(afterEl.textContent).toBeTruthy();
  });

  it('renders Apply button for each suggestion', () => {
    render(<FlakyFixPanel test={flakyTest} />);
    const applyButtons = screen.getAllByText('Apply');
    expect(applyButtons.length).toBeGreaterThan(0);
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<FlakyFixPanel test={flakyTest} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('close-panel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not render close button when onClose is not provided', () => {
    render(<FlakyFixPanel test={flakyTest} />);
    expect(screen.queryByTestId('close-panel')).not.toBeInTheDocument();
  });
});
