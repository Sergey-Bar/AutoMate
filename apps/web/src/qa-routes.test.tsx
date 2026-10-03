import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { configure } from '@testing-library/dom';
import { QaScoreSchema } from '@automate/shared-contracts';
import { MemoryRouter } from './router.js';

/**
 * The command-center routes, reached **through the router**.
 *
 * ## Why this file exists when `score.test.tsx` already renders the screens
 *
 * Because `score.test.tsx` renders the page components and **not** the route
 * wrappers, and the wrappers are code: each declares a path, reads the route
 * parameter, and constructs the client. That is a `component` function per route, and
 * it was the largest block of uncovered code in the web package — four routes a
 * reader can navigate to, none of which any test had ever entered.
 *
 * The property that matters here is reachability plus one thing each screen owes
 * the reader: a score shows its capping row, a gap list shows what would close a
 * gap, and **a failure renders the server's message** rather than an empty table.
 */

/** The same generous render budget `router.test.tsx` uses, for the same reason. */
const RENDER_TIMEOUT_MS = 15_000;
configure({ asyncUtilTimeout: RENDER_TIMEOUT_MS });

beforeAll(() => {
  // jsdom does not implement `scrollTo` and **throws** when a component calls it.
  // An unhandled throw in one file aborts the whole package run, which is how a
  // missing stub in a single test becomes "no coverage summary" for every file —
  // `router.test.tsx` already learned this and stubs it for itself.
  Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
});

const AT = '2026-10-02T00:00:00.000Z';

const cell = (category: string, surface: string, value: number) => ({
  key: `${category}:${surface}`,
  category,
  surface,
  score: value,
  presence: value > 0 ? 1 : 0,
  depth: value,
  stability: 1,
  signal: 1,
  excluded: false,
  inputs: {
    executedTests: 10,
    targetTests: 20,
    surfaceCoverage: null,
    coverageTarget: null,
    flakeRate: 0,
    failedFingerprints: [],
    flakyFingerprints: [],
    hollowFingerprints: [],
    qualifyingRuns: 1,
  },
});

const SCORE = QaScoreSchema.parse({
  projectId: 'project-1',
  at: AT,
  total: 0,
  cappedBy: 'security',
  cappingValue: 0,
  cells: (['unit', 'integration', 'e2e', 'performance', 'security'] as const).flatMap((category) =>
    (['backend', 'frontend', 'platform'] as const).map((surface) => cell(category, surface, 0.6)),
  ),
  surfaces: { backend: 0.6, frontend: 0.6, platform: 0.6 },
  rows: [
    ...(['unit', 'integration', 'e2e', 'performance', 'security'] as const).map((id) => ({
      id,
      value: 0.6,
      weight: 0.18,
      includedCells: 3,
    })),
    { id: 'pyramid-shape' as const, value: 0.9, weight: 0.1, includedCells: 15 },
  ],
  pyramid: {
    observed: { unit: 0.7, integration: 0.2, e2e: 0.1 },
    target: { unit: 0.7, integration: 0.2, e2e: 0.1 },
    declaredTarget: null,
    shape: 1,
    drift: 0,
  },
  gaps: [],
  findings: [],
  provenance: {
    projectId: 'project-1',
    detectorVersion: 1,
    runsRead: 3,
    resultsRead: 120,
    infraFailedRuns: [],
    infraFailedRate: 0,
    quarantinedFingerprints: [],
    outcomeCounts: { passed: 120 },
  },
  weights: {
    cell: { depth: 0.4, stability: 0.4, signal: 0.2 },
    rows: { unit: 0.18, integration: 0.18, e2e: 0.18, performance: 0.18, security: 0.18 },
    pyramid: 0.1,
  },
});

/**
 * A fetch that answers the session, the run list and **one** QA route.
 *
 * `qaPath` is the route under test; anything else QA answers 404, so a screen that
 * requested the wrong endpoint gets a 404 rather than a passing render of the wrong
 * data — which is the failure this whole file is guarding against.
 */
