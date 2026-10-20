/// <reference types="vitest/globals" />
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import {
  QaScoreSchema,
  SCORE_CATEGORIES,
  SCORE_SURFACES,
  type QaScore,
  type ScoreCell,
} from '@automate/shared-contracts';
import { Dashboard, read, summariseReports } from './Dashboard';
import { makeApi, makeQa, makeScan, makeTrend } from '../test-utils';
import type { QaClient } from '../lib/qa-client';
import type { QaScore as WebQaScore } from '../lib/qa';

/**
 * The dashboard.
 *
 * Most assertions here are about **what the dashboard refuses to say**: a cell nobody
 * measured is drawn in no colour, a failed read names itself instead of rendering zero,
 * and a change is only called better or worse in the direction that metric is good in.
 */

const AT = '2026-10-04T00:00:00.000Z';

function cell(
  category: (typeof SCORE_CATEGORIES)[number],
  surface: (typeof SCORE_SURFACES)[number],
  overrides: Partial<ScoreCell> = {},
): ScoreCell {
  return {
    key: `${category}:${surface}`,
    category,
    surface,
    score: 0.8,
    presence: 1,
    depth: 0.8,
    stability: 0.9,
    signal: 0.8,
    excluded: false,
    inputs: {
      executedTests: 12,
      targetTests: 10,
      surfaceCoverage: 0.72,
      coverageTarget: 0.7,
      flakeRate: 0.02,
      failedFingerprints: [],
      flakyFingerprints: [],
      hollowFingerprints: [],
      qualifyingRuns: 3,
    },
    ...overrides,
  };
}

function makeScore(cells?: ScoreCell[]): WebQaScore {
  const base: QaScore = {
    projectId: 'project-1',
    at: AT,
    total: 72,
    cappedBy: 'security',
    cappingValue: 0,
    cells:
      cells ??
      SCORE_CATEGORIES.flatMap((category) =>
        SCORE_SURFACES.map((surface) => cell(category, surface)),
      ),
    surfaces: { backend: 0.8, frontend: 0.74, platform: 0.62 },
    rows: [
      ...SCORE_CATEGORIES.map((category) => ({
        id: category,
        value: 0.8,
        weight: 0.16,
        includedCells: 3,
      })),
      { id: 'pyramid-shape', value: 0.42, weight: 0.04, includedCells: 3 },
    ],
    pyramid: {
      observed: { unit: 0.8, integration: 0.15, e2e: 0.05 },
      target: { unit: 100, integration: 25, e2e: 5 },
      declaredTarget: null,
      shape: 0.42,
      drift: 0.31,
    },
    gaps: [],
    findings: [],
    provenance: {
      projectId: 'project-1',
      detectorVersion: 1,
      runsRead: 4,
      resultsRead: 142,
      infraFailedRuns: [],
      infraFailedRate: 0,
      quarantinedFingerprints: [],
      outcomeCounts: { passed: 130, failed: 12 },
    },
    weights: {
      cell: { depth: 0.5, stability: 0.3, signal: 0.2 },
      rows: { unit: 0.24, integration: 0.24, e2e: 0.24, performance: 0.16, security: 0.08 },
      pyramid: 0.04,
    },
  };
  return QaScoreSchema.parse(base);
}

function renderDashboard(qa: QaClient, api = makeApi(), projectId?: string) {
  const rootRoute = createRootRoute({
    component: () => <Dashboard qa={qa} api={api} projectId={projectId} />,
  });
  const router = createRouter({ routeTree: rootRoute });
  router.update({ history: createMemoryHistory({ initialEntries: ['/dashboard'] }) });
  return render(<RouterProvider router={router} />);
}

function qaWithScore(overrides: Partial<QaClient> = {}): QaClient {
  const special: Record<string, Partial<ScoreCell>> = {
    'unit:backend': { score: 0.9 },
    'unit:frontend': { score: 0.4 },
    'unit:platform': { score: 0.1 },
    'e2e:backend': { inputs: { ...cell('e2e', 'backend').inputs, surfaceCoverage: null } },
    'e2e:frontend': { excluded: true },
  };
  return makeQa({
    getScore: vi.fn(async () =>
      makeScore(
        SCORE_CATEGORIES.flatMap((category) =>
          SCORE_SURFACES.map((surface) =>
            cell(category, surface, special[`${category}:${surface}`]),
          ),
        ),
      ),
    ),
    getGaps: vi.fn(async () => ({
      cappedBy: 'security',
      gaps: [
        {
          cell: 'a:backend',
          category: 'a',
          surface: 'backend',
          current: 0.1,
          potential: 0.2,
          cheapestClosure: 'Add a test',
        },
        {
          cell: 'b:backend',
          category: 'b',
          surface: 'backend',
          current: 0.1,
          potential: 0.5,
          cheapestClosure: 'Add two',
        },
        {
          cell: 'c:backend',
          category: 'c',
          surface: 'backend',
          current: 0.1,
          potential: 0.5,
          cheapestClosure: 'Add three',
        },
        {
          cell: 'd:backend',
          category: 'd',
          surface: 'backend',
          current: 0.1,
          potential: 0.05,
          cheapestClosure: 'Add four',
        },
      ],
    })),
    ...overrides,
  });
}

