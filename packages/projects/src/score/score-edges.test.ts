import { describe, expect, it } from 'vitest';

import { diffScores } from './diff.js';
import { flakeRate, type OutcomeObservation } from './flaky.js';
import { geometricMean, geometricRowWeights, type ScoreRow } from './geometric.js';
import { classifyHollow } from './hollow.js';
import { isPyramidBalanced, pyramidShape } from './pyramid.js';
import { score } from './index.js';
import { findStructural, isEmptyCell } from './structural.js';
import type { CellComponents } from './cell.js';
import {
  DEFAULT_WEIGHTS,
  type CanonicalTestResult,
  type ScoreInputs,
  type ScoreWeights,
} from './types.js';

const row = (id: ScoreRow['id'], value: number, includedCells = 1): ScoreRow => ({
  id,
  value,
  weight: 0.2,
  includedCells,
});

describe('geometricRowWeights', () => {
  it('splits the category budget equally when every declared weight is zero', () => {
    const weights: ScoreWeights = {
      ...DEFAULT_WEIGHTS,
      pyramid: 0.5,
      rows: { unit: 0, integration: 0, e2e: 0, performance: 0, security: 0 },
    };
    const result = geometricRowWeights(weights);
    expect(result['unit']).toBeCloseTo(0.1, 12);
    expect(result['security']).toBeCloseTo(0.1, 12);
    expect(result['pyramid-shape']).toBe(0.5);
  });

  it('always sums to one', () => {
    const weights: ScoreWeights = {
      ...DEFAULT_WEIGHTS,
      rows: { unit: 5, integration: 1, e2e: 0, performance: 2, security: 2 },
    };
    const total = Object.values(geometricRowWeights(weights)).reduce(
      (sum, value) => sum + value,
      0,
    );
    expect(total).toBeCloseTo(1, 12);
  });
});

describe('geometricMean', () => {
  it('is zero and capped by the pyramid when no row has a scored cell', () => {
    const rows = [row('unit', 1, 0), row('pyramid-shape', 1, 0)];
    expect(geometricMean(rows, DEFAULT_WEIGHTS)).toEqual({
      total: 0,
      cappedBy: 'pyramid-shape',
      cappingValue: 0,
      rows,
    });
  });

  it('is zero and names the row at zero, however good the others are', () => {
    const result = geometricMean(
      [row('unit', 1), row('security', 0), row('e2e', 1)],
      DEFAULT_WEIGHTS,
    );
    expect(result).toMatchObject({ total: 0, cappedBy: 'security', cappingValue: 0 });
  });

  it('also treats a negative row as a zero rather than taking its logarithm', () => {
    expect(geometricMean([row('unit', -0.5), row('e2e', 1)], DEFAULT_WEIGHTS).total).toBe(0);
  });

  it('is 100 when every scored row is perfect', () => {
    const result = geometricMean([row('unit', 1), row('e2e', 1)], DEFAULT_WEIGHTS);
    expect(result.total).toBeCloseTo(100, 10);
  });

  it('ignores a row with no included cell instead of scoring it as zero', () => {
    const result = geometricMean([row('unit', 0.5), row('e2e', 0, 0)], DEFAULT_WEIGHTS);
    expect(result.total).toBeCloseTo(50, 10);
    expect(result.cappedBy).toBe('unit');
  });

  it('names the row with the largest weighted shortfall, not the smallest value', () => {
    // security: weight 0.9 * log(0.5) is a bigger shortfall than unit: 0.1 * log(0.4).
    const weights: ScoreWeights = {
      ...DEFAULT_WEIGHTS,
      pyramid: 0,
      rows: { unit: 0.1, integration: 0, e2e: 0, performance: 0, security: 0.9 },
    };
    const result = geometricMean([row('unit', 0.4), row('security', 0.5)], weights);
    expect(result.cappedBy).toBe('security');
    expect(result.cappingValue).toBe(0.5);
  });

  it('never returns NaN when the scored rows carry no weight at all', () => {
    const weights: ScoreWeights = {
      ...DEFAULT_WEIGHTS,
      pyramid: 1,
      rows: { unit: 0, integration: 0, e2e: 0, performance: 0, security: 0 },
    };
    const total = geometricMean([row('unit', 0.5)], weights).total;
    expect(Number.isNaN(total)).toBe(false);
    expect(total).toBeGreaterThanOrEqual(0);
    expect(total).toBeLessThanOrEqual(100);
  });
});

