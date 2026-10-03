import { describe, expect, it } from 'vitest';

import {
  QaScoreSchema,
  type ScoreCell,
  ScoreCellKeySchema,
  ScoreDeltaSchema,
  ScoreProvenanceSchema,
  type QaScore,
} from './qa-score.js';

/**
 * The category and surface lists, restated here rather than imported.
 *
 * `@automate/projects` imports `@automate/shared-contracts`, so importing the
 * other way would be a cycle between the contract and its first consumer — and a
 * cycle in this repository has already cost a schema test failing whenever one
 * of two copies of a list was edited without the other (`RUN_PHASES` in
 * `phase-outcome.ts` and `dashboard.ts`). The duplication here is deliberate,
 * it is three and five literal strings, and the assertions below fail if either
 * list is changed without this one.
 */
const SCORE_CATEGORIES = ['unit', 'integration', 'e2e', 'performance', 'security'] as const;
const SCORE_SURFACES = ['backend', 'frontend', 'platform'] as const;

/**
 * A complete score, built from the product's own vocabulary rather than a
 * hand-written list — the `RUN_PHASES` duplication this repository has already
 * paid for once (`phase-outcome.ts` and `dashboard.ts` each held a list, and a
 * schema test failed whenever one was edited without the other).
 */
const cells: readonly ScoreCell[] = SCORE_CATEGORIES.flatMap((category) =>
  SCORE_SURFACES.map(
    (surface): ScoreCell => ({
      key: `${category}:${surface}`,
      category,
      surface,
      score: 0.5,
      presence: 1,
      depth: 0.5,
      stability: 1,
      signal: 0.5,
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
        qualifyingRuns: 3,
      },
    }),
  ),
);

const validScore: QaScore = {
  projectId: 'project-1',
  at: '2026-10-02T00:00:00.000Z',
  total: 62,
  cappedBy: 'security',
  cappingValue: 0,
  cells,
  surfaces: { backend: 0.5, frontend: 0.5, platform: 0.5 },
  rows: [
    ...SCORE_CATEGORIES.map((category) => ({
      id: category,
      value: 0.5,
      weight: 0.18,
      includedCells: 3,
    })),
    { id: 'pyramid-shape' as const, value: 0.8, weight: 0.1, includedCells: 15 },
  ],
  pyramid: {
    observed: { unit: 0.7, integration: 0.2, e2e: 0.1 },
    target: { unit: 0.7, integration: 0.2, e2e: 0.1 },
    // The project declared no target, so the default is what a chart draws against
    // and "nothing was chosen" is what the copilot must hear.
    declaredTarget: null,
    shape: 1,
    drift: 0,
  },
  gaps: [
    {
      cell: 'security:backend',
      category: 'security',
      surface: 'backend',
      current: 0,
      potential: 0.4,
      cheapestClosure: 'No suite has completed a run for security:backend.',
    },
  ],
  findings: [
    {
      kind: 'dominant_cell',
      statement: '90% of the e2e tests are in e2e:backend.',
      cells: ['e2e:backend'],
      impact: 0.1,
    },
  ],
  provenance: {
    projectId: 'project-1',
    detectorVersion: 1,
    runsRead: 12,
    resultsRead: 480,
    infraFailedRuns: ['run-7'],
    infraFailedRate: 1 / 12,
    quarantinedFingerprints: [],
    outcomeCounts: { passed: 470, failed: 10 },
  },
  weights: {
    cell: { depth: 0.4, stability: 0.4, signal: 0.2 },
    rows: { unit: 0.18, integration: 0.18, e2e: 0.18, performance: 0.18, security: 0.18 },
    pyramid: 0.1,
  },
};

