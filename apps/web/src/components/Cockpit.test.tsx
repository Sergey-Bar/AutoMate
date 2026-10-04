/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import {
  QaScoreSchema,
  SCORE_CATEGORIES,
  SCORE_SURFACES,
  type QaScore,
  type ScoreCell,
} from '@automate/shared-contracts';
import { Cockpit } from './Cockpit';
import { makeApi } from '../test-utils';
import type { ApiClient } from '../lib/api';
import type { QaClient } from '../lib/qa-client';
import type {
  QaFlakyResponse,
  QaGapsResponse,
  QaScore as WebQaScore,
  RegisteredProject,
} from '../lib/qa';

/**
 * The cockpit.
 *
 * The assertions here are about **what the cockpit refuses to say**, which is why
 * most of them are about a colour or an ordering rather than about a number:
 *
 *   - the limiter is above the total, in the document, not merely beside it;
 *   - a cell with no coverage measurement reads `unmeasured` and is drawn in no
 *     confidence colour at all;
 *   - `pyramid-shape` gets its own strip rather than a sixteenth matrix cell;
 *   - a gap that names no closure is not in the queue.
 *
 * A dashboard that lies is worse than no dashboard, and a lie here is a *plausible*
 * lie: a confident green on a dimension nobody measured reads as a fact.
 */

const AT = '2026-10-04T00:00:00.000Z';

const CATEGORIES = SCORE_CATEGORIES;
const SURFACES = SCORE_SURFACES;