function mockApi(qaPath: string, body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/session')) return new Response('{}', { status: 200 });
      if (url.endsWith('/api/v1/runs')) return new Response('[]', { status: 200 });
      if (url.endsWith(qaPath)) return new Response(JSON.stringify(body), { status });
      return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the score route is reachable and shows its limiter', () => {
  it('renders the score with the row that capped it', async () => {
    mockApi('/qa/score', SCORE);
    render(<MemoryRouter initialEntries={['/dashboard/score/project-1']} />);

    await waitFor(() => expect(screen.getByText(/0\.0\/100/u)).toBeInTheDocument(), {
      timeout: RENDER_TIMEOUT_MS,
    });
    // The route parameter reached the client, which is what proves the wrapper
    // wired it rather than defaulting to something.
    expect(screen.getAllByText('security').length).toBeGreaterThan(1);
  });
});

describe('the gaps route is reachable and ranks what the server ranked', () => {
  it('renders the queue and what would close each gap', async () => {
    mockApi('/qa/gaps', {
      gaps: [
        {
          cell: 'security:backend',
          category: 'security',
          surface: 'backend',
          current: 0,
          potential: 0.4,
          cheapestClosure: 'No suite has completed a run.',
        },
      ],
      cappedBy: 'security',
    });
    render(<MemoryRouter initialEntries={['/dashboard/gaps/project-1']} />);

    await waitFor(() => expect(screen.getByText('security:backend')).toBeInTheDocument(), {
      timeout: RENDER_TIMEOUT_MS,
    });
    expect(screen.getByText('No suite has completed a run.')).toBeInTheDocument();
    expect(screen.getByText(/Capped by security/u)).toBeInTheDocument();
  });
});

describe('the three deep-dive routes are reachable', () => {
  it('renders the hollow register', async () => {
    mockApi('/qa/hollow', {
      cells: [{ cell: 'unit:backend', hollowFingerprints: ['hollow-1'], signal: 0 }],
    });
    render(<MemoryRouter initialEntries={['/dashboard/hollow/project-1']} />);
    await waitFor(() => expect(screen.getByText('hollow-1')).toBeInTheDocument(), {
      timeout: RENDER_TIMEOUT_MS,
    });
  });

  it('renders the flaky register with its rates', async () => {
    mockApi('/qa/flaky', {
      cells: [
        {
          cell: 'unit:backend',
          flakyFingerprints: ['flaky-1'],
          flakeRate: 0.25,
          stability: 0.75,
        },
      ],
    });
    render(<MemoryRouter initialEntries={['/dashboard/flaky/project-1']} />);
    await waitFor(() => expect(screen.getByText('flaky-1')).toBeInTheDocument(), {
      timeout: RENDER_TIMEOUT_MS,
    });
    expect(screen.getByText('0.25')).toBeInTheDocument();
  });

  it('renders the structural findings', async () => {
    mockApi('/qa/structure', {
      findings: [
        {
          kind: 'dominant_cell',
          statement: '90% of the e2e tests are in e2e:backend.',
          cells: ['e2e:backend'],
          impact: 0.1,
        },
      ],
    });
    render(<MemoryRouter initialEntries={['/dashboard/structure/project-1']} />);
    await waitFor(
      () =>
        expect(screen.getByText('90% of the e2e tests are in e2e:backend.')).toBeInTheDocument(),
      { timeout: RENDER_TIMEOUT_MS },
    );
  });
});

describe('a failure is never an empty screen', () => {
  it("shows the server's message when the score request fails", async () => {
    mockApi('/qa/score', { error: { code: 'NOT_FOUND', message: 'No such project' } }, 404);
    render(<MemoryRouter initialEntries={['/dashboard/score/project-1']} />);

    // A 404 rendering an empty matrix would read as "this project has no tests",
    // which is the one conclusion a failure must never support.
    await waitFor(() => expect(screen.getByText(/No such project/u)).toBeInTheDocument(), {
      timeout: RENDER_TIMEOUT_MS,
    });
  });

  it("shows the server's message when the gaps request fails", async () => {
    mockApi('/qa/gaps', { error: { code: 'INTERNAL', message: 'score unavailable' } }, 500);
    render(<MemoryRouter initialEntries={['/dashboard/gaps/project-1']} />);
    await waitFor(() => expect(screen.getByText(/score unavailable/u)).toBeInTheDocument(), {
      timeout: RENDER_TIMEOUT_MS,
    });
  });
});
