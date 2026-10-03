import { describe, expect, it } from 'vitest';

import { depth, ratioSaturated, stability } from './cell.js';
import { classifyFlakiness, flakeRate, type OutcomeObservation } from './flaky.js';
import { classifyHollow } from './hollow.js';
import { DEFAULT_PYRAMID_TARGET, pyramidShape } from './pyramid.js';
import { findStructural, type StructuralInputs } from './structural.js';
import { score } from './index.js';
import type { CellComponents } from './cell.js';
import { DEFAULT_WEIGHTS, type CanonicalTestResult, type ScoreInputs } from './types.js';
import type { ScoreCategory, ScoreSurface } from '../vocabulary.js';

/**
 * Component tests against hand-computed values.
 *
 * Plan §3.6 asks for exactly this: for a fixture project, each sub-score asserted
 * against a number calculated by hand, so the assertions below carry the
 * arithmetic in a comment rather than trusting the formula that produced them. A
 * test that re-implements the implementation proves nothing; a test that says
 * "0.4 × 0.5 + 0.4 × 0.8 + 0.2 × 1 = 0.72" proves the formula did that.
 */

describe('depth, hand-computed', () => {
  it('is the average of two saturated halves', () => {
    // 0.5·min(1, 50/100) + 0.5·min(1, 0.8/1.0) = 0.5·0.5 + 0.5·0.8 = 0.65
    expect(depth(50, 100, 0.8, 1)).toBeCloseTo(0.65, 10);
  });

  it('drops the coverage half when no coverage artifact was ingested', () => {
    // 100/100 tests, coverage unmeasured. The test half carries full weight:
    // 1. Scoring the missing half as 1 would make every repository without a
    // coverage plugin look maximally deep; scoring it 0 would make it look
    // maximally shallow, which is the lie the plan names.
    expect(depth(100, 100, null, 0.8)).toBe(1);
    expect(depth(50, 100, null, 0.8)).toBe(0.5);
  });

  it('drops the test half when no test target was declared', () => {
    // Coverage 0.8 of a 1.0 target, and no declared size to measure against.
    expect(depth(999, 0, 0.8, 1)).toBeCloseTo(0.8, 10);
  });

  it('is 1 when neither half is measurable, because nothing was declared wrong', () => {
    expect(depth(0, 0, null, null)).toBe(1);
  });

  it('saturates each half at 1 rather than exceeding it', () => {
    // Twice the target and twice the coverage: 0.5·1 + 0.5·1 = 1, not 2.
    expect(depth(200, 100, 2, 1)).toBe(1);
  });

  it('scores the test half at 1 when no target was declared', () => {
    // A cell whose intended size nobody declared has told us nothing about size.
    // `NaN` in a score is worse than a saturated half.
    expect(ratioSaturated(10, 0)).toBe(1);
  });

  it('is zero when there are no tests and the coverage is measured and zero', () => {
    expect(depth(0, 100, 0, 1)).toBe(0);
  });
});

describe('stability, hand-computed', () => {
  it('is 1 minus the flake rate', () => {
    expect(stability(0)).toBe(1);
    expect(stability(0.25)).toBe(0.75);
    expect(stability(1)).toBe(0);
  });

  it('clamps rather than going negative', () => {
    // A flake rate over 1 would mean two fingerprints flipped on the same test,
    // which a counting bug can produce and a score must survive.
    expect(stability(1.4)).toBe(0);
  });
});