describe('pyramidShape', () => {
  it('reads a layer missing from the record as zero tests', () => {
    const partial = { unit: 10 } as unknown as Record<'unit' | 'integration' | 'e2e', number>;
    const verdict = pyramidShape(partial);
    expect(verdict.observed).toEqual({ unit: 1, integration: 0, e2e: 0 });
    // drift = |1-0.7| + |0-0.2| + |0-0.1| = 0.6; shape = 1 - 0.3
    expect(verdict.shape).toBeCloseTo(0.7, 12);
  });

  it('reads a layer missing from a declared target as a target of zero', () => {
    const declared = { unit: 1 } as unknown as Record<'unit' | 'integration' | 'e2e', number>;
    const verdict = pyramidShape({ unit: 5, integration: 5, e2e: 0 }, declared);
    // observed 0.5/0.5/0 vs 1/0/0 -> drift 1.0 -> shape 0.5
    expect(verdict.shape).toBeCloseTo(0.5, 12);
    expect(verdict.declaredTarget).toEqual(declared);
  });

  it('is perfect on target and never below zero', () => {
    expect(pyramidShape({ unit: 7, integration: 2, e2e: 1 }).shape).toBeCloseTo(1, 12);
    expect(
      pyramidShape({ unit: 0, integration: 0, e2e: 4 }, { unit: 1, integration: 0, e2e: 0 }).shape,
    ).toBe(0);
  });

  it('reports no declared target for an empty suite without one, and the target when it has one', () => {
    const empty = pyramidShape({ unit: 0, integration: 0, e2e: 0 });
    expect(empty).toMatchObject({ shape: 0, drift: 1, declaredTarget: null });
    const declared = { unit: 0.5, integration: 0.5, e2e: 0 };
    expect(pyramidShape({ unit: 0, integration: 0, e2e: 0 }, declared)).toMatchObject({
      shape: 0,
      declaredTarget: declared,
      observed: declared,
    });
  });
});

describe('isPyramidBalanced', () => {
  it('accepts shares that sum to one within rounding and rejects the rest', () => {
    expect(isPyramidBalanced({ unit: 0.7, integration: 0.2, e2e: 0.1 })).toBe(true);
    expect(isPyramidBalanced({ unit: 0.7, integration: 0.2, e2e: 0.2 })).toBe(false);
    expect(isPyramidBalanced({ unit: 0.5 } as never)).toBe(false);
  });
});

const hollowResult = (overrides: Partial<CanonicalTestResult> = {}): CanonicalTestResult => ({
  fingerprint: 'f',
  runId: 'r',
  commitSha: 'c',
  category: 'unit',
  surface: 'backend',
  outcome: 'passed',
  durationMs: 500,
  assertionCount: 3,
  trivialAssertionCount: 0,
  touchedIo: true,
  ...overrides,
});

describe('classifyHollow: fast and inert', () => {
  it('is hollow when the median run is under 50ms and no result touched IO', () => {
    const verdict = classifyHollow('f', [hollowResult({ durationMs: 5, touchedIo: false })], 1);
    expect(verdict.reasons).toContain('fast_and_inert');
    expect(verdict.valueScore).toBe(0);
  });

  it('is not hollow when any result touched IO, or when IO was never reported', () => {
    const fast = { durationMs: 5 };
    expect(
      classifyHollow(
        'f',
        [hollowResult({ ...fast, touchedIo: false }), hollowResult({ ...fast, touchedIo: true })],
        2,
      ).hollow,
    ).toBe(false);
    expect(classifyHollow('f', [hollowResult({ ...fast, touchedIo: null })], 1).hollow).toBe(false);
  });

  it('does not judge speed on a test that never reported a duration or never ran', () => {
    expect(
      classifyHollow('f', [hollowResult({ durationMs: null, touchedIo: false })], 1).hollow,
    ).toBe(false);
    expect(
      classifyHollow(
        'f',
        [hollowResult({ durationMs: 1, touchedIo: false, outcome: 'skipped' })],
        0,
      ).hollow,
    ).toBe(false);
  });

  it('uses the median, so one slow run does not hide an inert test', () => {
    const results = [1, 2, 900].map((durationMs) => hollowResult({ durationMs, touchedIo: false }));
    expect(classifyHollow('f', results, 3).reasons).toContain('fast_and_inert');
  });

  it('stops being hollow at exactly the ceiling', () => {
    expect(
      classifyHollow('f', [hollowResult({ durationMs: 50, touchedIo: false })], 1).hollow,
    ).toBe(false);
    expect(
      classifyHollow('f', [hollowResult({ durationMs: 49.9, touchedIo: false })], 1).hollow,
    ).toBe(true);
  });

  it('is unfalsifiable, not hollow, with no results', () => {
    expect(classifyHollow('f', [], 0).hollow).toBe(false);
  });
});

