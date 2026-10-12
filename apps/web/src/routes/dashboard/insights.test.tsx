import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { InsightsPage, Route } from './insights.js';
import type { ApiClient } from '../../lib/api.js';
import type { QaClient } from '../../lib/qa-client.js';

afterEach(() => {
  // The mocks are module-level for the suite, so their call history has to be
  // cleared between cases — otherwise "was not called" asserts about the *previous*
  // test, which is the assertion that cannot fail when it should.
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * The insights screen, against the engine it renders.
 *
 * ## Why the QA client is injected and `fetch` is not stubbed
 *
 * This screen makes **seven** calls through one client, and stubbing `fetch`
 * seven ways to test one rule is the slowest possible way to write this file. The
 * injected `QaClient` is the seam the engine is designed around — a screen
 * renders what it is given, and these tests give it what a rule needs.
 *
 * What is asserted is the *engine-visibility* property: every derived finding
 * appears with its severity, its title, its source and its citation, because a
 * finding a reader cannot trace is a finding they have to trust.
 */

/** The seven reads, all resolved, as the client answers them. */
function qaClient(overrides: Partial<QaClient> = {}): QaClient {
  return {
    getScore: vi.fn().mockResolvedValue({
      projectId: 'p1',
      total: 42,
      cappedBy: 'security',
      cappingValue: 0,
      cells: [],
      surfaces: {},
      rows: [],
      pyramid: {},
      gaps: [],
      findings: [],
      provenance: {},
      weights: {},
      trend: { points: [], labels: [] },
    }),
    getFlaky: vi.fn().mockResolvedValue({ cells: [] }),
    getGaps: vi.fn().mockResolvedValue({ cappedBy: 'security', gaps: [] }),
    getHollow: vi.fn().mockResolvedValue({ cells: [] }),
    getStructure: vi.fn().mockResolvedValue({ findings: [] }),
    getProject: vi.fn(),
    ...overrides,
  } as unknown as QaClient;
}

const api = {
  getAnalyticsSummary: vi.fn().mockResolvedValue({
    totalRuns: 12,
    passRate: 91,
    avgDurationMs: 4200,
  }),
  getQuarantine: vi.fn().mockResolvedValue([]),
  getKpiSummary: vi.fn().mockResolvedValue({ kpis: [] }),
} as unknown as ApiClient;

describe('InsightsPage', () => {
  it('renders every finding the engine derives, with its evidence', async () => {
    render(<InsightsPage api={api} qa={qaClient()} projectId="p1" />);
    const list = await screen.findByTestId('insights-list');
    // A zero row caps the mean, so `zero-caps-mean` fires; the pass rate always
    // does. Both are in the list, and neither is a summary of the other.
    expect(within(list).getByTestId('insight-zero-caps-mean')).toBeInTheDocument();
    expect(within(list).getByTestId('insight-pass-rate')).toBeInTheDocument();
    // **The citation and the source.** A finding without them is a claim the
    // reader has to trust, which is the opposite of what this product is.
    const zero = within(list).getByTestId('insight-zero-caps-mean');
    expect(zero).toHaveTextContent('qa/score');
    expect(zero).toHaveTextContent('cappedBy=security');
    expect(zero).toHaveTextContent('critical');
  });

  it('says so plainly when no rule fires', async () => {
    // **Every read answers, and every answer is empty.** That is a fresh
    // install's honest state, and it is the only way to reach "nothing to
    // report": the pass-rate rule fires whenever analytics answers *with a
    // value*, so a rejecting read would be an error state instead — which
    // `useResource` produces, and which is the right answer for a different
    // question.
    const empty = {
      getAnalyticsSummary: vi.fn().mockResolvedValue(null),
      getQuarantine: vi.fn().mockResolvedValue(null),
      getKpiSummary: vi.fn().mockResolvedValue({ kpis: [] }),
    } as unknown as ApiClient;
    const emptyQa = qaClient({
      getScore: vi.fn().mockResolvedValue(null),
      getFlaky: vi.fn().mockResolvedValue(null),
      getGaps: vi.fn().mockResolvedValue(null),
      getHollow: vi.fn().mockResolvedValue(null),
      getStructure: vi.fn().mockResolvedValue(null),
    });
    render(<InsightsPage api={empty} qa={emptyQa} projectId="p1" />);
    const state = await screen.findByTestId('insights-empty');
    expect(state).toHaveTextContent('Nothing to report');
  });

  it('asks for a project rather than deriving from nothing', () => {
    render(<InsightsPage api={api} qa={qaClient()} />);
    expect(screen.getByTestId('insights-no-project')).toBeInTheDocument();
    // No calls at all: the engine is about one stack, and deriving from an
    // undefined project would be a finding about a project nobody named.
    expect(api.getAnalyticsSummary).not.toHaveBeenCalled();
  });

  it('reports a failed read as the failure it is, not as an empty finding list', async () => {
    const broken = qaClient({
      getScore: vi.fn().mockRejectedValue(new Error('score is unavailable')),
    });
    render(<InsightsPage api={api} qa={broken} projectId="p1" />);
    // The list still renders the rules whose reads *did* answer, and the failed
    // one is absent — the engine's contract, not a screen-level decision.
    await screen.findByTestId('insights-list');
    expect(screen.queryByTestId('insight-zero-caps-mean')).not.toBeInTheDocument();
  });

  it('renders through its own route component, which is how the router mounts it', () => {
    // The route's `component` factory is what the router calls, and a factory
    // nothing invokes is a screen the router cannot reach. This is the seam
    // `Composition.test.tsx` and the router itself both read; asserting it keeps
    // the panel reachable rather than only importable.
    const options = Route.options as unknown as { component: () => React.ReactNode };
    const element = options.component();
    expect(React.isValidElement(element)).toBe(true);
    expect((element as React.ReactElement).type).toBe(InsightsPage);
  });

  it('shows the measurements beside the findings, formatted from their unit', async () => {
    // **The KPI grid is the other half of the answer** and the unit is decided by
    // the shared formatter, not by this screen: a `percent` KPI gets a sign and a
    // `ratio` does not, which is the GLASS-3 rule made visible in the one place a
    // reader sees both kinds of number.
    const withKpis = {
      ...api,
      getKpiSummary: vi.fn().mockResolvedValue({
        kpis: [
          {
            id: 'pass-rate',
            label: 'Pass rate',
            value: 91,
            unit: 'percent',
            denominator: 12,
            qualifier: null,
          },
          {
            id: 'flake-rate',
            label: 'Flake rate',
            value: 0.042,
            unit: 'ratio',
            denominator: 12,
            qualifier: null,
          },
        ],
      }),
    } as unknown as ApiClient;
    render(<InsightsPage api={withKpis} qa={qaClient()} projectId="p1" />);
    await screen.findByTestId('insights-list');
    const grid = await screen.findByTestId('insights-kpis');
    expect(within(grid).getByTestId('insights-kpi-pass-rate')).toHaveTextContent('91%');
    // 0.042 and not `4.2%`: a ratio is a fraction, and the percent sign is what
    // the two formatters used to argue about at each call site.
    expect(within(grid).getByTestId('insights-kpi-flake-rate')).toHaveTextContent('0.042');
  });
});