describe('the score contract', () => {
  it('accepts a complete score', () => {
    expect(QaScoreSchema.safeParse(validScore).success).toBe(true);
  });

  it('requires the capping term, because the total alone cannot be diagnosed', () => {
    // This is the single most load-bearing clause in the file. The total is a
    // weighted *geometric* mean: it cannot dilute a zero, and for exactly that
    // reason it cannot be explained either. A client that renders `62` without
    // `capped by Security (0)` is showing an arithmetic score's worth of
    // information from a geometric formula, and the reader has no reason to
    // distrust it.
    for (const field of ['cappedBy', 'cappingValue']) {
      const without = { ...validScore, [field]: undefined };
      expect(QaScoreSchema.safeParse(without).success, `${field} must be required`).toBe(false);
    }
  });

  it('carries every component on every cell, so a client never re-derives one', () => {
    const parsed = QaScoreSchema.parse(validScore);
    for (const cell of parsed.cells) {
      expect(cell.presence).toBeTypeOf('number');
      expect(cell.depth).toBeTypeOf('number');
      expect(cell.stability).toBeTypeOf('number');
      expect(cell.signal).toBeTypeOf('number');
    }
  });

  it('requires all 15 cells, so a client cannot render a partial matrix', () => {
    expect(QaScoreSchema.safeParse({ ...validScore, cells: cells.slice(0, 14) }).success).toBe(
      false,
    );
  });

  it('requires all six rows, pyramid included', () => {
    expect(
      QaScoreSchema.safeParse({ ...validScore, rows: validScore.rows.slice(0, 5) }).success,
    ).toBe(false);
  });

  it('rejects a cell key that is not category:surface', () => {
    expect(ScoreCellKeySchema.safeParse('unit').success).toBe(false);
    expect(ScoreCellKeySchema.safeParse('smoke:backend').success).toBe(false);
    expect(ScoreCellKeySchema.safeParse('unit:mobile').success).toBe(false);
    expect(ScoreCellKeySchema.safeParse('unit:backend').success).toBe(true);
  });

  it('distinguishes an unmeasured coverage from a measured zero', () => {
    // `null` and `0` are different claims: "no coverage artifact was ingested"
    // and "coverage was measured and is zero". Collapsing them would make every
    // repository without a coverage plugin read as having no covered surface.
    const withNull = QaScoreSchema.safeParse(validScore).success;
    expect(withNull).toBe(true);
    const zeroed: QaScore = {
      ...validScore,
      cells: cells.map((cell) => ({
        ...cell,
        inputs: { ...cell.inputs, surfaceCoverage: 0 },
      })),
    };
    expect(QaScoreSchema.safeParse(zeroed).success).toBe(true);
  });

  it('marks an excluded cell rather than omitting it, so the matrix stays 6×3', () => {
    const withExcluded: QaScore = {
      ...validScore,
      cells: cells.map((cell) =>
        cell.key === 'security:frontend' ? { ...cell, excluded: true, score: 0 } : cell,
      ),
    };
    const parsed = QaScoreSchema.parse(withExcluded);
    expect(parsed.cells).toHaveLength(15);
    expect(parsed.cells.find((cell) => cell.key === 'security:frontend')?.excluded).toBe(true);
  });

  it('keeps infra failures in their own provenance field', () => {
    const provenance = ScoreProvenanceSchema.parse(validScore.provenance);
    expect(provenance.infraFailedRuns).toEqual(['run-7']);
    // And there is no `failRate` field at all, so a client cannot fold one in by
    // accident: the only place an infra failure can appear is its own rate.
    expect(Object.keys(provenance)).not.toContain('failRate');
  });
});

describe('the score diff, which reports causes rather than deltas', () => {
  const delta = {
    projectId: 'project-1',
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-02T00:00:00.000Z',
    previousTotal: 66,
    currentTotal: 62,
    previousCappedBy: 'security' as const,
    currentCappedBy: 'security' as const,
    contributions: [
      {
        scope: 'cell' as const,
        key: 'security:backend',
        before: 0.2,
        after: 0,
        cause: '3 target files gained no coverage after commit abc',
        evidence: ['run-7', 'commit:abc', 'src/billing.ts'],
      },
    ],
  };

  it('accepts a diff that names an input and cites evidence', () => {
    expect(ScoreDeltaSchema.safeParse(delta).success).toBe(true);
  });

  it('rejects a contribution with no evidence, at the schema', () => {
    // The copilot's hard rule — "a recommendation that cannot cite a row does not
    // render" — applied to the diff itself. A contribution with an empty
    // `evidence` array is a number with no story, and accepting it here would
    // make the rule a UI convention rather than a contract.
    const without = { ...delta, contributions: [{ ...delta.contributions[0], evidence: [] }] };
    expect(ScoreDeltaSchema.safeParse(without).success).toBe(false);
  });

  it('rejects a contribution with no cause sentence', () => {
    const without = { ...delta, contributions: [{ ...delta.contributions[0], cause: '' }] };
    expect(ScoreDeltaSchema.safeParse(without).success).toBe(false);
  });

  it('refuses a payload whose total and limiter disagree about why', () => {
    // `total: 0` with a **positive** `cappingValue` is a payload whose two fields
    // contradict each other. A geometric mean that reached zero did so because a row
    // contributed zero, so the limiter must be zero — and a client rendering
    // "0/100, capped by Unit (0.3)" would be showing a cause for a number the
    // formula cannot produce.
    expect(
      QaScoreSchema.safeParse({ ...validScore, total: 0, cappedBy: 'unit', cappingValue: 0.3 })
        .success,
    ).toBe(false);
  });

  it('accepts a zero total whose limiter is the zero row', () => {
    expect(QaScoreSchema.safeParse({ ...validScore, total: 0, cappingValue: 0 }).success).toBe(
      true,
    );
  });

  it('accepts a non-zero total with a non-zero limiter', () => {
    expect(
      QaScoreSchema.safeParse({ ...validScore, total: 48.5, cappedBy: 'unit', cappingValue: 0.3 })
        .success,
    ).toBe(true);
  });

  it('carries the capping term at both ends, so a diff cannot hide a changed limiter', () => {
    expect(ScoreDeltaSchema.safeParse(delta).success).toBe(true);
    expect(ScoreDeltaSchema.safeParse({ ...delta, currentCappedBy: undefined }).success).toBe(
      false,
    );
  });
});