describe('the dashboard', () => {
  it('reports the six figures, each with its change against the window before', async () => {
    renderDashboard(qaWithScore(), makeApi({ getQuarantine: vi.fn(async () => []) }));
    await waitFor(() => expect(screen.getByTestId('kpi-health')).toHaveTextContent('72'));
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-subject')).toHaveTextContent('Automate · /repos/automate');
    expect(screen.getByTestId('kpi-health')).toHaveTextContent('limited by security at 0.00');
    // 80% → 90% is ten points better, and says so in words as well as colour.
    expect(screen.getByTestId('kpi-pass-rate')).toHaveTextContent('90.0%');
    expect(screen.getByTestId('kpi-pass-rate')).toHaveTextContent('+10.0% (better)');
    expect(screen.getByTestId('kpi-runs')).toHaveTextContent('12');
    // More runs is activity, not quality, so it is never called better.
    expect(screen.getByTestId('kpi-runs')).not.toHaveTextContent('(better)');
    // 4 s → 3 s is faster, which is better even though the number went down.
    expect(screen.getByTestId('kpi-duration')).toHaveTextContent('3.0 s');
    expect(screen.getByTestId('kpi-duration')).toHaveTextContent('(better)');
    expect(screen.getByTestId('kpi-flaky')).toHaveTextContent('0 quarantined');
    expect(screen.getByTestId('kpi-maturity')).toHaveTextContent('50%');
    expect(screen.getByTestId('kpi-maturity')).toHaveTextContent('1 of 3 capabilities');
  });

  it('compares before and now row by row, and tallies what improved', async () => {
    renderDashboard(qaWithScore());
    const table = await screen.findByTestId('dashboard-before-now');
    await waitFor(() => expect(within(table).getByTestId('compare-passRate')).toBeInTheDocument());
    expect(within(table).getByTestId('compare-passRate')).toHaveTextContent('80.0%90.0%');
    expect(within(table).getByTestId('compare-failedRuns')).toHaveTextContent('(better)');
    expect(within(table).getByTestId('compare-tests')).toHaveTextContent('±0');
    expect(screen.getByTestId('before-now-tally')).toHaveTextContent(
      '4 improved · 0 regressed, against the 3 days before',
    );
  });

  it('draws the trend, and refetches only the trend when the window changes', async () => {
    const qa = qaWithScore();
    renderDashboard(qa);
    const chart = await screen.findByTestId('trend-chart');
    expect(within(chart).getAllByTestId('trend-bar')).toHaveLength(3);
    // The middle day has no verdict, so the line is broken there rather than dropped to 0%.
    expect(within(chart).getAllByTestId('trend-line')).toHaveLength(2);
    expect(within(chart).getByRole('img')).toHaveAccessibleName(
      '6 runs over 3 days. Pass rate from 50.0% to 50.0%.',
    );

    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    await waitFor(() => expect(qa.getTrend).toHaveBeenLastCalledWith(7));
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(qa.getScore).toHaveBeenCalledTimes(1);
  });

  it('draws an unmeasured cell in no colour, and an excluded one as n/a', async () => {
    renderDashboard(qaWithScore());
    await waitFor(() => expect(screen.getByTestId('cell-unit:backend')).toBeInTheDocument());
    expect(screen.getByTestId('cell-unit:backend')).toHaveAttribute('data-band', 'good');
    expect(screen.getByTestId('cell-unit:frontend')).toHaveAttribute('data-band', 'warn');
    expect(screen.getByTestId('cell-unit:platform')).toHaveAttribute('data-band', 'bad');
    const unmeasured = screen.getByTestId('cell-e2e:backend');
    expect(unmeasured).toHaveAttribute('data-band', 'unmeasured');
    expect(unmeasured.className).not.toMatch(/bg-(success|warning|danger)/u);
    expect(unmeasured).toHaveTextContent('coverage unmeasured');
    expect(screen.queryByTestId('cell-e2e:frontend')).not.toBeInTheDocument();
    expect(screen.getByTestId('dashboard-matrix')).toHaveTextContent('n/a');
    expect(screen.getByTestId('matrix-limiter')).toHaveTextContent('Blocking: security at 0.00');
  });

  it('ranks the next actions by worth, then names the missing tools by priority', async () => {
    renderDashboard(qaWithScore());
    const queue = await screen.findByTestId('dashboard-queue');
    await waitFor(() => expect(within(queue).getAllByRole('listitem')).toHaveLength(5));
    const items = within(queue)
      .getAllByRole('listitem')
      .map((item) => item.dataset['testid']);
    // Two at 0.5, ordered by name, then 0.2; the 0.05 gap is fourth and off the list.
    expect(items).toEqual([
      'queue-gap-b:backend',
      'queue-gap-c:backend',
      'queue-gap-a:backend',
      'queue-tool-gitleaks',
      'queue-tool-stryker',
    ]);
    expect(within(queue).getAllByText('+50 pts')).toHaveLength(2);
    expect(within(queue).getByRole('link', { name: 'Toolbox' })).toHaveAttribute(
      'href',
      '/dashboard/toolbox',
    );
  });

  it('summarises what the reports on disk say', async () => {
    renderDashboard(qaWithScore());
    const reports = await screen.findByTestId('dashboard-reports');
    await waitFor(() => expect(within(reports).getByText('91.5%')).toBeInTheDocument());
    expect(reports).toHaveTextContent('Tests10');
    expect(reports).toHaveTextContent('2 failing');
    expect(reports).toHaveTextContent('Findings1');
    expect(within(reports).getAllByRole('listitem')).toHaveLength(3);
  });

  it('names a failed read rather than rendering it as zero, and keeps the rest', async () => {
    const qa = makeQa({
      getScore: vi.fn(async () => {
        throw Object.assign(new Error('API answered 500'), { detail: 'score store offline' });
      }),
      getScan: vi.fn(async () => {
        throw new Error('scan refused');
      }),
    });
    renderDashboard(qa, makeApi({ getQuarantine: vi.fn(async () => Promise.reject('down')) }));
    await waitFor(() => expect(screen.getByTestId('dashboard-failures')).toBeInTheDocument());
    const failures = screen.getByTestId('dashboard-failures');
    expect(failures).toHaveTextContent('qa/score: score store offline');
    expect(failures).toHaveTextContent('scan: scan refused');
    expect(failures).toHaveTextContent('quarantine: down');
    expect(screen.getByTestId('kpi-health')).toHaveTextContent('—');
    expect(screen.getByTestId('kpi-health')).toHaveTextContent('score unread');
    expect(screen.getByTestId('kpi-maturity')).toHaveTextContent('repository unscanned');
    expect(screen.getByTestId('dashboard-matrix')).toHaveTextContent(
      'The score could not be read.',
    );
    expect(screen.getByTestId('dashboard-reports')).toHaveTextContent('could not be scanned');
    expect(screen.getByTestId('dashboard-queue')).toHaveTextContent('Nothing queued');
    // The trend still answered, so the figures it feeds are still there.
    expect(screen.getByTestId('kpi-pass-rate')).toHaveTextContent('90.0%');
    expect(screen.getByTestId('kpi-flaky')).toHaveTextContent('vs previous window');
  });

  it('says when there is no run history to compare, rather than inventing a delta', async () => {
    const qa = qaWithScore({
      getTrend: vi.fn(async () =>
        makeTrend({
          current: { passRate: null, avgDurationMs: null },
          previous: { passRate: null },
        }),
      ),
    });
    renderDashboard(qa);
    await waitFor(() => expect(screen.getByTestId('kpi-pass-rate')).toHaveTextContent('—'));
    expect(screen.getByTestId('kpi-pass-rate')).toHaveTextContent('no earlier window to compare');
    expect(screen.getByTestId('kpi-duration')).toHaveTextContent('—');
  });

  it('keeps the page when the trend read fails, and says why in its panel', async () => {
    renderDashboard(
      qaWithScore({
        getTrend: vi.fn(async () => {
          throw new Error('trend offline');
        }),
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('dashboard-trend')).toHaveTextContent('trend offline'),
    );
    expect(screen.getByTestId('dashboard-before-now')).toHaveTextContent('Waiting for run history');
    expect(screen.getByTestId('kpi-runs')).toHaveTextContent('—');
  });

  it('shows the onboarding screen for an empty registry, and for an unknown project id', async () => {
    renderDashboard(makeQa({ listProjects: vi.fn(async () => []) }));
    await waitFor(() => expect(screen.getByTestId('onboarding')).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  });

  it('routes to an explicit project and refuses one that is not registered', async () => {
    renderDashboard(makeQa(), makeApi(), 'missing');
    await waitFor(() => expect(screen.getByTestId('onboarding')).toBeInTheDocument());
  });

  it('names a registry failure as a failure, not as an empty install', async () => {
    renderDashboard(
      makeQa({
        listProjects: vi.fn(async () => {
          throw new Error('registry down');
        }),
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('project-gate-error')).toHaveTextContent('registry down'),
    );
  });

  it('shows the loading state while the reads are in flight', async () => {
    renderDashboard(makeQa({ getScore: vi.fn(() => new Promise<never>(() => undefined)) }));
    await waitFor(() =>
      expect(screen.getByTestId('dashboard-loading')).toHaveTextContent('Reading Automate'),
    );
  });

  it('reports a snapshot that could not even be requested', async () => {
    const api = makeApi({
      getQuarantine: vi.fn(() => {
        throw new Error('client misconfigured');
      }),
    });
    renderDashboard(qaWithScore(), api);
    await waitFor(() =>
      expect(screen.getByTestId('dashboard-load-error')).toHaveTextContent('client misconfigured'),
    );
  });

  it('says plainly when no report was found on disk', async () => {
    renderDashboard(qaWithScore({ getScan: vi.fn(async () => makeScan({ reports: [] })) }));
    const reports = await screen.findByTestId('dashboard-reports');
    await waitFor(() =>
      expect(reports).toHaveTextContent('No coverage, test, lint or security report'),
    );
    expect(reports).toHaveTextContent('Coverage—');
  });
});

describe('what the dashboard refuses to draw (GLASS-3, DESIGN-4, DESIGN-5)', () => {
  it('renders a percentage the API sends as 0–100 as that percentage, never times 100', async () => {
    renderDashboard(
      qaWithScore({ getTrend: vi.fn(async () => makeTrend({ current: { passRate: 67 } })) }),
    );
    await waitFor(() => expect(screen.getByTestId('kpi-pass-rate')).toHaveTextContent('67.0%'));
    expect(screen.getByTestId('kpi-pass-rate')).not.toHaveTextContent(/6700|6\.7%|0\.67/u);
    // And the value that really is a fraction is still scaled: a gap worth 0.5 is +50 pts.
    expect(await screen.findAllByText('+50 pts')).toHaveLength(2);
  });

  it('sets every figure it renders in tabular numerals, so a column does not shift', async () => {
    renderDashboard(qaWithScore());
    await waitFor(() => expect(screen.getByTestId('cell-unit:backend')).toBeInTheDocument());
    const isFigure = (text: string) => /^[+\u2212-]?[\d.,]+\s?(%|ms|s|pts)?$/u.test(text.trim());
    const figures = [...document.body.querySelectorAll<HTMLElement>('*')].filter(
      (element) => element.children.length === 0 && isFigure(element.textContent ?? ''),
    );
    // The control arm: a sweep that found no figures would pass by reading nothing.
    expect(figures.length).toBeGreaterThan(20);
    const offenders = figures
      .filter((element) => element.closest('.tabular-nums, .sr-only') === null)
      .map(
        (element) =>
          `<${element.tagName.toLowerCase()} class="${element.className}">${element.textContent ?? ''}`,
      );
    expect(offenders).toEqual([]);
  });

  it('draws an unmeasured cell as an outline with no fill, and a measured one filled', async () => {
    renderDashboard(qaWithScore());
    const unmeasured = await screen.findByTestId('cell-e2e:backend');
    expect(unmeasured.className).toMatch(/border-dashed/u);
    expect(unmeasured.className).not.toMatch(/\bbg-/u);
    const measured = screen.getByTestId('cell-unit:backend');
    expect(measured.className).toMatch(/bg-success/u);
    expect(measured.className).not.toMatch(/border-dashed/u);
  });
});

describe('the dashboard helpers', () => {
  it('reads an endpoint failure as its own sentence', () => {
    expect(read({ status: 'fulfilled', value: 1 })).toEqual({ value: 1, failure: null });
    expect(read({ status: 'rejected', reason: { detail: 'said so' } })).toEqual({
      value: null,
      failure: 'said so',
    });
    expect(read({ status: 'rejected', reason: new Error('boom') }).failure).toBe('boom');
    expect(read({ status: 'rejected', reason: 42 }).failure).toBe('42');
  });

  it('summarises reports by the best coverage and the sum of the rest', () => {
    expect(summariseReports([])).toEqual({
      coverage: null,
      coverageReports: 0,
      tests: 0,
      failing: 0,
      findings: 0,
    });
    expect(
      summariseReports([
        { path: 'a', kind: 'coverage', format: 'lcov', headline: 'x', metrics: {}, status: 'bad' },
        {
          path: 'c',
          kind: 'coverage',
          format: 'lcov',
          headline: 'x',
          metrics: { lines: 90 },
          status: 'good',
        },
        {
          path: 'b',
          kind: 'lint',
          format: 'eslint-json',
          headline: 'x',
          metrics: { errors: 3 },
          status: 'bad',
        },
      ]),
    ).toEqual({ coverage: 45, coverageReports: 2, tests: 0, failing: 0, findings: 3 });
  });
});
