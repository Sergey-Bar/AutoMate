import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AccessibilityPage } from './accessibility.js';
import type { ApiClient, A11yAuditResult } from '../../lib/api.js';

const makeAuditResult = (overrides: Partial<A11yAuditResult> = {}): A11yAuditResult => ({
  violations: [],
  pagesScanned: 5,
  scannedAt: '2026-05-26T00:00:00.000Z',
  ...overrides,
});

describe('AccessibilityPage', () => {
  it('renders loading state initially', () => {
    const mockApi = {
      getA11yAudit: vi.fn(() => new Promise<A11yAuditResult>(() => {})),
    } as unknown as ApiClient;

    render(<AccessibilityPage api={mockApi} />);
    expect(screen.getByTestId('a11y-loading')).toBeInTheDocument();
  });

  it('renders error state if API fails', async () => {
    const mockApi = {
      getA11yAudit: vi.fn(() => Promise.reject(new Error('Network failure'))),
    } as unknown as ApiClient;

    render(<AccessibilityPage api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('a11y-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Error Loading Audit')).toBeInTheDocument();
    expect(screen.getByText('Network failure')).toBeInTheDocument();
  });

  it('renders no-violations message when violations array is empty', async () => {
    const mockApi = {
      getA11yAudit: vi.fn(() => Promise.resolve(makeAuditResult({ violations: [] }))),
    } as unknown as ApiClient;

    render(<AccessibilityPage api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('no-violations')).toBeInTheDocument();
    });
    expect(screen.getByText(/No violations found/)).toBeInTheDocument();
  });

  it('renders summary stats with correct values', async () => {
    const mockApi = {
      getA11yAudit: vi.fn(() =>
        Promise.resolve(
          makeAuditResult({
            violations: [
              { id: 'v1', ruleId: 'color-contrast', description: 'Contrast', severity: 'critical', element: 'p', fix: 'Fix it', page: '/' },
              { id: 'v2', ruleId: 'label', description: 'Label', severity: 'serious', element: 'input', fix: 'Add label', page: '/form' },
            ],
            pagesScanned: 4,
          })
        )
      ),
    } as unknown as ApiClient;

    render(<AccessibilityPage api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('a11y-page')).toBeInTheDocument();
    });

    expect(screen.getByTestId('stat-total-violations')).toHaveTextContent('2');
    expect(screen.getByTestId('stat-critical-count')).toHaveTextContent('1');
    expect(screen.getByTestId('stat-pages-scanned')).toHaveTextContent('4');
  });

  it('renders violations grouped by severity', async () => {
    const mockApi = {
      getA11yAudit: vi.fn(() =>
        Promise.resolve(
          makeAuditResult({
            violations: [
              { id: 'v1', ruleId: 'color-contrast', description: 'Contrast', severity: 'serious', element: 'p', fix: 'Fix it', page: '/' },
              { id: 'v2', ruleId: 'label', description: 'Label', severity: 'critical', element: 'input', fix: 'Add label', page: '/form' },
            ],
          })
        )
      ),
    } as unknown as ApiClient;

    render(<AccessibilityPage api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('severity-group-critical')).toBeInTheDocument();
    });
    expect(screen.getByTestId('severity-group-serious')).toBeInTheDocument();
    expect(screen.queryByTestId('severity-group-moderate')).not.toBeInTheDocument();
    expect(screen.queryByTestId('severity-group-minor')).not.toBeInTheDocument();
  });

  it('renders page heading', async () => {
    const mockApi = {
      getA11yAudit: vi.fn(() => Promise.resolve(makeAuditResult())),
    } as unknown as ApiClient;

    render(<AccessibilityPage api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByText('Accessibility Audit')).toBeInTheDocument();
    });
  });

  it('renders violation cards for each violation', async () => {
    const mockApi = {
      getA11yAudit: vi.fn(() =>
        Promise.resolve(
          makeAuditResult({
            violations: [
              { id: 'v1', ruleId: 'color-contrast', description: 'Contrast issue', severity: 'moderate', element: 'p', fix: 'Fix contrast', page: '/' },
              { id: 'v2', ruleId: 'image-alt', description: 'Missing alt text', severity: 'minor', element: 'img', fix: 'Add alt', page: '/about' },
            ],
          })
        )
      ),
    } as unknown as ApiClient;

    render(<AccessibilityPage api={mockApi} />);

    await waitFor(() => {
      expect(screen.getAllByTestId('a11y-violation-card')).toHaveLength(2);
    });
  });

  it('exports default export', async () => {
    const module = await import('./accessibility.js');
    expect(module.default).toBeDefined();
  });

  // --- Additional tests for full branch coverage ---

  it('renders empty state when data is null after loading', async () => {
    const mockApi = {
      getA11yAudit: vi.fn(() => Promise.resolve(null as unknown as A11yAuditResult)),
    } as unknown as ApiClient;

    render(<AccessibilityPage api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('a11y-empty')).toBeInTheDocument();
    });
    expect(screen.getByText('No Audit Data')).toBeInTheDocument();
  });

  it('retries fetch when Retry button is clicked', async () => {
    const mockApi = {
      getA11yAudit: vi.fn()
        .mockRejectedValueOnce(new Error('Network failure'))
        .mockResolvedValueOnce(makeAuditResult({ violations: [], pagesScanned: 3 })),
    } as unknown as ApiClient;

    render(<AccessibilityPage api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('a11y-error')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() => {
      expect(screen.getByTestId('a11y-page')).toBeInTheDocument();
    });
    expect(mockApi.getA11yAudit).toHaveBeenCalledTimes(2);
  });

  it('renders all four severity groups when all are present', async () => {
    const mockApi = {
      getA11yAudit: vi.fn(() =>
        Promise.resolve(
          makeAuditResult({
            violations: [
              { id: 'v1', ruleId: 'r1', description: 'D1', severity: 'critical', element: 'a', fix: 'F1', page: '/' },
              { id: 'v2', ruleId: 'r2', description: 'D2', severity: 'serious', element: 'b', fix: 'F2', page: '/' },
              { id: 'v3', ruleId: 'r3', description: 'D3', severity: 'moderate', element: 'c', fix: 'F3', page: '/' },
              { id: 'v4', ruleId: 'r4', description: 'D4', severity: 'minor', element: 'd', fix: 'F4', page: '/' },
            ],
          })
        )
      ),
    } as unknown as ApiClient;

    render(<AccessibilityPage api={mockApi} />);

    await waitFor(() => {
      expect(screen.getByTestId('severity-group-critical')).toBeInTheDocument();
    });
    expect(screen.getByTestId('severity-group-serious')).toBeInTheDocument();
    expect(screen.getByTestId('severity-group-moderate')).toBeInTheDocument();
    expect(screen.getByTestId('severity-group-minor')).toBeInTheDocument();
  });
});
