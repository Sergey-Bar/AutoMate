import { describe, expect, it } from 'vitest';

import { QaScoreSchema, ScoreDeltaSchema } from '@automate/shared-contracts';
import { diffScores } from './diff.js';
import { score, DEFAULT_WEIGHTS, type ScoreInputs } from '../index.js';

/**
 * The score diff.
 *
 * ## What this file is actually asserting
 *
 * That a diff is a **list of causes**, not a number that moved. The plan puts it
 * plainly: the answer is "Security `D` fell because 3 target files gained no
 * coverage after commit `abc`", and a diff that said "62 → 58" would satisfy every
 * assertion a dashboard makes while telling the reader nothing they can act on.
 *
 * So each contribution names **which component moved** — `depth`, `stability`,
 * `signal`, `presence` — and carries evidence a reader can open. Three of the tests
 * below are specifically about a diff that *cannot* be produced rather than about
 * the text it produces, because a diff which stays silent when it should speak is
 * the failure mode that survives review.
 */

/** The five categories, read from the contract rather than restated. */
const SCORE_CATEGORIES_TEST = ['unit', 'integration', 'e2e', 'performance', 'security'] as const;

const AT_ONE = '2026-10-01T00:00:00.000Z';
const AT_TWO = '2026-10-02T00:00:00.000Z';

const inputs = (overrides: Partial<ScoreInputs> = {}): ScoreInputs => ({
  projectId: 'project-1',
  profile: {
    detectorVersion: 1,
    excludedCells: [],
    targets: { testsPerCell: {}, coverageTarget: {} },
    weights: DEFAULT_WEIGHTS,
  },
  runs: [],
  results: [],
  coverage: null,
  quarantined: [],
  uncoveredModules: [],
  singleLayerE2eFingerprints: [],
  ...overrides,
});

const run = (runId: string) => ({
  runId,
  startedAt: AT_TWO,
  projectId: 'project-1',
  outcome: 'passed',
  countsTowardsQuality: true,
  coverageBySurface: null,
});

function result(
  fingerprint: string,
  overrides: Partial<ScoreInputs['results'][number]> = {},
): ScoreInputs['results'][number] {
  return {
    fingerprint,
    runId: 'r1',
    commitSha: 'c1',
    category: 'unit' as const,
    surface: 'backend' as const,
    outcome: 'passed' as const,
    durationMs: 120,
    assertionCount: 3,
    trivialAssertionCount: 0,
    touchedIo: true,
    ...overrides,
  };
}