describe('flakeRate', () => {
  const observation = (
    runId: string,
    outcome: OutcomeObservation['outcome'],
  ): OutcomeObservation => ({
    fingerprint: 'f',
    runId,
    commitSha: 'c1',
    outcome,
  });

  it('is zero when nothing executed, instead of dividing by zero', () => {
    const observations = new Map([
      ['f', [observation('r1', 'passed'), observation('r2', 'failed')]],
    ]);
    expect(flakeRate([], observations)).toEqual({ rate: 0, strong: [], weak: [] });
  });

  it('does not count a flaky fingerprint that never ran in this window', () => {
    const observations = new Map([
      ['gone', [observation('r1', 'passed'), observation('r2', 'failed')]],
    ]);
    const results = [hollowResult({ fingerprint: 'other' })];
    expect(flakeRate(results, observations)).toEqual({ rate: 0, strong: [], weak: [] });
  });

  it('reports a strong fingerprint once, as strong only', () => {
    const flips = ['passed', 'failed', 'passed', 'failed', 'passed'] as const;
    const observations = new Map([
      ['f', flips.map((outcome, index) => observation(`r${index}`, outcome))],
    ]);
    const rate = flakeRate(
      [hollowResult({ fingerprint: 'f' }), hollowResult({ fingerprint: 'g' })],
      observations,
    );
    expect(rate.strong).toEqual(['f']);
    expect(rate.weak).toEqual([]);
    expect(rate.rate).toBe(0.5);
  });

  it('reports a weak-only fingerprint as weak, which never moves the rate', () => {
    const changing = ['passed', 'failed', 'passed', 'failed'] as const;
    const observations = new Map([
      [
        'f',
        changing.map((outcome, index) => ({
          ...observation(`r${index}`, outcome),
          commitSha: `c${index}`,
        })),
      ],
    ]);
    const rate = flakeRate([hollowResult({ fingerprint: 'f' })], observations);
    expect(rate).toEqual({ rate: 0, strong: [], weak: ['f'] });
  });
});

const cellOf = (
  overrides: Partial<CellComponents> & { key: string; executedTests?: number },
): CellComponents => {
  const { executedTests = 0, ...rest } = overrides;
  const [category = 'unit', surface = 'backend'] = overrides.key.split(':');
  return {
    category,
    surface,
    presence: 0,
    depth: 0,
    stability: 1,
    signal: 1,
    score: 0,
    inputs: {
      executedTests,
      flakyFingerprints: [],
      hollowFingerprints: [],
      failedFingerprints: [],
    },
    ...rest,
  } as unknown as CellComponents;
};

