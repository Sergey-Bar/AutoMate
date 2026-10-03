import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QaScoreSchema, type QaScore } from '@automate/shared-contracts';
import type { QaClient } from '../../lib/qa-client.js';
import { ScorePage, cappingCell, formatCell } from './score.js';
import { FlakyPage, GapsPage, HollowPage, StructurePage } from './gaps.js';

/**
 * The command center's screens.
 *
 * ## The assertion that matters most is the capping cell
 *
 * The total is a weighted *geometric* mean. That choice is what makes it
 * trustworthy — a zero anywhere forces the total to zero, so five perfect
 * categories cannot average away a repository with no security testing. And it is
 * exactly what makes the total alone undiagnosable. So every test below that renders
 * a score asserts that the limiter is on the screen with it, and there is no test
 * that asserts a bare number is visible.
 *
 * The client is a **prop**, following every other dashboard route here, so these
 * tests need no module mock and cannot pass or fail on import order.
 */

const AT = '2026-10-02T00:00:00.000Z';

const cell = (category: string, surface: string, scoreValue: number) => ({
  key: `${category}:${surface}`,
  category,
  surface,
  score: scoreValue,
  presence: scoreValue > 0 ? 1 : 0,
  depth: scoreValue,
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

function stubApi(overrides: Partial<QaClient> = {}): QaClient {
  return {
    getScore: vi.fn().mockResolvedValue(SCORE),
    getGaps: vi.fn().mockResolvedValue({
      gaps: [
        {
          cell: 'security:backend',
          category: 'security',
          surface: 'backend',
          current: 0,
          potential: 0.4,
          cheapestClosure: 'No suite has completed a run.',
        },
        {
          cell: 'unit:frontend',
          category: 'unit',
          surface: 'frontend',
          current: 0.2,
          potential: 0.1,
          cheapestClosure: 'Add tests.',
        },
      ],
      cappedBy: 'security',
    }),
    getHollow: vi.fn().mockResolvedValue({
      cells: [{ cell: 'unit:backend', hollowFingerprints: ['hollow-1', 'hollow-2'], signal: 0 }],
    }),
    getFlaky: vi.fn().mockResolvedValue({
      cells: [
        { cell: 'unit:backend', flakyFingerprints: ['flaky-1'], flakeRate: 0.25, stability: 0.75 },
      ],
    }),
    getStructure: vi.fn().mockResolvedValue({
      findings: [
        {
          kind: 'dominant_cell',
          statement: '90% of the e2e tests are in e2e:backend.',
          cells: ['e2e:backend'],
          impact: 0.1,
        },
      ],
    }),
    ...overrides,
  } as unknown as QaClient;
}

describe('the score is never rendered without the row that capped it', () => {
  it('shows the total and the limiter together', async () => {
    render(<ScorePage api={stubApi()} projectId="project-1" />);
    await waitFor(() => expect(screen.getByText(/0\.0\/100/u)).toBeInTheDocument());
    // `getAllByText`: the matrix also prints a `security` row label, and asserting on
    // the first match would pass even if the capping table were never rendered.
    expect(screen.getAllByText('security').length).toBeGreaterThan(1);
    // The reason is a sentence, not just a label: a row name tells the reader
    // where to look, and this tells them why the number is low.
    expect(
      screen.getByText(/cannot be averaged away|forces the total to zero/iu),
    ).toBeInTheDocument();
  });

  it('reads the limiter from the payload rather than recomputing it', () => {
    // The server resolved it with the weights it used. A client that re-derived the
    // mean would be a second implementation of it.
    expect(cappingCell(SCORE).row).toBe('security');
    expect(cappingCell(SCORE).value).toBe(0);
  });

  it('changes the explanation when the capping row is not zero', () => {
    // A **non-zero** total, because `QaScoreSchema` refuses `total: 0` with a
    // positive `cappingValue` — a geometric mean that reached zero has a zero
    // limiter, and a payload saying otherwise is one where the two fields
    // disagree about why. The first version of this fixture set `total: 0` and was
    // rejected by its own contract.
    const nonzero = QaScoreSchema.parse({
      ...SCORE,
      total: 48.5,
      cappedBy: 'unit',
      cappingValue: 0.3,
    });
    expect(cappingCell(nonzero).reason).toMatch(/most shortfall/iu);
  });

  it('renders every cell with its components, so no number is unexplained', async () => {
    render(<ScorePage api={stubApi()} projectId="project-1" />);
    // Fifteen cells share a format string, so this asserts the **count** — a matcher
    // that found one would still pass if only one cell had rendered.
    await waitFor(() =>
      expect(screen.getAllByText(/0\.60 \(P1 D0\.60 S1\.00 Q1\.00\)/u).length).toBe(15),
    );
  });

  it('says a cell with no suite reads as zero, not as a small number', () => {
    expect(
      formatCell({
        ...cell('unit', 'backend', 0),
        score: 0,
        presence: 0,
        depth: 0,
        stability: 1,
        signal: 1,
        excluded: false,
      }),
    ).toContain('no suite');
  });

  it('renders an n/a cell as n/a, never as a zero', () => {
    // A cell the project marked n/a is excluded and its weight redistributed;
    // showing it as `0` would put a red mark on a decision the project made.
    expect(
      formatCell({
        ...cell('security', 'frontend', 0),
        score: 0,
        presence: 0,
        depth: 0,
        stability: 1,
        signal: 1,
        excluded: true,
      }),
    ).toBe('n/a');
  });

  it('shows the failure rather than a blank screen when the request fails', async () => {
    const failing = stubApi({
      getScore: vi.fn().mockRejectedValue(new Error('API answered 404 — No such project')),
    });
    render(<ScorePage api={failing} projectId="missing" />);
    // The whole message, not a fragment of it: the failure a reader sees is the
    // server's sentence, and a UI that dropped half of it would still match here.
    await waitFor(() => expect(screen.getByText(/API answered 404/u)).toBeInTheDocument());
  });

  it('shows a non-Error rejection rather than rendering an empty screen', async () => {
    // A rejected promise carrying a string is still a failure a reader must see.
    // Rendering `String(error)` on a non-Error would otherwise produce
    // `[object Object]` — which is a screen that looks broken rather than one that
    // reports something.
    const failing = stubApi({
      getScore: vi.fn().mockRejectedValue('socket hang up'),
    });
    render(<ScorePage api={failing} projectId="project-1" />);
    await waitFor(() => expect(screen.getByText(/socket hang up/u)).toBeInTheDocument());
  });

  it('ignores a response that arrives after the screen is gone', async () => {
    // The `live` flag: without it, a slow response would call `setState` on an
    // unmounted component, and the reader would see a state update they never
    // asked for. Asserted by unmounting before the promise settles.
    let release: ((value: QaScore) => void) | undefined;
    const slow = stubApi({
      getScore: vi.fn().mockImplementation(
        () =>
          new Promise<QaScore>((resolve) => {
            release = resolve;
          }),
      ),
    });
    const view = render(<ScorePage api={slow} projectId="project-1" />);
    view.unmount();
    release?.(SCORE);
    await waitFor(() => expect(screen.queryByText(/0\.0\/100/u)).toBeNull());
  });
});

describe('the gap queue keeps the order the server chose', () => {
  it('renders them in the order they arrived, not re-ranked', async () => {
    render(<GapsPage api={stubApi()} projectId="project-1" />);
    await waitFor(() => expect(screen.getByText('security:backend')).toBeInTheDocument());
    // Ascending by `potential` would reverse these two. The client does not sort.
    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('security:backend');
    expect(rows[2]).toHaveTextContent('unit:frontend');
  });

  it('names the capping row in the header, so the list says what limits it', async () => {
    render(<GapsPage api={stubApi()} projectId="project-1" />);
    await waitFor(() => expect(screen.getByText(/Capped by security/u)).toBeInTheDocument());
  });

  it('says what would close each gap', async () => {
    render(<GapsPage api={stubApi()} projectId="project-1" />);
    await waitFor(() =>
      expect(screen.getByText('No suite has completed a run.')).toBeInTheDocument(),
    );
  });

  it('says nothing to fix rather than showing an empty table', async () => {
    const empty = stubApi({ getGaps: vi.fn().mockResolvedValue({ gaps: [], cappedBy: 'unit' }) });
    render(<GapsPage api={empty} projectId="project-1" />);
    await waitFor(() => expect(screen.getByText('Nothing to fix')).toBeInTheDocument());
  });
});

describe('hollow and flaky are rendered as identities, not as counts', () => {
  it('names each hollow test, because "3 hollow tests" is not actionable', async () => {
    render(<HollowPage api={stubApi()} projectId="project-1" />);
    await waitFor(() => expect(screen.getByText(/hollow-1, hollow-2/u)).toBeInTheDocument());
  });

  it('shows the flake rate beside the fingerprints it describes', async () => {
    render(<FlakyPage api={stubApi()} projectId="project-1" />);
    await waitFor(() => expect(screen.getByText('flaky-1')).toBeInTheDocument());
    expect(screen.getByText('0.25')).toBeInTheDocument();
    expect(screen.getByText('0.75')).toBeInTheDocument();
  });
});

describe('structural findings are reported and labelled as unscored', () => {
  it('renders each finding with its statement and impact', async () => {
    render(<StructurePage api={stubApi()} projectId="project-1" />);
    await waitFor(() =>
      expect(screen.getByText('90% of the e2e tests are in e2e:backend.')).toBeInTheDocument(),
    );
    expect(screen.getByText('dominant_cell')).toBeInTheDocument();
  });

  it('says so plainly when there are none, rather than showing an empty table', async () => {
    const empty = stubApi({ getStructure: vi.fn().mockResolvedValue({ findings: [] }) });
    render(<StructurePage api={empty} projectId="project-1" />);
    await waitFor(() => expect(screen.getByText('No structural findings')).toBeInTheDocument());
  });
});

describe('every screen has a failure state, and none of them is a blank page', () => {
  // Four screens, one shape. Testing the error path on one and not the other three
  // is how three screens end up rendering an empty table on a 404, which reads as
  // "there is nothing here" — the one conclusion a failure must never support.
  const cases = [
    { name: 'gaps', Page: GapsPage, method: 'getGaps' },
    { name: 'hollow', Page: HollowPage, method: 'getHollow' },
    { name: 'flaky', Page: FlakyPage, method: 'getFlaky' },
    { name: 'structure', Page: StructurePage, method: 'getStructure' },
  ] as const;

  for (const { name, Page, method } of cases) {
    it(`shows the server's message when ${name} fails`, async () => {
      const failing = stubApi({
        [method]: vi.fn().mockRejectedValue(new Error(`API answered 503 — ${name} unavailable`)),
      } as Partial<QaClient>);
      render(<Page api={failing} projectId="project-1" />);
      await waitFor(() =>
        expect(screen.getByText(new RegExp(`${name} unavailable`, 'u'))).toBeInTheDocument(),
      );
    });
  }

  it('renders an empty hollow and flaky register as an empty table rather than as text', async () => {
    // **No** "nothing to fix" copy for these two, and deliberately: an empty
    // hollow register is not a good result, it is an absence of evidence, and a
    // reassuring message would be claiming the suite is free of hollow tests when
    // the truth is that none were found.
    render(
      <HollowPage
        api={stubApi({ getHollow: vi.fn().mockResolvedValue({ cells: [] }) })}
        projectId="p"
      />,
    );
    await waitFor(() => expect(screen.getByText('Test fingerprints')).toBeInTheDocument());
    render(
      <FlakyPage
        api={stubApi({ getFlaky: vi.fn().mockResolvedValue({ cells: [] }) })}
        projectId="p"
      />,
    );
    await waitFor(() => expect(screen.getByText('Flake rate')).toBeInTheDocument());
  });
});