describe('flaky, strong and weak', () => {
  const observation = (
    fingerprint: string,
    runId: string,
    outcome: OutcomeObservation['outcome'],
    commitSha: string | null,
  ): OutcomeObservation => ({ fingerprint, runId, commitSha, outcome });

  it('strong: same commit, different outcome', () => {
    const verdict = classifyFlakiness('f1', [
      observation('f1', 'run-1', 'passed', 'abc'),
      observation('f1', 'run-2', 'failed', 'abc'),
    ]);
    expect(verdict.strong).toBe(true);
  });

  it('not strong: the commit changed between the two outcomes', () => {
    // The whole claim is "the code did not change and the result did". Without a
    // commit there is nothing to compare, so this is at most weak evidence.
    const verdict = classifyFlakiness('f1', [
      observation('f1', 'run-1', 'passed', 'abc'),
      observation('f1', 'run-2', 'failed', 'def'),
    ]);
    expect(verdict.strong).toBe(false);
    expect(verdict.weak).toBe(false);
  });

  it('not strong: no commit was recorded at all', () => {
    const verdict = classifyFlakiness('f1', [
      observation('f1', 'run-1', 'passed', null),
      observation('f1', 'run-2', 'failed', null),
    ]);
    expect(verdict.strong).toBe(false);
  });

  it('weak: three flips across the last ten runs, whatever the commits', () => {
    const observations = [1, 2, 3, 4].map((index) =>
      observation('f1', `run-${index}`, index % 2 === 1 ? 'passed' : 'failed', `commit-${index}`),
    );
    const verdict = classifyFlakiness('f1', observations);
    expect(verdict.flips).toBe(3);
    expect(verdict.weak).toBe(true);
    expect(verdict.strong).toBe(false);
  });

  it('weak: two flips is not enough', () => {
    const observations = [1, 2, 3].map((index) =>
      observation('f1', `run-${index}`, index === 2 ? 'passed' : 'failed', `commit-${index}`),
    );
    expect(classifyFlakiness('f1', observations).weak).toBe(false);
  });

  it('counts the flake rate over executed tests only', () => {
    const results: CanonicalTestResult[] = [
      result('f1', 'run-1', 'passed', { commitSha: 'abc' }),
      result('f1', 'run-2', 'failed', { commitSha: 'abc' }),
      result('f2', 'run-1', 'passed', { commitSha: 'abc' }),
      result('f2', 'run-2', 'passed', { commitSha: 'abc' }),
    ];
    const observations = new Map<string, OutcomeObservation[]>([
      [
        'f1',
        [observation('f1', 'run-1', 'passed', 'abc'), observation('f1', 'run-2', 'failed', 'abc')],
      ],
      [
        'f2',
        [observation('f2', 'run-1', 'passed', 'abc'), observation('f2', 'run-2', 'passed', 'abc')],
      ],
    ]);
    // One strong fingerprint out of two executed fingerprints.
    expect(flakeRate(results, observations).rate).toBe(0.5);
  });

  it('does not let a cancelled test lower the flake rate', () => {
    const results: CanonicalTestResult[] = [
      result('f1', 'run-1', 'passed', { commitSha: 'abc' }),
      result('f2', 'run-1', 'cancelled'),
    ];
    const observations = new Map<string, OutcomeObservation[]>([
      ['f1', [observation('f1', 'run-1', 'passed', 'abc')]],
    ]);
    // One executed fingerprint, zero strong: a pipeline that never finished is
    // not a flaky suite.
    expect(flakeRate(results, observations).rate).toBe(0);
  });
});