function cell(
  category: (typeof SCORE_CATEGORIES)[number],
  surface: (typeof SCORE_SURFACES)[number],
  overrides: Partial<ScoreCell> = {},
): ScoreCell {
  const key = `${category}:${surface}`;
  return {
    key,
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

/**
 * A score that satisfies `QaScoreSchema`, built rather than written out.
 *
 * **Parsed, not cast.** The fixture is the contract's own answer for "what does a
 * score look like", and a hand-written literal that drifted from the schema would
 * make every assertion below pass against a payload the API could never send.
 */
function makeScore(
  overrides: {
    cells?: ScoreCell[];
    cappedBy?: QaScore['cappedBy'];
    cappingValue?: number;
    total?: number;
  } = {},
): WebQaScore {
  const cells =
    overrides.cells ??
    CATEGORIES.flatMap((category) => SURFACES.map((surface) => cell(category, surface)));
  const base: QaScore = {
    projectId: 'project-1',
    at: AT,
    total: overrides.total ?? 72,
    cappedBy: overrides.cappedBy ?? 'security',
    cappingValue: overrides.cappingValue ?? 0,
    cells,
    surfaces: { backend: 0.8, frontend: 0.74, platform: 0.62 },
    rows: [
      ...CATEGORIES.map((category) => ({
        id: category,
        value: 0.8,
        weight: 0.16,
        includedCells: 3,
      })),
      { id: 'pyramid-shape', value: 0.42, weight: 0.04, includedCells: 3 },
    ],
    pyramid: {
      // **Shares, not counts.** `pyramidShape` divides the layer counts by the total
      // before it returns them, so an absolute count in this slot is a shape of
      // `12000 / 1800 / 400` and a drift of 1. A fixture that said 120 was a fixture
      // describing something the scorer never produces.
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

const PROJECT: RegisteredProject = {
  id: 'project-1',
  workspaceId: 'ws-1',
  name: 'Automate',
  slug: 'automate',
  repoPath: '/repos/automate',
  detectorVersion: 1,
  createdAt: AT,
};

function makeQa(overrides: Partial<QaClient> = {}): QaClient {
  const base: QaClient = {
    listProjects: async () => [PROJECT],
    getProject: async () => {
      throw new Error('not used by the cockpit');
    },
    getScore: async () => makeScore(),
    getGaps: async () => ({ gaps: [], cappedBy: 'security' }),
    getHollow: async () => ({ cells: [] }),
    getFlaky: async () => ({ cells: [] }),
    getStructure: async () => ({ findings: [] }),
    askCopilot: async () => {
      throw new Error('not used by the cockpit');
    },
    startRun: async () => {
      throw new Error('not used by the cockpit');
    },
  };
  return { ...base, ...overrides };
}

function renderCockpit(qa: QaClient, api: ApiClient = makeApi()): void {
  render(<Cockpit qa={qa} api={api} />);
}

describe('the limiter is the headline', () => {
  it('puts the limiting row above the total in the document, not beside it', async () => {
    renderCockpit(makeQa({ getScore: async () => makeScore({ cappedBy: 'security' }) }));

    const limiter = await screen.findByTestId('cockpit-limiter');
    const total = screen.getByTestId('cockpit-total');

    expect(limiter).toHaveTextContent('security');
    // **Ordering, asserted.** Rendering `72` as the hero number with the limiter as
    // grey small print underneath is still a lie of emphasis: the eye takes the big
    // number. Only a document-order assertion catches the difference.
    expect(limiter.compareDocumentPosition(total) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('explains why one term caps the total, and keeps the total as a footnote', async () => {
    renderCockpit(makeQa({ getScore: async () => makeScore({ cappedBy: 'security' }) }));

    const limiter = await screen.findByTestId('cockpit-limiter');
    expect(limiter).toHaveTextContent(/geometric mean/iu);
    expect(screen.getByTestId('cockpit-total')).toHaveTextContent('72.0');
  });

  it('says the limiter moved when nothing contributes a zero', async () => {
    renderCockpit(
      makeQa({ getScore: async () => makeScore({ cappedBy: 'unit', cappingValue: 0.41 }) }),
    );
    const limiter = await screen.findByTestId('cockpit-limiter');
    expect(limiter).toHaveTextContent('unit');
    expect(limiter).toHaveTextContent(/0\.41/u);
    // The zero sentence is absent, and that is the point: a shortfall of 0.41 does
    // not cap the total, so telling the reader a zero capped it would be a
    // different — and much more alarming — false claim.
    expect(limiter).not.toHaveTextContent(/one zero caps/iu);
  });
});

describe('a dimension nobody measured gets no colour', () => {
  it('renders a cell with no coverage as unmeasured rather than as a band', async () => {
    const cells = CATEGORIES.flatMap((category) =>
      SURFACES.map((surface) =>
        cell(category, surface, {
          score: 0,
          presence: 0,
          depth: 0,
          stability: 0,
          signal: 0,
          inputs: {
            ...cell(category, surface).inputs,
            // No coverage artifact was ingested. `null` is absence, not zero, and
            // over HTTP every cell's coverage component is structurally absent.
            surfaceCoverage: null,
            coverageTarget: null,
          },
        }),
      ),
    );
    renderCockpit(makeQa({ getScore: async () => makeScore({ cells, total: 0 }) }));

    const first = await screen.findByTestId('cell-unit:backend');
    expect(within(first).getByText('unmeasured')).toBeInTheDocument();
    // And **no confidence colour at all**: drawing a red or a green here would be
    // the dashboard asserting something about coverage that was never measured.
    const swatch = first.querySelector('[data-testid$="-swatch"]');
    expect(swatch?.getAttribute('class') ?? '').not.toMatch(/text-(success|warning|danger)/u);
  });

  it('keeps the colour for a cell whose coverage was measured', async () => {
    const cells = CATEGORIES.flatMap((category) =>
      SURFACES.map((surface) => cell(category, surface)),
    );
    renderCockpit(makeQa({ getScore: async () => makeScore({ cells }) }));

    const first = await screen.findByTestId('cell-unit:backend');
    expect(within(first).queryByText('unmeasured')).not.toBeInTheDocument();
    expect(first).toHaveTextContent(/cov 72\.0%/u);
  });

  it('marks a cell the project declared n/a as n/a, with no score at all', async () => {
    const cells = CATEGORIES.flatMap((category) =>
      SURFACES.map((surface) =>
        surface === 'frontend'
          ? cell(category, surface, { excluded: true, score: 0, presence: 0 })
          : cell(category, surface),
      ),
    );
    renderCockpit(makeQa({ getScore: async () => makeScore({ cells }) }));
    const excluded = await screen.findByTestId('cell-unit:frontend');
    expect(within(excluded).getByText('n/a')).toBeInTheDocument();
  });
});

describe('the queue and the strip', () => {
  it('queues a gap with its cheapest closure, ranked by what closing it is worth', async () => {
    const gaps: QaGapsResponse = {
      cappedBy: 'security',
      gaps: [
        {
          cell: 'security:backend',
          category: 'security',
          surface: 'backend',
          current: 0,
          potential: 0.5,
          cheapestClosure: 'Add one ZAP rule set and register the command.',
        },
        {
          cell: 'unit:platform',
          category: 'unit',
          surface: 'platform',
          current: 0.4,
          potential: 0.1,
          cheapestClosure: 'Platform has no unit suite.',
        },
      ],
    };
    renderCockpit(makeQa({ getGaps: async () => gaps }));

    const queue = await screen.findByTestId('cockpit-queue');
    const items = within(queue).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('security:backend');
    expect(items[0]).toHaveTextContent('Add one ZAP rule set and register the command.');
    expect(items[1]).toHaveTextContent('unit:platform');
  });

  it('lists a flaky cell with its fingerprints and rate', async () => {
    const flaky: QaFlakyResponse = {
      cells: [
        {
          cell: 'e2e:backend',
          flakyFingerprints: ['cart.spec.ts#adds', 'cart.spec.ts#removes'],
          flakeRate: 0.12,
          stability: 0.71,
        },
      ],
    };
    renderCockpit(makeQa({ getFlaky: async () => flaky }));

    const queue = await screen.findByTestId('cockpit-queue');
    expect(within(queue).getByText(/e2e:backend/u)).toBeInTheDocument();
    expect(within(queue).getByText(/12\.0% flake/iu)).toBeInTheDocument();
  });

  it('gives pyramid-shape its own strip rather than a sixteenth matrix cell', async () => {
    renderCockpit(makeQa());
    const strip = await screen.findByTestId('cockpit-pyramid');
    expect(strip).toHaveTextContent('pyramid-shape');
    expect(strip).toHaveTextContent(/0\.42/u);
    // Outside the grid, and the grid is 5 categories by 3 surfaces — one header row
    // plus the five.
    const matrix = screen.getByTestId('cockpit-matrix');
    expect(matrix).not.toContainElement(strip);
    expect(within(matrix).getAllByRole('row')).toHaveLength(CATEGORIES.length + 1);
    expect(screen.queryByTestId('cell-pyramid-shape:backend')).not.toBeInTheDocument();
  });

  it('says the pyramid has no declared target rather than inventing one', async () => {
    renderCockpit(makeQa());
    const strip = await screen.findByTestId('cockpit-pyramid');
    expect(strip).toHaveTextContent(/none declared, so no drift is claimed/iu);
  });
});

/**
 * The pass rate is a percentage on the wire and must stay one.
 *
 * **Found by the G4 screenshot gate, not by a test.** `e2e/accessibility/routes.spec.ts`
 * seeds three runs and photographs the cockpit, and the photograph says **6700.0%** for a
 * run set that passed two of three. Every unit test agreed, because the one mock that
 * exercised this number used the wrong shape: `Cockpit.test.tsx` had `passRate: 0.94`,
 * while the API returns `50`, `75`, `100` — see `apps/api/src/modules/dashboard/analytics.test.ts`
 * — and `apps/web/src/routes/dashboard/analytics.tsx` renders it as `{data.passRate}%`
 * without touching it. So the cockpit was the only place treating a 0–100 value as a
 * fraction, and multiplying it by 100 a second time.
 *
 * The assertion is on the rendered string rather than on the helper, because the helper is
 * correct for every *other* number on the screen — `surfaceCoverage` and `flakeRate` really
 * are fractions. That is why the bug survived: one correct helper, used once wrongly.
 */
describe('the headline pass rate keeps the shape the API sends it in', () => {
  it('renders a percentage from the API as that percentage', async () => {
    const api = makeApi({
      getAnalyticsSummary: async () => ({ totalRuns: 3, passRate: 67, avgDurationMs: 1_200 }),
    });
    renderCockpit(makeQa(), api);

    const card = await screen.findByTestId('cockpit-stat-pass');
    expect(card).toHaveTextContent('67.0%');
    // Named, because a bare `not.toContain` would also pass on an empty card.
    expect(card).not.toHaveTextContent(/6700|6\.7|0\.67/iu);
  });

  it('renders a whole-numbered perfect run as 100%, not 10000%', async () => {
    const api = makeApi({
      getAnalyticsSummary: async () => ({ totalRuns: 1, passRate: 100, avgDurationMs: 10 }),
    });
    renderCockpit(makeQa(), api);
    expect(await screen.findByTestId('cockpit-stat-pass')).toHaveTextContent('100.0%');
  });

  it('still scales the values that really are fractions', async () => {
    // `surfaceCoverage` is a 0–1 fraction — `0.72` in the `cell()` fixture — and `percent()`
    // is right for it. If the pass-rate fix were made by deleting the helper, this is the
    // assertion that would notice, so it is here rather than left implicit.
    renderCockpit(makeQa());
    expect(await screen.findByTestId('cell-unit:backend')).toHaveTextContent('cov 72.0%');
  });
});

describe('five parallel fetches and their failures', () => {
  it('reads all five endpoints for the project it is showing', async () => {
    const seen: string[] = [];
    const qa = makeQa({
      getScore: async () => {
        seen.push('score');
        return makeScore();
      },
      getGaps: async () => {
        seen.push('gaps');
        return { gaps: [], cappedBy: 'security' };
      },
      getFlaky: async () => {
        seen.push('flaky');
        return { cells: [] };
      },
    });
    const api = makeApi({
      getAnalyticsSummary: async () => {
        seen.push('analytics');
        // **0–100, not 0–1** — the API's shape. This mock read `0.94` for years, and that
        // wrong shape is the only reason a 6700% pass rate shipped: the cockpit multiplied
        // a percentage by 100 and the fixture agreed with it.
        return { totalRuns: 7, passRate: 94, avgDurationMs: 1200 };
      },
      getQuarantine: async () => {
        seen.push('quarantine');
        return [];
      },
    });
    renderCockpit(qa, api);
    await screen.findByTestId('cockpit-limiter');
    expect(seen.sort()).toEqual(['analytics', 'flaky', 'gaps', 'quarantine', 'score']);
  });

  it('names the endpoint that failed rather than rendering nothing for it', async () => {
    renderCockpit(
      makeQa({
        getScore: async () => {
          throw new Error('No such project');
        },
      }),
    );
    const alert = await screen.findByTestId('cockpit-failures');
    expect(alert).toHaveTextContent('qa/score');
    expect(alert).toHaveTextContent('No such project');
    // The other four still render, and the ones whose own read failed say `unread`
    // rather than `0` — a failed read is not a measurement of zero, and the
    // difference is the whole reason this screen lists failures instead of
    // collapsing to an empty state. The gaps tile read zero because the queue
    // *answered* zero, which is a different claim and has to look different.
    await waitFor(() => expect(screen.getByTestId('cockpit-total')).toHaveTextContent('unread'));
    expect(screen.getByTestId('cockpit-stat-gaps')).toHaveTextContent('Gaps0');
    expect(screen.getByTestId('cockpit-stat-pass')).toHaveTextContent('0.0%');
    expect(screen.getByTestId('cockpit-queue')).toBeInTheDocument();
    expect(screen.queryByTestId('cockpit-matrix')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cockpit-pyramid')).not.toBeInTheDocument();
  });
});

describe('onboarding is a screen, not an empty grid', () => {
  it('names the two ways to get a project when there is none', async () => {
    renderCockpit(makeQa({ listProjects: async () => [] }));
    const onboarding = await screen.findByTestId('cockpit-onboarding');
    expect(onboarding).toHaveTextContent(/AUTOMATE_PROJECT_ROOT/u);
    expect(onboarding).toHaveTextContent(/POST \/api\/v1\/projects/u);
    // And **not** an empty matrix: a grid of nothing cannot tell an empty repository
    // from a broken install, and those need different responses.
    expect(screen.queryByTestId('cockpit-matrix')).not.toBeInTheDocument();
  });

  it('shows which folder it is reporting on, so the choice is visible', async () => {
    renderCockpit(makeQa());
    const header = await screen.findByTestId('cockpit-subject');
    expect(header).toHaveTextContent('Automate');
    expect(header).toHaveTextContent('/repos/automate');
  });

  it('says the path is unrecorded rather than printing "undefined"', async () => {
    renderCockpit(makeQa({ listProjects: async () => [{ ...PROJECT, repoPath: null }] }));
    expect(await screen.findByTestId('cockpit-subject')).toHaveTextContent(
      'no repository path recorded',
    );
  });

  it('reports an unreadable registry, and does not claim there is nothing there', async () => {
    renderCockpit(
      makeQa({
        listProjects: async () => {
          throw new Error('database is not accepting connections');
        },
      }),
    );
    // **Not the onboarding screen.** "No project" and "cannot ask" are different
    // answers with different responses — one needs a folder, the other needs an
    // operator — and collapsing them would send a reader down the wrong road.
    expect(await screen.findByTestId('cockpit-registry-error')).toHaveTextContent(
      'database is not accepting connections',
    );
    expect(screen.queryByTestId('cockpit-onboarding')).not.toBeInTheDocument();
  });
});

describe('which project it is reporting on', () => {
  it('reports on the named project when one is asked for', async () => {
    const other: RegisteredProject = { ...PROJECT, id: 'project-2', name: 'Payments' };
    const qa = makeQa({ listProjects: async () => [PROJECT, other] });
    render(<Cockpit qa={qa} api={makeApi()} projectId="project-2" />);
    const header = await screen.findByTestId('cockpit-subject');
    expect(header).toHaveTextContent('Payments');
  });

  it('reports on the first registered project when none is named', async () => {
    const other: RegisteredProject = { ...PROJECT, id: 'project-2', name: 'Payments' };
    renderCockpit(makeQa({ listProjects: async () => [PROJECT, other] }));
    expect(await screen.findByTestId('cockpit-subject')).toHaveTextContent('Automate');
  });
});

describe('the bands, read from the score rather than asserted on', () => {
  it('gives thin and failing their own colours', async () => {
    const byCategory: Record<string, number> = {
      unit: 0.9,
      integration: 0.45,
      e2e: 0.45,
      performance: 0.45,
      security: 0.1,
    };
    const cells = CATEGORIES.flatMap((category) =>
      SURFACES.map((surface) => {
        const score = byCategory[category] ?? 0;
        return cell(category, surface, { score, presence: 1, depth: score });
      }),
    );
    renderCockpit(makeQa({ getScore: async () => makeScore({ cells }) }));
    const matrix = await screen.findByTestId('cockpit-matrix');
    expect(within(matrix).getByTestId('cell-unit:backend-swatch')).toHaveAttribute(
      'aria-label',
      'unit:backend: healthy',
    );
    expect(within(matrix).getByTestId('cell-e2e:backend-swatch')).toHaveAttribute(
      'aria-label',
      'e2e:backend: thin',
    );
    expect(within(matrix).getByTestId('cell-security:backend-swatch')).toHaveAttribute(
      'aria-label',
      'security:backend: failing',
    );
  });

  it('ranks equal-potential gaps by name, so the order is reproducible', async () => {
    const gaps: QaGapsResponse = {
      cappedBy: 'unit',
      gaps: [
        {
          cell: 'unit:platform',
          category: 'unit',
          surface: 'platform',
          current: 0.2,
          potential: 0.4,
          cheapestClosure: 'b',
        },
        {
          cell: 'unit:backend',
          category: 'unit',
          surface: 'backend',
          current: 0.1,
          potential: 0.4,
          cheapestClosure: 'a',
        },
      ],
    };
    renderCockpit(makeQa({ getGaps: async () => gaps }));
    const items = within(await screen.findByTestId('cockpit-queue')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('unit:backend');
  });

  it('ranks equal-rate flaky cells by name', async () => {
    const flaky: QaFlakyResponse = {
      cells: [
        {
          cell: 'e2e:platform',
          flakyFingerprints: ['p'],
          flakeRate: 0.1,
          stability: 0.8,
        },
        {
          cell: 'e2e:backend',
          flakyFingerprints: ['b'],
          flakeRate: 0.1,
          stability: 0.9,
        },
      ],
    };
    renderCockpit(makeQa({ getFlaky: async () => flaky }));
    const items = within(await screen.findByTestId('cockpit-queue')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('e2e:backend');
  });

  it('says nothing is queued when both reads failed, rather than claiming health', async () => {
    renderCockpit(
      makeQa({
        getGaps: async () => {
          throw new Error('gone');
        },
        getFlaky: async () => {
          throw new Error('gone');
        },
      }),
    );
    const queue = await screen.findByTestId('cockpit-queue');
    expect(queue).toHaveTextContent('no cell is below its target');
    // The failures list is right above it, so "nothing is queued" cannot be mistaken
    // for a measurement.
    expect(screen.getByTestId('cockpit-failures')).toHaveTextContent('2 of five reads failed');
  });
});

describe('a client that throws rather than rejects', () => {
  it('says the cockpit could not be read, instead of rendering five empty tiles', async () => {
    // `Promise.allSettled` cannot reject, so the only way `loadFive` rejects is a
    // client that **throws synchronously** while the five calls are being built. That
    // is a real shape for a broken client, and the branch is worth its one test
    // precisely because `allSettled` is what made it otherwise unreachable.
    const qa = makeQa({
      getScore: () => {
        throw new Error('client misconfigured');
      },
    });
    renderCockpit(qa);
    expect(await screen.findByTestId('cockpit-load-error')).toHaveTextContent(
      'client misconfigured',
    );
  });
});

describe('the pyramid strip', () => {
  it('reports drift against a declared target when the project chose one', async () => {
    const score = makeScore();
    const withTarget = QaScoreSchema.parse({
      ...score,
      pyramid: { ...score.pyramid, declaredTarget: { unit: 0.7, integration: 0.2, e2e: 0.1 } },
    });
    renderCockpit(makeQa({ getScore: async () => withTarget }));
    const strip = await screen.findByTestId('cockpit-pyramid');
    expect(strip).toHaveTextContent(/Target 70% \/ 20% \/ 10%/u);
    expect(strip).not.toHaveTextContent('no declared target');
    // And the row's own weight and cell count, so the strip says how much of the
    // total the shape is actually worth.
    expect(strip).toHaveTextContent(/weight 0\.04/u);
    expect(strip).toHaveTextContent(/3 cells included/u);
  });

  /**
   * Red first, from a screenshot.
   *
   * `pyramid.observed` and `pyramid.target` are **share vectors**, not test counts —
   * `PyramidTarget` is bounded `[0,1]` and `pyramidShape` divides by the total before
   * it compares. Printed raw, the strip said `Observed 0.8148148148148148 unit`, which
   * reads as a count of tests and is sixteen digits of a fraction nobody asked for.
   */
  it('prints the pyramid as percentages, never as raw shares', async () => {
    renderCockpit(makeQa());
    const strip = await screen.findByTestId('cockpit-pyramid');
    const text = strip.textContent ?? '';
    expect(text).toMatch(/Observed 80% \/ 15% \/ 5% unit \/ integration \/ e2e/u);
    // The failing assertion, and the one that generalises: no bare float.
    expect(text).not.toMatch(/\d\.\d{4,}/u);
    // And it must not be labelled as a count of tests.
    expect(text).not.toMatch(/Observed 8000% unit/u);
  });
});

/**
 * The cockpit's figures, its prose, and its one drawing that has to stop looking broken.
 *
 * Three separate defects, each of which a numeric assertion alone would have missed. The
 * local `mount` below takes the coverage of one cell and a queue to read, so each case can
 * state the *state* it is about rather than relying on whichever fixture the shared
 * `makeScore` happened to build.
 */
function mount(overrides: { coverage?: number | null; withQueue?: boolean } = {}) {
  const coverage = overrides.coverage === undefined ? 0.72 : overrides.coverage;
  const first = CATEGORIES[0];
  const surface = SURFACES[0];
  if (first === undefined || surface === undefined) throw new Error('the contract has no cells');

  const cells = CATEGORIES.flatMap((category) =>
    SURFACES.map((candidate) => {
      const built = cell(category, candidate);
      return category === first && candidate === surface
        ? {
            ...built,
            inputs: { ...built.inputs, surfaceCoverage: coverage },
          }
        : built;
    }),
  );

  const qa = makeQa({
    getScore: async () => makeScore({ cells }),
    getGaps: async () => ({
      gaps:
        overrides.withQueue === false
          ? []
          : [
              {
                cell: `${first}:${surface}`,
                category: first,
                surface,
                current: 0.42,
                potential: 0.38,
                cheapestClosure: 'Add the missing contract test.',
              },
            ],
      cappedBy: 'security',
    }),
    getFlaky: async () => ({ cells: [] }),
  });
  return render(<Cockpit qa={qa} api={makeApi()} />);
}

/** Every element whose entire content is a figure, wherever it sits in the tree. */
/**
 * Is this string a figure?
 *
 * **Written as a reader rather than a regex, deliberately.** The obvious shape nests an
 * optional group behind a `+` \u2014 the exact backtracking shape
 * `security/detect-unsafe-regex` refuses, and the rule is right to.
 * `theme.test.ts`'s `isSizeArgument` already answers this rule the same way, by reading the
 * suffix and then asking `Number` about the rest, so this is the house answer rather than a
 * new one.
 *
 * The accepted set is deliberately small: a sign, digits with thousands and decimal
 * separators, and one of four suffixes. `run-1` is not a figure, neither is an empty string,
 * and a lone `%` is not a figure either.
 */
function isFigureText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  let body = trimmed;
  for (const suffix of ['%', '\u00d7', 'pts', 'pt']) {
    if (body.endsWith(suffix)) {
      body = body.slice(0, -suffix.length).trimEnd();
      break;
    }
  }
  if (body.length === 0) return false;
  const signless =
    body.startsWith('+') || body.startsWith('-') || body.startsWith('\u2212')
      ? body.slice(1)
      : body;
  if (signless.length === 0) return false;
  // At least one digit, and nothing but digits and separators \u2014 two passes over a
  // fixed alphabet rather than one pattern, which is the property the rule wants.
  let digits = 0;
  for (const character of signless) {
    if (character >= '0' && character <= '9') {
      digits += 1;
      continue;
    }
    if (character === '.' || character === ',') continue;
    return false;
  }
  return digits > 0;
}

function figureElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('*')).filter(
    (element) => element.children.length === 0 && isFigureText(element.textContent ?? ''),
  );
}

/** True when `element` or anything above it is drawn in tabular numerals. */
function inTabularNumerals(element: HTMLElement, root: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
    if (node.classList.contains('tabular-nums')) return true;
    if (node === root) break;
  }
  return false;
}

describe('the cockpit renders numbers that do not move', () => {
  it('sets every figure it draws in tabular numerals', async () => {
    const view = mount();
    await waitFor(() => expect(screen.getByTestId('cockpit')).toBeInTheDocument());
    const offenders = figureElements(view.container)
      .filter((element) => !inTabularNumerals(element, view.container))
      .map((element) => `${element.tagName.toLowerCase()}"${element.textContent?.trim()}"`);
    expect(
      offenders,
      'a figure that is not in tabular numerals shifts sideways as it updates. The site has set ' +
        'tabular-nums on its table cells since it was written; the product has set it nowhere.',
    ).toEqual([]);
  });

  it('aligns a numeric matrix cell to the right, in the reading face', async () => {
    const view = mount();
    await waitFor(() => expect(screen.getByTestId('cockpit-matrix')).toBeInTheDocument());
    const cell = view.container.querySelector(
      '[data-testid="cockpit-matrix"] tbody td:nth-child(2)',
    );
    expect(cell, 'the matrix has no numeric cell').not.toBeNull();
    expect(cell).toHaveClass('tabular-nums', 'text-right', 'font-mono');
  });
});

describe('the cockpit wraps its prose and caps it', () => {
  it('balances the heading and prettifies the line under it', async () => {
    const view = mount();
    await waitFor(() => expect(screen.getByTestId('cockpit')).toBeInTheDocument());
    const heading = view.container.querySelector('h1');
    expect(heading, 'the cockpit has no h1').not.toBeNull();
    expect(heading).toHaveClass('text-balance');
    expect(view.container.querySelector('[data-testid="cockpit-subject"]')).toHaveClass(
      'text-pretty',
    );
  });

  it('caps the explanatory paragraph at the declared measure', async () => {
    const view = mount();
    await waitFor(() => expect(screen.getByTestId('cockpit-limiter')).toBeInTheDocument());
    const paragraphs = Array.from(
      view.container.querySelectorAll<HTMLElement>('[data-testid="cockpit-limiter"] p'),
    );
    const prose = paragraphs.filter((paragraph) => /max-w-measure/.test(paragraph.className));
    expect(
      prose.length,
      'the limiter explains itself in two sentences and neither is capped, so the measure ' +
        "theme.css declares reaches no prose on the product's own screen",
    ).toBeGreaterThan(0);
  });
});

describe('an unmeasured cell does not look like a broken image', () => {
  /**
   * The defect this replaces.
   *
   * `Cockpit.tsx:504` drew the "no band at all" state as a **solid 40×12 bar in the muted
   * ink**. At a glance that is a failed image load: a flat rectangle with nothing inside it,
   * in a row where every other cell is a coloured bar, on a screen whose whole claim is
   * that a measurement which did not happen is not a measurement. The screenshot review in
   * the glass plan named it as "reads as a broken-image placeholder", and no assertion had
   * caught it, because every existing assertion was about *which colour* the cell used and
   * this cell correctly uses none.
   *
   * The replacement draws no bar: an outlined placeholder the width of the others, so the
   * row still reads as a table and the cell reads as empty on purpose.
   */
  it('draws an outlined placeholder rather than a solid bar, and says not measured', async () => {
    const view = mount({ coverage: null });
    await waitFor(() => expect(screen.getByTestId('cockpit-matrix')).toBeInTheDocument());
    const first = CATEGORIES[0];
    const surface = SURFACES[0];
    if (first === undefined || surface === undefined) throw new Error('the contract has no cells');
    const cell = view.container.querySelector(`[data-testid="cell-${first}:${surface}"]`);
    expect(cell).not.toBeNull();
    const rect = cell?.querySelector('rect');
    expect(rect).not.toBeNull();
    expect(rect?.getAttribute('fill')).toBe('none');
    expect(rect?.getAttribute('stroke')).toBe('currentColor');
    expect(cell).toHaveTextContent('unmeasured');
  });

  it('still draws a solid bar for a cell that was measured', async () => {
    const view = mount({ coverage: 0.8 });
    await waitFor(() => expect(screen.getByTestId('cockpit-matrix')).toBeInTheDocument());
    const rect = view.container.querySelector('[data-testid$="-swatch"] rect');
    expect(rect?.getAttribute('fill')).toBe('currentColor');
  });
});

describe('the queue rows are hoverable, because a list a person scans has to be trackable', () => {
  it('gives a queue row a hover treatment', async () => {
    const view = mount();
    await waitFor(() => expect(screen.getByTestId('cockpit-queue')).toBeInTheDocument());
    const row = view.container.querySelector('[data-testid^="queue-gap-"]');
    expect(row).not.toBeNull();
    expect(
      /hover:bg-|hover:border-|hover:text-/.test(row?.className ?? ''),
      'a queue row has no hover treatment, so the list is a wall of identical rows and the eye ' +
        'has nothing to track while scanning it',
    ).toBe(true);
  });
});