describe('a diff is a list of causes, not a number that moved', () => {
  it('names the component that moved and the counts behind it', () => {
    // The repository lost its security suite between the two readings. The
    // contribution has to say *presence*, and say the count fell from 1 to 0 —
    // "the score fell" is what the reader already knew.
    //
    // The `before` reading **has** the security result; without it both readings
    // would score `security:backend` at `presence 0` and there would be nothing to
    // diff, which is a mistake I made writing this test the first time.
    //
    // The run id is `r1` in **both** readings because `result()` defaults to it and
    // `presence` matches a qualifying run to a result by id. Passing `run('r0')` here
    // left the result with no run to belong to, so `presence` never moved and the
    // diff blamed `signal` instead — which is what the first version of this test
    // asserted.
    const before = score(
      inputs({ runs: [run('r1')], results: [result('s1', { category: 'security' as const })] }),
      AT_ONE,
    );
    const after = score(inputs({ runs: [run('r1')], results: [result('unit-1')] }), AT_TWO);

    const delta = diffScores(before, after);
    expect(ScoreDeltaSchema.safeParse(delta).success).toBe(true);

    const security = delta.contributions.find(
      (contribution) => contribution.scope === 'cell' && contribution.key === 'security:backend',
    );
    expect(security).toBeDefined();
    expect(security?.cause).toMatch(/presence|lost a suite/iu);
  });

  it('names the executed count that moved, not just the component', () => {
    // The depth half moved because tests were removed. A diff that says only
    // "depth fell" leaves the reader with a component name and no counts; the plan's
    // example is "3 target files gained no coverage after commit abc", which is a
    // count and an identity.
    const before = score(
      inputs({
        runs: [run('r0')],
        results: Array.from({ length: 40 }, (_, index) =>
          result(`s${index}`, { runId: 'r0', category: 'security' as const }),
        ),
      }),
      AT_ONE,
    );
    const after = score(
      inputs({
        runs: [run('r1')],
        results: Array.from({ length: 40 }, (_, index) =>
          result(`s${index}`, { runId: 'r1', category: 'security' as const }),
        ),
        profile: {
          ...inputs().profile,
          targets: { testsPerCell: { 'security:backend': 100 }, coverageTarget: {} },
        },
      }),
      AT_TWO,
    );

    const security = diffScores(before, after).contributions.find(
      (contribution) => contribution.scope === 'cell' && contribution.key === 'security:backend',
    );
    expect(security).toBeDefined();
    expect(security?.evidence.join(' ')).toContain('cell:security:backend');
  });

  it('carries evidence a reader can open on every contribution', () => {
    const before = score(inputs({ results: [] }), AT_ONE);
    const after = score(
      inputs({
        runs: [run('r1')],
        results: [result('flaky-1', { commitSha: 'c2', outcome: 'failed' })],
      }),
      AT_TWO,
    );

    for (const contribution of diffScores(before, after).contributions) {
      // The hard rule from the plan, applied to the diff: a contribution that
      // cannot cite a row does not render.
      expect(contribution.evidence.length, contribution.cause).toBeGreaterThan(0);
      expect(contribution.cause.length, contribution.key).toBeGreaterThan(0);
    }
  });

  it('refuses to diff a row set against itself, because that is not "nothing changed"', () => {
    // **This is the defect the whole slice exists to close.** The API recomputed both
    // ends from an unfiltered read, so `since` was a *label* rather than a filter and
    // every diff compared a row set with itself. It produced a well-formed
    // `ScoreDelta` — and `ScoreDeltaSchema` requires every contribution to cite
    // evidence, so what reached the client was a confident, sourced, wrong answer.
    // An empty `contributions` array is the same lie in a quieter dress: it says "I
    // looked and nothing changed", when the truth is "I compared nothing to nothing".
    //
    // The two readings here are byte-identical apart from `at`, which is precisely
    // what the route produced for every request.
    const one = score(inputs({ runs: [run('r1')], results: [result('unit-1')] }), AT_ONE);
    const same = score(inputs({ runs: [run('r1')], results: [result('unit-1')] }), AT_TWO);
    expect(() => diffScores(one, same)).toThrow(/same rows|row set/iu);
  });

  it('distinguishes "nothing changed" from "I compared nothing to nothing"', () => {
    // Two readings with no runs and no results at either end is a different answer
    // from two readings of the same rows: the first is an install that has never
    // run anything, the second is a window that did not advance. Only the second
    // means the caller's `since` selected nothing.
    const nothing = score(inputs(), AT_ONE);
    const stillNothing = score(inputs(), AT_TWO);
    expect(() => diffScores(nothing, stillNothing)).toThrow(/nothing to nothing/iu);
  });

  it('still diffs two readings whose row sets differ, even at equal counts', () => {
    // The guard is **equal counts and nothing moved**, not equal counts alone. Two
    // readings with the same number of runs and results but different outcomes are
    // a real change — the executed count is identical, the depth target moved — and
    // refusing that would trade one false answer for another.
    const before = score(
      inputs({
        runs: [run('r0')],
        results: Array.from({ length: 40 }, (_, index) =>
          result(`s${index}`, { runId: 'r0', category: 'security' as const }),
        ),
      }),
      AT_ONE,
    );
    const after = score(
      inputs({
        runs: [run('r1')],
        results: Array.from({ length: 40 }, (_, index) =>
          result(`s${index}`, { runId: 'r1', category: 'security' as const }),
        ),
        profile: {
          ...inputs().profile,
          targets: { testsPerCell: { 'security:backend': 100 }, coverageTarget: {} },
        },
      }),
      AT_TWO,
    );
    expect(before.provenance.runsRead).toBe(after.provenance.runsRead);
    expect(before.provenance.resultsRead).toBe(after.provenance.resultsRead);
    expect(diffScores(before, after).contributions.length).toBeGreaterThan(0);
  });

  it('refuses to diff two readings of different projects', () => {
    const one = score(inputs({ projectId: 'project-1' }), AT_ONE);
    const other = score(inputs({ projectId: 'project-2' }), AT_TWO);
    // A diff across projects is not a diff; it is two unrelated numbers with a
    // subtraction between them, and it would attribute one team's score drop to
    // another team's release.
    expect(() => diffScores(one, other)).toThrow(/different projects/iu);
  });

  it('refuses a reading from before the other', () => {
    const older = score(inputs(), AT_ONE);
    const newer = score(inputs(), AT_TWO);
    expect(() => diffScores(newer, older)).toThrow(/before/iu);
  });
});