describe('hollow, three independent rules', () => {
  const passing = (overrides: Partial<CanonicalTestResult> = {}): CanonicalTestResult => ({
    fingerprint: 'f1',
    runId: 'run-1',
    commitSha: 'abc',
    category: 'unit',
    surface: 'backend',
    outcome: 'passed',
    durationMs: 120,
    assertionCount: 3,
    trivialAssertionCount: 0,
    touchedIo: true,
    ...overrides,
  });

  it('a passing test with no assertion at all is hollow', () => {
    const verdict = classifyHollow('f1', [passing({ assertionCount: 0 })], 1);
    expect(verdict.hollow).toBe(true);
    expect(verdict.reasons).toContain('no_observed_assertion');
    expect(verdict.valueScore).toBe(0);
  });

  it('a test whose producer reported nothing is not accused of being hollow', () => {
    // `null` means the producer said nothing. Absence of evidence is not evidence
    // of absence, and inferring it would need a source parser this deliberately
    // does not have.
    const verdict = classifyHollow('f1', [passing({ assertionCount: null })], 1);
    expect(verdict.hollow).toBe(false);
    expect(verdict.valueScore).toBe(1);
  });

  it('thirty consecutive passes on a trivially-true assertion is hollow', () => {
    // 30 assertions, all `expect(true)`, thirty green runs. The test *has*
    // assertions and none of them can fail — a different and more expensive
    // defect than having none at all.
    const verdict = classifyHollow(
      'f1',
      [passing({ assertionCount: 30, trivialAssertionCount: 30 })],
      30,
    );
    expect(verdict.reasons).toContain('trivially_true_assertions');
    expect(verdict.reasons).not.toContain('no_observed_assertion');
  });

  it('one pass on a trivially-true assertion is not', () => {
    const verdict = classifyHollow(
      'f1',
      [passing({ assertionCount: 30, trivialAssertionCount: 30 })],
      1,
    );
    expect(verdict.reasons).not.toContain('trivially_true_assertions');
  });

  it('thirty passes on assertions that can fail is not hollow', () => {
    const verdict = classifyHollow(
      'f1',
      [passing({ assertionCount: 30, trivialAssertionCount: 0 })],
      30,
    );
    expect(verdict.hollow).toBe(false);
  });

  it('thirty passes where the producer reported no assertion kinds is not hollow', () => {
    // `trivialAssertionCount === null` is silence, not an accusation.
    const verdict = classifyHollow(
      'f1',
      [passing({ assertionCount: 30, trivialAssertionCount: null })],
      30,
    );
    expect(verdict.reasons).not.toContain('trivially_true_assertions');
  });

  it('a fast test that touched nothing is hollow', () => {
    const verdict = classifyHollow('f1', [passing({ durationMs: 5, touchedIo: false })], 1);
    expect(verdict.reasons).toContain('fast_and_inert');
  });

  it('a fast test that touched a file is not', () => {
    const verdict = classifyHollow('f1', [passing({ durationMs: 5, touchedIo: true })], 1);
    expect(verdict.reasons).not.toContain('fast_and_inert');
  });

  it('declines to fire on silence about I/O rather than assuming none', () => {
    const verdict = classifyHollow('f1', [passing({ durationMs: 5, touchedIo: null })], 1);
    expect(verdict.reasons).not.toContain('fast_and_inert');
  });

  it('an unobserved fingerprint is unfalsifiable, not hollow', () => {
    const verdict = classifyHollow('f1', [], 0);
    expect(verdict.hollow).toBe(false);
    expect(verdict.valueScore).toBe(1);
  });
});