describe('structural findings', () => {
  it('names the modules when there are five or fewer, and only counts them beyond that', () => {
    const few = findStructural({
      cells: [],
      uncoveredModules: ['a.ts', 'b.ts'],
      singleLayerE2eFingerprints: [],
    });
    expect(few[0]?.statement).toContain('2 module(s) have no test in any category: a.ts, b.ts.');
    const five = findStructural({
      cells: [],
      uncoveredModules: ['1', '2', '3', '4', '5'],
      singleLayerE2eFingerprints: [],
    });
    expect(five[0]?.statement).toContain(': 1, 2, 3, 4, 5.');
    const many = findStructural({
      cells: [],
      uncoveredModules: ['1', '2', '3', '4', '5', '6'],
      singleLayerE2eFingerprints: [],
    });
    expect(many[0]?.statement).toContain('6 module(s) have no test in any category. ');
    expect(many[0]?.statement).not.toContain('1, 2');
  });

  it('weights uncovered modules by count and caps the impact at one', () => {
    const impact = (count: number) =>
      findStructural({
        cells: [],
        uncoveredModules: Array.from({ length: count }, (_u, index) => `m${index}`),
        singleLayerE2eFingerprints: [],
      })[0]?.impact;
    expect(impact(10)).toBe(0.1);
    expect(impact(100)).toBe(1);
    expect(impact(250)).toBe(1);
  });

  it('points the uncovered-surface finding at the cells that are not yet perfect', () => {
    const cells = [
      cellOf({ key: 'unit:backend', score: 1 }),
      cellOf({ key: 'e2e:backend', score: 0.4 }),
    ];
    const found = findStructural({
      cells,
      uncoveredModules: ['x'],
      singleLayerE2eFingerprints: [],
    });
    expect(found.find((finding) => finding.kind === 'uncovered_surface')?.cells).toEqual([
      'e2e:backend',
    ]);
  });

  it('flags a category where one cell holds more than 80% of the tests, and not exactly 80%', () => {
    const dominant = [
      cellOf({ key: 'unit:backend', executedTests: 81 }),
      cellOf({ key: 'unit:frontend', executedTests: 19 }),
    ];
    const found = findStructural({
      cells: dominant,
      uncoveredModules: [],
      singleLayerE2eFingerprints: [],
    });
    expect(found.map((finding) => finding.kind)).toEqual(['dominant_cell']);
    expect(found[0]?.cells).toEqual(['unit:backend']);
    expect(found[0]?.impact).toBeCloseTo(0.19, 12);

    const edge = [
      cellOf({ key: 'unit:backend', executedTests: 80 }),
      cellOf({ key: 'unit:frontend', executedTests: 20 }),
    ];
    expect(
      findStructural({ cells: edge, uncoveredModules: [], singleLayerE2eFingerprints: [] }),
    ).toEqual([]);
  });

  it('skips a category with no executed tests at all', () => {
    const cells = [cellOf({ key: 'unit:backend' }), cellOf({ key: 'unit:frontend' })];
    expect(findStructural({ cells, uncoveredModules: [], singleLayerE2eFingerprints: [] })).toEqual(
      [],
    );
  });

  it('flags green-but-empty only when a suite is present and covers nothing', () => {
    const cells = [
      cellOf({ key: 'unit:backend', presence: 1, depth: 0, score: 0.6 }),
      cellOf({ key: 'unit:frontend', presence: 1, depth: 0.2 }),
      cellOf({ key: 'e2e:backend', presence: 0, depth: 0 }),
    ];
    const found = findStructural({ cells, uncoveredModules: [], singleLayerE2eFingerprints: [] });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'green_but_empty',
      cells: ['unit:backend'],
      impact: 0.6,
    });
  });

  it('caps the single-layer impact at one and counts the fingerprints', () => {
    const fingerprints = Array.from({ length: 80 }, (_u, index) => `f${index}`);
    const found = findStructural({
      cells: [],
      uncoveredModules: [],
      singleLayerE2eFingerprints: fingerprints,
    });
    expect(found[0]).toMatchObject({
      kind: 'single_layer_dependency',
      impact: 1,
      cells: ['e2e:platform'],
    });
    expect(found[0]?.statement).toContain('80 fingerprint(s)');
  });

  it('calls a cell with no executed tests empty, and one with a single test not empty', () => {
    expect(isEmptyCell(cellOf({ key: 'unit:backend', executedTests: 0 }))).toBe(true);
    expect(isEmptyCell(cellOf({ key: 'unit:backend', executedTests: 1 }))).toBe(false);
  });
});

describe('diffScores on a pyramid that moved', () => {
  const at = (day: number) => `2026-10-0${day}T00:00:00.000Z`;
  const inputsWith = (
    results: ScoreInputs['results'],
    pyramid?: { unit: number; integration: number; e2e: number },
  ): ScoreInputs => ({
    projectId: 'project-1',
    profile: {
      detectorVersion: 1,
      excludedCells: [],
      targets: {
        testsPerCell: {},
        coverageTarget: {},
        ...(pyramid === undefined ? {} : { pyramid }),
      },
      weights: DEFAULT_WEIGHTS,
    },
    runs: [
      {
        runId: 'r1',
        startedAt: at(1),
        projectId: 'project-1',
        outcome: 'passed',
        countsTowardsQuality: true,
        coverageBySurface: null,
      },
    ],
    results,
    coverage: null,
    quarantined: [],
    uncoveredModules: [],
    singleLayerE2eFingerprints: [],
  });
  const unitTests = (count: number, category: 'unit' | 'e2e' = 'unit') =>
    Array.from({ length: count }, (_u, index) =>
      hollowResult({ fingerprint: `${category}${index}`, runId: 'r1', category }),
    );

  it('cites the declared target when there is one, and says there is none when there is not', () => {
    for (const [pyramid, expected] of [
      [{ unit: 0.5, integration: 0.3, e2e: 0.2 }, 'pyramid:target-0.50'],
      [undefined, 'pyramid:no-declared-target'],
    ] as const) {
      const before = score(inputsWith([...unitTests(7), ...unitTests(3, 'e2e')], pyramid), at(1));
      const after = score(inputsWith([...unitTests(2), ...unitTests(8, 'e2e')], pyramid), at(2));
      const delta = diffScores(before, after);
      const contribution = delta.contributions.find((entry) => entry.scope === 'pyramid');
      expect(contribution?.evidence).toContain(expected);
      expect(contribution?.cause).toContain('drifted further from');
    }
  });

  it('says the shape moved towards the target when it improved', () => {
    const before = score(inputsWith([...unitTests(2), ...unitTests(8, 'e2e')]), at(1));
    const after = score(inputsWith([...unitTests(7), ...unitTests(3, 'e2e')]), at(2));
    const contribution = diffScores(before, after).contributions.find(
      (entry) => entry.scope === 'pyramid',
    );
    expect(contribution?.cause).toContain('moved towards');
  });
});
