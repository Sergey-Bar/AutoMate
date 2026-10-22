import { describe, expect, it } from 'vitest';

import {
  classifyFlakiness,
  compareRunOrder,
  trailingPasses,
  type OutcomeObservation,
} from './flaky.js';
import { score } from './index.js';
import { DEFAULT_WEIGHTS, type CanonicalTestResult, type ScoreInputs } from './types.js';

/**
 * Run ids are random UUIDs (`randomUUID()` in the execution store), so sorting them says
 * nothing about which run came first. "The last ten runs" and "three flips" are claims about
 * time, and the only time on a run is `startedAt`.
 */

/** Observations whose ids sort in the OPPOSITE alternation to the order they happened in. */
function scrambled(): OutcomeObservation[] {
  // Chronologically: pass, pass, pass, fail, fail, fail  -> exactly one flip.
  // By id:           a=pass, b=fail, c=pass, d=fail, e=pass, f=fail -> five flips.
  const spec: Array<[string, string, OutcomeObservation['outcome']]> = [
    ['a', '2026-10-01T00:00:01.000Z', 'passed'],
    ['c', '2026-10-01T00:00:02.000Z', 'passed'],
    ['e', '2026-10-01T00:00:03.000Z', 'passed'],
    ['b', '2026-10-01T00:00:04.000Z', 'failed'],
    ['d', '2026-10-01T00:00:05.000Z', 'failed'],
    ['f', '2026-10-01T00:00:06.000Z', 'failed'],
  ];
  return spec.map(([runId, startedAt, outcome]) => ({
    fingerprint: 'f1',
    runId,
    commitSha: null,
    outcome,
    startedAt,
  }));
}

describe('flakiness is judged in the order the runs happened, not the order of their ids', () => {
  it('counts one flip for a test that went green and then stayed red', () => {
    const verdict = classifyFlakiness('f1', scrambled());
    expect(verdict.flips).toBe(1);
    expect(verdict.weak).toBe(false);
  });

  it('does not depend on the order the observations arrive in', () => {
    const forward = classifyFlakiness('f1', scrambled());
    const backward = classifyFlakiness('f1', [...scrambled()].reverse());
    expect(backward).toEqual(forward);
  });
});
describe('compareRunOrder', () => {
  it('orders by start time, then by id', () => {
    const early = { runId: 'z', startedAt: '2026-10-01T00:00:00.000Z' };
    const late = { runId: 'a', startedAt: '2026-10-02T00:00:00.000Z' };
    expect(compareRunOrder(early, late)).toBe(-1);
    expect(compareRunOrder(late, early)).toBe(1);
    expect(compareRunOrder({ ...early, runId: 'a' }, { ...early, runId: 'b' })).toBeLessThan(0);
    expect(compareRunOrder(early, early)).toBe(0);
  });

  it('puts an undated or unreadable run before every dated one, keeping the order total', () => {
    const dated = { runId: 'a', startedAt: '2026-10-01T00:00:00.000Z' };
    expect(compareRunOrder({ runId: 'z' }, dated)).toBe(-1);
    expect(compareRunOrder({ runId: 'z', startedAt: null }, dated)).toBe(-1);
    expect(compareRunOrder({ runId: 'z', startedAt: 'not a date' }, dated)).toBe(-1);
    expect(compareRunOrder(dated, { runId: 'z', startedAt: 'not a date' })).toBe(1);
    expect(compareRunOrder({ runId: 'a' }, { runId: 'b', startedAt: null })).toBeLessThan(0);
  });
});

const outcomeResult = (
  runId: string,
  outcome: CanonicalTestResult['outcome'],
): CanonicalTestResult => ({
  fingerprint: 'f1',
  runId,
  commitSha: 'c1',
  category: 'unit',
  surface: 'backend',
  outcome,
  durationMs: 120,
  assertionCount: 2,
  trivialAssertionCount: 2,
  touchedIo: true,
});

describe('trailingPasses', () => {
  it('counts passes at the end of the timeline, however the ids sort', () => {
    const times = new Map([
      ['zzz', '2026-10-01T00:00:00.000Z'],
      ['aaa', '2026-10-02T00:00:00.000Z'],
      ['bbb', '2026-10-03T00:00:00.000Z'],
    ]);
    // Oldest is the failure. By id it would be last, and the trailing run would be zero.
    const results = [
      outcomeResult('aaa', 'passed'),
      outcomeResult('zzz', 'failed'),
      outcomeResult('bbb', 'passed'),
    ];
    expect(trailingPasses(results, times)).toBe(2);
  });

  it('stops at the most recent non-pass', () => {
    const times = new Map([
      ['r1', '2026-10-01T00:00:00.000Z'],
      ['r2', '2026-10-02T00:00:00.000Z'],
    ]);
    expect(
      trailingPasses([outcomeResult('r1', 'passed'), outcomeResult('r2', 'failed')], times),
    ).toBe(0);
    expect(trailingPasses([], times)).toBe(0);
  });
});

describe('score() reads run order from the runs, not from their ids', () => {
  const RUNS = 31;
  const run = (index: number) => ({
    runId: index === 0 ? 'zzz-first-run' : `run-${String(index).padStart(2, '0')}`,
    startedAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
    projectId: 'project-1',
    outcome: 'passed',
    countsTowardsQuality: true,
    coverageBySurface: null,
  });
  const inputs = (): ScoreInputs => {
    const runs = Array.from({ length: RUNS }, (_unused, index) => run(index));
    return {
      projectId: 'project-1',
      profile: {
        detectorVersion: 1,
        excludedCells: [],
        targets: { testsPerCell: {}, coverageTarget: {} },
        weights: DEFAULT_WEIGHTS,
      },
      runs,
      // The oldest run failed; the thirty after it passed with only trivially-true assertions.
      results: runs.map((entry, index) =>
        outcomeResult(entry.runId, index === 0 ? 'failed' : 'passed'),
      ),
      coverage: null,
      quarantined: [],
      uncoveredModules: [],
      singleLayerE2eFingerprints: [],
    };
  };

  it('treats thirty trailing trivially-true passes as hollow even though the failure has the last id', () => {
    const scored = score(inputs(), '2026-10-02T00:00:00.000Z');
    const cell = scored.cells.find((entry) => entry.key === 'unit:backend');
    expect(cell?.signal).toBe(0);
  });

  it('does not call it hollow when the failure is actually the latest run', () => {
    const data = inputs();
    const flipped = {
      ...data,
      results: data.results.map((entry, index) =>
        outcomeResult(
          entry.runId,
          index === 0 ? 'passed' : index === RUNS - 1 ? 'failed' : 'passed',
        ),
      ),
    };
    const cell = score(flipped, '2026-10-02T00:00:00.000Z').cells.find(
      (entry) => entry.key === 'unit:backend',
    );
    expect(cell?.signal).toBe(1);
  });
});
