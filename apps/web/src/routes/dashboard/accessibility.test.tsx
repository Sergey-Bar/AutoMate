import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

const mockUseA11yAudit = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/useA11yAudit.js', () => ({
  useA11yAudit: mockUseA11yAudit,
}));

vi.mock('../../components/dashboard/A11yViolationCard.js', () => ({
  A11yViolationCard: ({ violation }: { violation: { ruleId: string; description: string; severity: string } }) =>
    React.createElement('div', { 'data-testid': 'violation-card', 'data-rule': violation.ruleId }, violation.description),
}));

import { AccessibilityPage } from './accessibility.js';
import type { A11yAuditResult } from '../../hooks/useA11yAudit.js';

const makeAuditResult = (overrides: Partial<A11yAuditResult> = {}): A11yAuditResult => ({
  violations: [],
  pagesScanned: 5,
  scannedAt: '2026-05-26T00:00:00.000Z',
  ...overrides,
});

describe('AccessibilityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state', () => {
    mockUseA11yAudit.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    const html = renderToString(<AccessibilityPage />);
    expect(html).toContain('Loading audit results');
  });

  it('shows error state', () => {
    mockUseA11yAudit.mockReturnValue({ data: null, loading: false, error: 'Network error', refetch: vi.fn() });
    const html = renderToString(<AccessibilityPage />);
    expect(html).toContain('Network error');
    expect(html).toContain('Retry');
  });

  it('shows empty state when no data', () => {
    mockUseA11yAudit.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
    const html = renderToString(<AccessibilityPage />);
    expect(html).toContain('No audit data available');
  });

  it('shows no-violations message when violations array is empty', () => {
    mockUseA11yAudit.mockReturnValue({
      data: makeAuditResult({ violations: [] }),
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const html = renderToString(<AccessibilityPage />);
    expect(html).toContain('No violations found');
  });

  it('renders summary stats: total violations', () => {
    mockUseA11yAudit.mockReturnValue({
      data: makeAuditResult({
        violations: [
          { id: 'v1', ruleId: 'color-contrast', description: 'Contrast', severity: 'serious', element: 'p', fix: 'Fix it', page: '/' },
          { id: 'v2', ruleId: 'label', description: 'Label', severity: 'critical', element: 'input', fix: 'Add label', page: '/form' },
        ],
        pagesScanned: 3,
      }),
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const html = renderToString(<AccessibilityPage />);
    expect(html).toContain('Total Violations');
    expect(html).toContain('Pages Scanned');
    expect(html).toContain('Critical');
  });

  it('renders violations grouped by severity', () => {
    mockUseA11yAudit.mockReturnValue({
      data: makeAuditResult({
        violations: [
          { id: 'v1', ruleId: 'color-contrast', description: 'Contrast', severity: 'serious', element: 'p', fix: 'Fix it', page: '/' },
          { id: 'v2', ruleId: 'label', description: 'Label', severity: 'critical', element: 'input', fix: 'Add label', page: '/form' },
        ],
      }),
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const html = renderToString(<AccessibilityPage />);
    expect(html).toContain('severity-group-critical');
    expect(html).toContain('severity-group-serious');
  });

  it('does not render severity group when no violations of that severity', () => {
    mockUseA11yAudit.mockReturnValue({
      data: makeAuditResult({
        violations: [
          { id: 'v1', ruleId: 'color-contrast', description: 'Contrast', severity: 'minor', element: 'p', fix: 'Fix it', page: '/' },
        ],
      }),
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const html = renderToString(<AccessibilityPage />);
    expect(html).toContain('severity-group-minor');
    expect(html).not.toContain('severity-group-critical');
    expect(html).not.toContain('severity-group-serious');
  });

  it('renders pages scanned count', () => {
    mockUseA11yAudit.mockReturnValue({
      data: makeAuditResult({ pagesScanned: 7 }),
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const html = renderToString(<AccessibilityPage />);
    expect(html).toContain('7');
    expect(html).toContain('Pages Scanned');
  });

  it('renders page heading', () => {
    mockUseA11yAudit.mockReturnValue({
      data: makeAuditResult(),
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
    const html = renderToString(<AccessibilityPage />);
    expect(html).toContain('Accessibility Audit');
  });

  it('exports default export', async () => {
    const module = await import('./accessibility.js');
    expect(module.default).toBeDefined();
  });
});
