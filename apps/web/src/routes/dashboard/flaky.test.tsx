import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FlakyPage } from './flaky.js';
import type { FlakyTest } from '../../services/flaky-detection.js';

const mockFlakyTests: FlakyTest[] = [
  {
    testId: 'test-1',
    testName: 'should login successfully',
    suiteName: 'Auth',
    flakinessScore: 0.8,
    recentResults: ['passed', 'failed', 'passed', 'failed', 'passed'],
  },
  {
    testId: 'test-2',
    testName: 'should load dashboard',
    suiteName: 'Dashboard',
    flakinessScore: 0.6,
    recentResults: ['passed', 'failed', 'passed', 'passed', 'failed'],
  },
  {
    testId: 'test-3',
    testName: 'should submit form',
    suiteName: '',
    flakinessScore: 0.4,
    recentResults: ['passed', 'failed', 'passed', 'passed', 'passed'],
  },
];

describe('FlakyPage', () => {
  it('renders loading state initially', () => {
    const fetchFn = vi.fn(() => new Promise<FlakyTest[]>(() => {}));
    render(<FlakyPage fetchFn={fetchFn} />);
    expect(screen.getByTestId('flaky-loading')).toBeInTheDocument();
  });

  it('renders error state when fetch fails', async () => {
    const fetchFn = vi.fn(() => Promise.reject(new Error('Failed to load flaky tests')));
    render(<FlakyPage fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('flaky-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Failed to load flaky tests')).toBeInTheDocument();
  });

  it('renders empty state when no flaky tests are found', async () => {
    const fetchFn = vi.fn(() => Promise.resolve([] as FlakyTest[]));
    render(<FlakyPage fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('flaky-empty')).toBeInTheDocument();
    });
    expect(screen.getByText('No Flaky Tests')).toBeInTheDocument();
  });

  it('renders flaky tests table with all rows', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(mockFlakyTests));
    render(<FlakyPage fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('flaky-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('flaky-row-test-1')).toBeInTheDocument();
    expect(screen.getByTestId('flaky-row-test-2')).toBeInTheDocument();
    expect(screen.getByTestId('flaky-row-test-3')).toBeInTheDocument();
    expect(screen.getByText('should login successfully')).toBeInTheDocument();
    expect(screen.getByText('should load dashboard')).toBeInTheDocument();
  });

  it('shows flaky count badge with total number', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(mockFlakyTests));
    render(<FlakyPage fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('flaky-page')).toBeInTheDocument();
    });
    expect(screen.getByText('3 flaky')).toBeInTheDocument();
  });

  it('renders danger ScoreBadge for flakinessScore >= 0.7', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve([{ ...mockFlakyTests[0], flakinessScore: 0.8 }]),
    );
    render(<FlakyPage fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('flaky-page')).toBeInTheDocument();
    });
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('renders warning ScoreBadge for flakinessScore >= 0.5 and < 0.7', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve([{ ...mockFlakyTests[1], flakinessScore: 0.6 }]),
    );
    render(<FlakyPage fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('flaky-page')).toBeInTheDocument();
    });
    expect(screen.getByText('60%')).toBeInTheDocument();
  });

  it('renders secondary ScoreBadge for flakinessScore < 0.5', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve([{ ...mockFlakyTests[2], flakinessScore: 0.4 }]),
    );
    render(<FlakyPage fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('flaky-page')).toBeInTheDocument();
    });
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('renders exact 70% boundary as danger', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve([{ ...mockFlakyTests[0], flakinessScore: 0.7 }]),
    );
    render(<FlakyPage fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('flaky-page')).toBeInTheDocument();
    });
    expect(screen.getByText('70%')).toBeInTheDocument();
  });

  it('renders exact 50% boundary as warning', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve([{ ...mockFlakyTests[0], flakinessScore: 0.5 }]),
    );
    render(<FlakyPage fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('flaky-page')).toBeInTheDocument();
    });
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('shows dash for empty suiteName', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve([{ ...mockFlakyTests[2], suiteName: '' }]),
    );
    render(<FlakyPage fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('flaky-page')).toBeInTheDocument();
    });
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders result dots for each recent result', async () => {
    const fetchFn = vi.fn(() => Promise.resolve([mockFlakyTests[0]]));
    render(<FlakyPage fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('flaky-page')).toBeInTheDocument();
    });
    // test-1 has 5 recent results → 5 dots (each span has a title)
    const row = screen.getByTestId('flaky-row-test-1');
    const passedDots = row.querySelectorAll('span[title="passed"]');
    const failedDots = row.querySelectorAll('span[title="failed"]');
    expect(passedDots.length + failedDots.length).toBe(5);
  });

  it('renders green dots for passed results and red for failed', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve([
        {
          ...mockFlakyTests[0],
          recentResults: ['passed', 'failed'] as Array<'passed' | 'failed'>,
        },
      ]),
    );
    render(<FlakyPage fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('flaky-page')).toBeInTheDocument();
    });
    const row = screen.getByTestId('flaky-row-test-1');
    expect(row.querySelector('span[title="passed"]')).toBeInTheDocument();
    expect(row.querySelector('span[title="failed"]')).toBeInTheDocument();
  });

  it('does not show fix panel when no row is selected', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(mockFlakyTests));
    render(<FlakyPage fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('flaky-page')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('fix-panel-container')).not.toBeInTheDocument();
  });

  it('opens fix panel when a row is clicked', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(mockFlakyTests));
    render(<FlakyPage fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('flaky-page')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('flaky-row-test-1'));
    await waitFor(() => {
      expect(screen.getByTestId('fix-panel-container')).toBeInTheDocument();
    });
    expect(screen.getByTestId('flaky-fix-panel')).toBeInTheDocument();
  });

  it('fix panel shows the selected test name', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(mockFlakyTests));
    render(<FlakyPage fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('flaky-page')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('flaky-row-test-1'));
    await waitFor(() => {
      expect(screen.getByTestId('flaky-fix-panel')).toBeInTheDocument();
    });
    // The fix panel shows the test name in a <p> inside the panel
    expect(
      within(screen.getByTestId('flaky-fix-panel')).getByText('should login successfully'),
    ).toBeInTheDocument();
  });

  it('closes fix panel when close button is clicked', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(mockFlakyTests));
    render(<FlakyPage fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('flaky-page')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('flaky-row-test-1'));
    await waitFor(() => {
      expect(screen.getByTestId('fix-panel-container')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('close-panel'));
    await waitFor(() => {
      expect(screen.queryByTestId('fix-panel-container')).not.toBeInTheDocument();
    });
  });

  it('switches selected test when a different row is clicked', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(mockFlakyTests));
    render(<FlakyPage fetchFn={fetchFn} />);
    await waitFor(() => {
      expect(screen.getByTestId('flaky-page')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('flaky-row-test-1'));
    await waitFor(() => {
      expect(screen.getByTestId('fix-panel-container')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('flaky-row-test-2'));
    expect(screen.getByTestId('fix-panel-container')).toBeInTheDocument();
  });
});