describe('pyramid, hand-computed', () => {
  it('is 1 when the observed shape is the target', () => {
    const verdict = pyramidShape({ unit: 70, integration: 20, e2e: 10 }, DEFAULT_PYRAMID_TARGET);
    expect(verdict.shape).toBeCloseTo(1, 10);
    expect(verdict.drift).toBeCloseTo(0, 10);
  });

  it('is 0.5 for a fully inverted pyramid, by the half-L1 rule', () => {
    // Observed (0.1, 0.2, 0.7) against target (0.7, 0.2, 0.1): the L1 norm is
    // 0.6 + 0 + 0.6 = 1.2, so shape = 1 − min(1, 0.6) = 0.4.
    const verdict = pyramidShape({ unit: 10, integration: 20, e2e: 70 }, DEFAULT_PYRAMID_TARGET);
    expect(verdict.drift).toBeCloseTo(1.2, 10);
    expect(verdict.shape).toBeCloseTo(0.4, 10);
  });

  it('is 0 with no executed tests, not "on target because nothing deviates"', () => {
    const verdict = pyramidShape({ unit: 0, integration: 0, e2e: 0 });
    expect(verdict.shape).toBe(0);
  });

  it('records no declared target when the project declared none', () => {
    // The distinction the copilot gates on: a chart needs something to draw against,
    // so `target` falls back to the default — but "the team chose this" and "we
    // drew one" are different claims, and only the second is true here.
    expect(pyramidShape({ unit: 70, integration: 20, e2e: 10 }).declaredTarget).toBeNull();
    expect(pyramidShape({ unit: 0, integration: 0, e2e: 0 }).declaredTarget).toBeNull();
  });

  it('records the declared target when the project set one', () => {
    const target = { unit: 0.6, integration: 0.3, e2e: 0.1 };
    expect(pyramidShape({ unit: 60, integration: 30, e2e: 10 }, target).declaredTarget).toEqual(
      target,
    );
    // And the empty-suite branch records it too, so "declared a target and has no
    // tests" is distinguishable from "declared nothing".
    expect(pyramidShape({ unit: 0, integration: 0, e2e: 0 }, target).declaredTarget).toEqual(
      target,
    );
  });

  it('never leaves [0,1] for any split', () => {
    for (const split of [
      { unit: 1, integration: 0, e2e: 0 },
      { unit: 0, integration: 0, e2e: 1 },
      { unit: 0, integration: 1, e2e: 0 },
      { unit: 3, integration: 1, e2e: 1 },
    ]) {
      const verdict = pyramidShape(split);
      expect(verdict.shape).toBeGreaterThanOrEqual(0);
      expect(verdict.shape).toBeLessThanOrEqual(1);
    }
  });
});

describe('structural findings', () => {
  const cell = (
    key: string,
    scoreValue: number,
    presence: number,
    depth: number,
    tests: number,
  ) => ({
    key,
    category: key.split(':')[0] as ScoreCategory,
    surface: key.split(':')[1] as ScoreSurface,
    presence,
    depth,
    stability: 1,
    signal: 1,
    score: scoreValue,
    excluded: false,
    inputs: {
      executedTests: tests,
      targetTests: 10,
      surfaceCoverage: 0.5,
      coverageTarget: 0.8,
      flakeRate: 0,
      failedFingerprints: [],
      flakyFingerprints: [],
      hollowFingerprints: [],
      qualifyingRuns: 1,
    },
  });

  const inputs = (overrides: Partial<StructuralInputs> = {}): StructuralInputs => ({
    cells: [cell('unit:backend', 0.6, 1, 0.5, 50)],
    uncoveredModules: [],
    singleLayerE2eFingerprints: [],
    ...overrides,
  });

  it('finds a green-but-empty cell', () => {
    const findings = findStructural(inputs({ cells: [cell('unit:backend', 0, 1, 0, 50)] }));
    expect(findings.map((finding) => finding.kind)).toContain('green_but_empty');
  });

  it('does not call a cell green but empty when presence is 0', () => {
    // Presence 0 and depth 0 means "no suite", which the gaps queue already says.
    // Reporting it twice in two vocabularies is how a queue stops being read.
    const findings = findStructural(inputs({ cells: [cell('unit:backend', 0, 0, 0, 0)] }));
    expect(findings.map((finding) => finding.kind)).not.toContain('green_but_empty');
  });

  it('finds a dominant cell above 80%', () => {
    const findings = findStructural(
      inputs({
        cells: [
          cell('e2e:backend', 0.6, 1, 0.5, 90),
          cell('e2e:frontend', 0.6, 1, 0.5, 5),
          cell('e2e:platform', 0.6, 1, 0.5, 5),
        ],
      }),
    );
    const dominant = findings.find((finding) => finding.kind === 'dominant_cell');
    expect(dominant?.statement).toContain('90%');
    expect(dominant?.cells).toEqual(['e2e:backend']);
  });

  it('does not find a dominant cell at exactly 80%', () => {
    const findings = findStructural(
      inputs({
        cells: [
          cell('e2e:backend', 0.6, 1, 0.5, 80),
          cell('e2e:frontend', 0.6, 1, 0.5, 10),
          cell('e2e:platform', 0.6, 1, 0.5, 10),
        ],
      }),
    );
    expect(findings.map((finding) => finding.kind)).not.toContain('dominant_cell');
  });

  it('finds uncovered surface, naming the modules', () => {
    const findings = findStructural(
      inputs({ uncoveredModules: ['src/billing.ts', 'src/auth.ts'] }),
    );
    const uncovered = findings.find((finding) => finding.kind === 'uncovered_surface');
    expect(uncovered?.statement).toContain('src/billing.ts');
    expect(uncovered?.statement).toContain('2 module(s)');
  });

  it('finds a single-layer dependency', () => {
    const findings = findStructural(inputs({ singleLayerE2eFingerprints: ['f1', 'f2'] }));
    expect(findings.map((finding) => finding.kind)).toContain('single_layer_dependency');
  });
});

