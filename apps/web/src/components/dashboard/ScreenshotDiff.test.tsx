/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ScreenshotDiff } from './ScreenshotDiff.js';

const EXPECTED = 'http://example.com/expected.png';
const ACTUAL = 'http://example.com/actual.png';
const DIFF = 'http://example.com/diff.png';

describe('ScreenshotDiff', () => {
  it('renders in side-by-side mode by default', () => {
    render(<ScreenshotDiff expected={EXPECTED} actual={ACTUAL} />);
    expect(screen.getByTestId('view-side-by-side')).toBeInTheDocument();
    expect(screen.getByTestId('screenshot-expected')).toHaveAttribute('src', EXPECTED);
    expect(screen.getByTestId('screenshot-actual')).toHaveAttribute('src', ACTUAL);
  });

  it('switches to overlay mode when overlay button clicked', () => {
    render(<ScreenshotDiff expected={EXPECTED} actual={ACTUAL} />);
    fireEvent.click(screen.getByTestId('mode-overlay'));
    expect(screen.getByTestId('view-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('overlay-expected')).toHaveAttribute('src', EXPECTED);
    expect(screen.getByTestId('overlay-actual')).toHaveAttribute('src', ACTUAL);
  });

  it('switches to diff mode and shows diff image when provided', () => {
    render(<ScreenshotDiff expected={EXPECTED} actual={ACTUAL} diff={DIFF} />);
    fireEvent.click(screen.getByTestId('mode-diff'));
    expect(screen.getByTestId('view-diff')).toBeInTheDocument();
    expect(screen.getByTestId('screenshot-diff-image')).toHaveAttribute('src', DIFF);
  });

  it('shows unavailable message in diff mode when no diff image', () => {
    render(<ScreenshotDiff expected={EXPECTED} actual={ACTUAL} />);
    fireEvent.click(screen.getByTestId('mode-diff'));
    expect(screen.getByTestId('diff-unavailable')).toBeInTheDocument();
  });

  it('switches back to side-by-side from overlay', () => {
    render(<ScreenshotDiff expected={EXPECTED} actual={ACTUAL} />);
    fireEvent.click(screen.getByTestId('mode-overlay'));
    expect(screen.getByTestId('view-overlay')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mode-side-by-side'));
    expect(screen.getByTestId('view-side-by-side')).toBeInTheDocument();
  });
});