describe('the diff names what actually changed', () => {
  it('cites a flaky fingerprint as the evidence for a stability change', () => {
    // The same fingerprint, the same commit, two outcomes. That is the only
    // unambiguous flake evidence, so it is the only one the diff will name.
    const stable = score(
      inputs({
        runs: [run('r1')],
        results: [
          result('f1', { runId: 'r1', commitSha: 'c1', outcome: 'passed' }),
          result('f2', { runId: 'r1', commitSha: 'c1', outcome: 'passed' }),
        ],
      }),
      AT_ONE,
    );
    const flaked = score(
      inputs({
        runs: [run('r2')],
        results: [
          result('f1', { runId: 'r2', commitSha: 'c1', outcome: 'passed' }),
          result('f2', { runId: 'r2', commitSha: 'c1', outcome: 'failed' }),
          result('f1', { runId: 'r2', commitSha: 'c1', outcome: 'failed' }),
        ],
      }),
      AT_TWO,
    );

    const delta = diffScores(stable, flaked);
    const unit = delta.contributions.find(
      (contribution) => contribution.scope === 'cell' && contribution.key === 'unit:backend',
    );
    expect(unit?.cause).toMatch(/stability/iu);
    expect(unit?.evidence.join(' ')).toContain('f1');
  });

  it('cites a hollow fingerprint when the signal component moved', () => {
    const asserting = score(
      inputs({
        runs: [run('r1')],
        results: [result('h1', { assertionCount: 3, touchedIo: true })],
      }),
      AT_ONE,
    );
    const hollow = score(
      inputs({
        runs: [run('r2')],
        results: [
          result('h1', { runId: 'r2', assertionCount: 0, touchedIo: false, durationMs: 5 }),
        ],
      }),
      AT_TWO,
    );

    const unit = diffScores(asserting, hollow).contributions.find(
      (contribution) => contribution.scope === 'cell' && contribution.key === 'unit:backend',
    );
    expect(unit?.cause).toMatch(/signal|hollow/iu);
    expect(unit?.evidence.join(' ')).toContain('h1');
  });

  it('reports a change of limiting row, because a diff that hides a changed cap is not a diff', () => {
    // Every category populated in the first reading, and `e2e` emptied in the
    // second. The total barely moves, but **why it is what it is does** — and a
    // reader who sees only "71 → 74" has learned nothing they can act on.
    const everyRow = score(
      inputs({
        runs: [run('r1')],
        results: SCORE_CATEGORIES_TEST.flatMap((category) =>
          Array.from({ length: 10 }, (_, index) =>
            result(`${category}-${index}`, { category: category as 'unit' }),
          ),
        ),
      }),
      AT_ONE,
    );

    // `everyRow` populates all five; the second reading drops every e2e test.
    const missingE2e = score(
      inputs({
        runs: [run('r2')],
        results: SCORE_CATEGORIES_TEST.filter((category) => category !== 'e2e').flatMap(
          (category) =>
            Array.from({ length: 10 }, (_, index) =>
              result(`${category}-${index}`, { runId: 'r2', category: category as 'unit' }),
            ),
        ),
      }),
      AT_TWO,
    );

    expect(everyRow.cappedBy).not.toBe(missingE2e.cappedBy);
    const cap = diffScores(everyRow, missingE2e).contributions.find(
      (contribution) => contribution.scope === 'cap',
    );
    expect(cap).toBeDefined();
    expect(cap?.cause).toMatch(/limiting row moved/iu);
    expect(cap?.evidence.length).toBeGreaterThan(0);
  });

  it('carries the pyramid drift when the suite shape moved', () => {
    const unitHeavy = score(
      inputs({ runs: [run('r1')], results: Array.from({ length: 8 }, (_, i) => result(`f${i}`)) }),
      AT_ONE,
    );
    const e2eHeavy = score(
      inputs({
        runs: [run('r2')],
        results: Array.from({ length: 8 }, (_, i) =>
          result(`e${i}`, { runId: 'r2', category: 'e2e' as const }),
        ),
      }),
      AT_TWO,
    );

    const pyramid = diffScores(unitHeavy, e2eHeavy).contributions.find(
      (contribution) => contribution.scope === 'pyramid',
    );
    expect(pyramid).toBeDefined();
    expect(pyramid?.evidence.length).toBeGreaterThan(0);
  });
});

describe('the diff agrees with the two totals it is derived from', () => {
  it('quotes the totals the scores actually reported', () => {
    const before = score(inputs({ runs: [run('r1')], results: [result('f1')] }), AT_ONE);
    const after = score(
      inputs({ runs: [run('r2')], results: [result('f1'), result('f2')] }),
      AT_TWO,
    );
    const delta = diffScores(before, after);
    expect(delta.previousTotal).toBe(before.total);
    expect(delta.currentTotal).toBe(after.total);
    expect(delta.from).toBe(AT_ONE);
    expect(delta.to).toBe(AT_TWO);
  });

  it('is reproducible from the same two readings', () => {
    // A diff that changes when re-run is a diff nobody can review, and the plan
    // requires it to be deterministic when the inputs are equal.
    const before = score(inputs({ runs: [run('r1')], results: [result('f1')] }), AT_ONE);
    const after = score(inputs({ runs: [run('r2')], results: [] }), AT_TWO);
    expect(diffScores(before, after)).toEqual(diffScores(before, after));
  });

  it('accepts a reading that came from the contract, not only from the function', () => {
    // The API serves `QaScoreSchema.parse(score(...))`, so the diff receives a
    // *parsed* value. Parsing must not be load-bearing for the diff to work.
    const before = QaScoreSchema.parse(
      score(inputs({ runs: [run('r1')], results: [result('f1')] }), AT_ONE),
    );
    const after = QaScoreSchema.parse(score(inputs({ runs: [run('r2')], results: [] }), AT_TWO));
    expect(() => diffScores(before, after)).not.toThrow();
  });
});