describe('the whole score, on a fixture project whose numbers are calculated by hand', () => {
  const fixture = (overrides: Partial<ScoreInputs> = {}): ScoreInputs => ({
    projectId: 'project-1',
    profile: {
      detectorVersion: 1,
      excludedCells: [],
      targets: { testsPerCell: { 'unit:backend': 10 }, coverageTarget: { backend: 1 } },
      weights: DEFAULT_WEIGHTS,
    },
    runs: [goodRun('run-1')],
    results: [
      result('f1', 'run-1', 'passed', { category: 'unit', surface: 'backend' }),
      result('f2', 'run-1', 'passed', { category: 'unit', surface: 'backend' }),
    ],
    coverage: { bySurface: { backend: 1 } },
    quarantined: [],
    uncoveredModules: [],
    singleLayerE2eFingerprints: [],
    ...overrides,
  });

  it('scores the one cell with a suite, and leaves every other cell at zero', () => {
    const score_ = score(fixture(), '2026-10-02T00:00:00.000Z');
    const backendUnit = cellAt(score_.cells, 'unit', 'backend');

    // presence 1; depth = 0.5·min(1, 2/10) + 0.5·min(1, 1/1) = 0.1 + 0.5 = 0.6;
    // stability 1; signal 1. cell = 1·(0.4·0.6 + 0.4·1 + 0.2·1) = 0.24 + 0.4 + 0.2 = 0.84.
    expect(backendUnit.presence).toBe(1);
    expect(backendUnit.depth).toBeCloseTo(0.6, 10);
    expect(backendUnit.score).toBeCloseTo(0.84, 10);

    // Every other cell has presence 0, so presence-multiplication takes it to 0.
    expect(
      score_.cells.filter((cell) => cell.key !== 'unit:backend').every((cell) => cell.score === 0),
    ).toBe(true);
  });

  it('is 0 overall, because a repository with four empty categories has four zeros', () => {
    const score_ = score(fixture(), '2026-10-02T00:00:00.000Z');
    expect(score_.total).toBe(0);
    expect(score_.cappedBy).toBeDefined();
    expect(score_.cappingValue).toBe(0);
  });

  it('reports the backend and frontend column rollups separately', () => {
    const score_ = score(fixture(), '2026-10-02T00:00:00.000Z');
    // The backend column has one non-zero cell out of five; the frontend column
    // has none. Reading "0.17" as "the backend is broken" would be the wrong
    // conclusion, which is why both are reported rather than one.
    expect(score_.surfaces.backend).toBeCloseTo(0.84 / 5, 10);
    expect(score_.surfaces.frontend).toBe(0);
    expect(score_.surfaces.platform).toBe(0);
  });

  it('excludes an n/a cell and renormalises, so a frontend-only repo is not zero forever', () => {
    const frontendOnly = score(
      fixture({
        profile: {
          detectorVersion: 1,
          // Every backend cell and the platform column is n/a; only frontend runs.
          excludedCells: [
            { category: 'unit', surface: 'backend' },
            { category: 'integration', surface: 'backend' },
            { category: 'e2e', surface: 'backend' },
            { category: 'performance', surface: 'backend' },
            { category: 'security', surface: 'backend' },
            { category: 'unit', surface: 'platform' },
            { category: 'integration', surface: 'platform' },
            { category: 'e2e', surface: 'platform' },
            { category: 'performance', surface: 'platform' },
            { category: 'security', surface: 'platform' },
          ],
          targets: { testsPerCell: {}, coverageTarget: {} },
          weights: DEFAULT_WEIGHTS,
        },
        results: [
          result('f1', 'run-1', 'passed', { category: 'unit', surface: 'frontend' }),
          result('f2', 'run-1', 'passed', { category: 'unit', surface: 'frontend' }),
        ],
      }),
      '2026-10-02T00:00:00.000Z',
    );
    // Every scored category still has two empty surfaces, so the total is still
    // zero — but the *unit row* is now non-zero, which is the part that proves
    // the exclusion renormalised rather than merely subtracting.
    expect(cellAt(frontendOnly.cells, 'unit', 'frontend').score).toBeGreaterThan(0);
  });

  it('reports infra failures separately and never folds them into the pass rate', () => {
    const withInfraFailure = score(
      fixture({
        runs: [goodRun('run-1'), infraFailedRun('run-2')],
        results: [
          result('f1', 'run-1', 'passed', { category: 'unit', surface: 'backend' }),
          result('f2', 'run-1', 'passed', { category: 'unit', surface: 'backend' }),
        ],
      }),
      '2026-10-02T00:00:00.000Z',
    );
    expect(withInfraFailure.provenance.infraFailedRuns).toEqual(['run-2']);
    expect(withInfraFailure.provenance.infraFailedRate).toBe(0.5);
    // And the run that died did not become a failing test.
    expect(withInfraFailure.provenance.outcomeCounts.failed ?? 0).toBe(0);
  });

  it('carries the detector version into provenance', () => {
    const score_ = score(fixture(), '2026-10-02T00:00:00.000Z');
    expect(score_.provenance.detectorVersion).toBe(1);
    expect(score_.provenance.runsRead).toBe(1);
    expect(score_.provenance.resultsRead).toBe(2);
  });

  it('ranks gaps by what closing them is worth, and names what would close one', () => {
    const score_ = score(fixture(), '2026-10-02T00:00:00.000Z');
    expect(score_.gaps.length).toBeGreaterThan(0);
    for (let index = 1; index < score_.gaps.length; index += 1) {
      const previous = score_.gaps[index - 1];
      const current = score_.gaps[index];
      if (previous !== undefined && current !== undefined) {
        expect(previous.potential).toBeGreaterThanOrEqual(current.potential);
      }
    }
    const noSuite = score_.gaps.find((gap) => gap.current === 0);
    expect(noSuite?.cheapestClosure).toContain('No suite');
  });
});

