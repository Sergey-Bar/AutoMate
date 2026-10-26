import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  HEALTH_DIMENSIONS,
  PortfolioHeatmapSchema,
  SCORECARD_IDS,
  type PortfolioHeatmap as HeatmapPayload,
} from '@automate/shared-contracts';
import { makeHealthDouble, pending, PROJECT_UUID, serverRefusal } from '../test-utils.js';
import {
  PortfolioHeatmap,
  dimensionCellText,
  letterCellTone,
  scorecardCellText,
} from './PortfolioHeatmap.js';

function heatmap(overrides: Partial<HeatmapPayload> = {}): HeatmapPayload {
  return PortfolioHeatmapSchema.parse({
    evaluatedAt: '2026-10-26T12:00:00.000Z',
    dimensions: [...HEALTH_DIMENSIONS],
    scorecards: [...SCORECARD_IDS],
    total: 1,
    limit: 50,
    truncated: false,
    projects: [
      {
        projectId: PROJECT_UUID,
        name: 'Checkout',
        slug: 'checkout',
        branch: 'main',
        score: 74,
        letter: 'C',
        lastReportAt: '2026-10-25T12:00:00.000Z',
        dimensions: HEALTH_DIMENSIONS.map((dimension) =>
          dimension === 'security'
            ? { dimension, measured: true, score: 41, letter: 'F' }
            : dimension === 'tests'
              ? { dimension, measured: true, score: 96, letter: 'A' }
              : { dimension, measured: false, score: null, letter: null },
        ),
        scorecards: SCORECARD_IDS.map((id) =>
          id === 'supply-chain'
            ? { id, status: 'fail', score: 0 }
            : id === 'delivery'
              ? { id, status: 'pass', score: 82 }
              : { id, status: 'not_configured', score: null },
        ),
      },
    ],
    ...overrides,
  });
}

describe('PortfolioHeatmap', () => {
  it('draws every dimension and scorecard as a table cell with its value in text', async () => {
    const health = makeHealthDouble('viewer', { getHeatmap: vi.fn(async () => heatmap()) });
    render(<PortfolioHeatmap health={health} />);
    const table = await screen.findByRole('table');
    // 1 repository column + 12 dimensions + 6 scorecards.
    expect(within(table).getAllByRole('columnheader')).toHaveLength(19);
    const row = screen.getByTestId('heatmap-row-checkout');
    expect(within(row).getByRole('rowheader')).toHaveTextContent('Checkout');
    expect(within(row).getByRole('link', { name: 'Checkout' })).toHaveAttribute(
      'href',
      `/dashboard/repo/${PROJECT_UUID}`,
    );
    const security = screen.getByTestId('heatmap-checkout-dim-security');
    expect(security).toHaveTextContent('F 41');
    expect(security.className).toMatch(/bg-danger\/10/u);
    expect(screen.getByTestId('heatmap-checkout-dim-tests').className).toMatch(/bg-success\/10/u);
    const coverage = screen.getByTestId('heatmap-checkout-dim-coverage');
    expect(coverage).toHaveTextContent('not measured');
    expect(coverage.className).not.toMatch(/\bbg-/u);
    expect(screen.getByTestId('heatmap-checkout-card-supply-chain')).toHaveTextContent('0 · Fail');
    expect(screen.getByTestId('heatmap-checkout-card-delivery')).toHaveTextContent('82 · Pass');
    expect(screen.getByTestId('heatmap-checkout-card-agent-quality')).toHaveTextContent(
      'Not configured',
    );
    expect(screen.queryByTestId('portfolio-heatmap-truncated')).toBeNull();
  });

  it('says when the workspace has more repositories than the grid shows', async () => {
    const health = makeHealthDouble('viewer', {
      getHeatmap: vi.fn(async () => heatmap({ total: 80, truncated: true })),
    });
    render(<PortfolioHeatmap health={health} />);
    expect(await screen.findByTestId('portfolio-heatmap-truncated')).toHaveTextContent(
      'Showing the first 1 of 80 repositories, by name.',
    );
  });

  it('shows loading, an empty workspace and a refusal without collapsing the page', async () => {
    const loading = render(
      <PortfolioHeatmap
        health={makeHealthDouble('viewer', { getHeatmap: vi.fn(() => pending<HeatmapPayload>()) })}
      />,
    );
    expect(screen.getByTestId('portfolio-heatmap-loading')).toBeInTheDocument();
    loading.unmount();
    const empty = render(
      <PortfolioHeatmap
        health={makeHealthDouble('viewer', {
          getHeatmap: vi.fn(async () => heatmap({ total: 0, projects: [] })),
        })}
      />,
    );
    expect(await screen.findByText('No repository is registered.')).toBeInTheDocument();
    empty.unmount();
    render(
      <PortfolioHeatmap
        health={makeHealthDouble('viewer', {
          getHeatmap: vi.fn(async () => {
            throw serverRefusal('This needs the viewer role', 403);
          }),
        })}
      />,
    );
    expect(await screen.findByText(/Could not read the heatmap/u)).toBeInTheDocument();
  });

  it('words and tints each cell by its verdict', () => {
    expect(letterCellTone('A+')).toMatch(/success/u);
    expect(letterCellTone('B')).toBe('bg-surface-muted text-fg');
    expect(letterCellTone('D')).toMatch(/warning/u);
    expect(letterCellTone(null)).toBe('text-fg-muted');
    expect(
      dimensionCellText({ dimension: 'security', measured: true, score: 88.6, letter: null }),
    ).toBe('— 89');
    expect(
      dimensionCellText({ dimension: 'security', measured: true, score: null, letter: null }),
    ).toBe('not measured');
    expect(scorecardCellText({ status: 'insufficient', score: null })).toBe('Too little data');
  });
});