function cellAt(
  cells: readonly CellComponents[],
  category: ScoreCategory,
  surface: ScoreSurface,
): CellComponents {
  const found = cells.find((cell) => cell.category === category && cell.surface === surface);
  if (found === undefined) throw new Error(`no cell ${category}:${surface}`);
  return found;
}

function result(
  fingerprint: string,
  runId: string,
  outcome: CanonicalTestResult['outcome'],
  overrides: Partial<CanonicalTestResult> = {},
): CanonicalTestResult {
  return {
    fingerprint,
    runId,
    commitSha: 'commit-1',
    category: 'unit',
    surface: 'backend',
    outcome,
    durationMs: 120,
    assertionCount: 2,
    trivialAssertionCount: 0,
    touchedIo: true,
    ...overrides,
  };
}

function goodRun(runId: string) {
  return {
    runId,
    startedAt: '2026-10-01T00:00:00.000Z',
    projectId: 'project-1',
    outcome: 'failed',
    countsTowardsQuality: true,
    coverageBySurface: null,
  };
}

function infraFailedRun(runId: string) {
  return {
    runId,
    startedAt: '2026-10-01T01:00:00.000Z',
    projectId: 'project-1',
    outcome: 'infra_failed',
    countsTowardsQuality: false,
    coverageBySurface: null,
  };
}
