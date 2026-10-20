import { describe, expect, it } from 'vitest';
import { ReleaseReadinessCardSchema } from '@automate/shared-contracts';
import { buildDigest, evaluateReadiness, type ReadinessInput } from './readiness.js';

const AT = '2026-10-20T12:00:00.000Z';

/** A project in good order: every input present, every input passing. */
const HEALTHY: ReadinessInput = {
  projectId: 'p1',
  evaluatedAt: AT,
  runs: 12,
  gate: { status: 'passed', runId: 'run-9' },
  passRate: 98.5,
  passRateThreshold: 95,
  flakyRate: 0,
  maxFlakyRate: 0,
  coverage: { current: 91.2, delta: 0.4 },
  openQuarantine: 0,
};

describe('evaluateReadiness', () => {
  it('says go only when every input is present and passing', () => {
    const card = evaluateReadiness(HEALTHY);
    expect(ReleaseReadinessCardSchema.parse(card)).toEqual(card);
    expect(card.verdict).toBe('go');
    expect(card.reasons.map((reason) => reason.code)).toEqual([
      'gate',
      'pass-rate',
      'flaky',
      'coverage',
      'quarantine',
      'activity',
    ]);
    expect(card.reasons.every((reason) => reason.level === 'go')).toBe(true);
  });

  it.each([
    ['a failed gate', { gate: { status: 'failed', runId: 'run-9' } }, 'gate', 'no-go'],
    ['a pass rate under 80%', { passRate: 72 }, 'pass-rate', 'no-go'],
    ['a pass rate under its threshold', { passRate: 90 }, 'pass-rate', 'caution'],
    ['flakiness above the gate', { flakyRate: 3.2 }, 'flaky', 'caution'],
    ['falling coverage', { coverage: { current: 88, delta: -1.2 } }, 'coverage', 'caution'],
    ['open quarantine items', { openQuarantine: 2 }, 'quarantine', 'caution'],
    ['a warning gate', { gate: { status: 'warning', runId: 'run-9' } }, 'gate', 'caution'],
  ] as const)('turns %s into its verdict', (_name, patch, code, level) => {
    const card = evaluateReadiness({ ...HEALTHY, ...patch } as ReadinessInput);
    expect(card.verdict).toBe(level);
    expect(card.reasons[0]).toMatchObject({ code, level });
  });

  it('never reads a missing input as a pass', () => {
    const card = evaluateReadiness({
      ...HEALTHY,
      runs: 0,
      gate: null,
      passRate: null,
      flakyRate: null,
      coverage: { current: null, delta: null },
    });
    expect(card.verdict).toBe('caution');
    const levels = Object.fromEntries(card.reasons.map((reason) => [reason.code, reason.level]));
    expect(levels).toMatchObject({
      gate: 'unknown',
      'pass-rate': 'unknown',
      flaky: 'unknown',
      coverage: 'unknown',
      activity: 'unknown',
    });
    // The one input that is present and passing still says so, last.
    expect(card.reasons.at(-1)).toMatchObject({ code: 'quarantine', level: 'go' });
  });

  it('orders every no-go before every caution, unknowns after cautions, passes last', () => {
    const card = evaluateReadiness({
      ...HEALTHY,
      gate: { status: 'failed', runId: 'run-9' },
      openQuarantine: 1,
      coverage: { current: null, delta: null },
    });
    expect(card.verdict).toBe('no-go');
    expect(card.reasons.map((reason) => reason.level)).toEqual([
      'no-go',
      'caution',
      'unknown',
      'go',
      'go',
      'go',
    ]);
  });

  it('gives every reason its evidence', () => {
    const card = evaluateReadiness({ ...HEALTHY, flakyRate: 3.2, maxFlakyRate: 1 });
    expect(card.reasons[0]).toMatchObject({
      code: 'flaky',
      message: '3.2% of tests were flaky; the gate allows 1%',
    });
    expect(card.reasons.find((reason) => reason.code === 'gate')?.evidence).toBe('run run-9');
  });

  it('treats coverage with no earlier reading as known, not as falling', () => {
    const card = evaluateReadiness({ ...HEALTHY, coverage: { current: 80, delta: null } });
    expect(card.reasons.find((reason) => reason.code === 'coverage')).toMatchObject({
      level: 'go',
      message: 'Coverage is 80.0%, with no earlier reading to compare',
    });
  });
});

describe('buildDigest', () => {
  it('names what changed since the previous window, worst first', () => {
    const digest = buildDigest({
      current: {
        runs: 20,
        passRate: 91,
        flakyKeys: ['a', 'b', 'c'],
        failingKeys: ['x', 'y'],
        slowKeys: [{ key: 's', title: 'renders the table', changePct: 45 }],
      },
      previous: { runs: 10, passRate: 95, flakyKeys: ['a'], failingKeys: ['x'] },
      coverageDelta: -1.2,
    });
    expect(digest.map((item) => item.kind)).toEqual([
      'new-flaky',
      'new-failure',
      'pass-rate',
      'coverage',
      'newly-slow',
      'runs',
    ]);
    expect(digest[0]).toEqual({ kind: 'new-flaky', tone: 'bad', text: '2 new flaky tests' });
    expect(digest.find((item) => item.kind === 'pass-rate')?.text).toBe('Pass rate −4.0 pts');
    expect(digest.find((item) => item.kind === 'coverage')?.text).toBe('Coverage −1.2 pts');
    expect(digest.find((item) => item.kind === 'newly-slow')?.text).toBe(
      'renders the table is 45% slower',
    );
    expect(digest.find((item) => item.kind === 'runs')).toEqual({
      kind: 'runs',
      tone: 'neutral',
      text: '20 runs, up from 10',
    });
  });

  it('says good news as good news, and stays quiet about what did not change', () => {
    const digest = buildDigest({
      current: { runs: 5, passRate: 100, flakyKeys: [], failingKeys: [], slowKeys: [] },
      previous: { runs: 5, passRate: 90, flakyKeys: ['a'], failingKeys: [] },
      coverageDelta: 0.04,
    });
    expect(digest).toEqual([
      { kind: 'pass-rate', tone: 'good', text: 'Pass rate +10.0 pts' },
      { kind: 'new-flaky', tone: 'good', text: '1 flaky test fixed' },
    ]);
  });

  it('has nothing to say about a window with no runs and no earlier one', () => {
    expect(
      buildDigest({
        current: { runs: 0, passRate: null, flakyKeys: [], failingKeys: [], slowKeys: [] },
        previous: { runs: 0, passRate: null, flakyKeys: [], failingKeys: [] },
        coverageDelta: null,
      }),
    ).toEqual([]);
  });
});

describe('the readiness and digest wording', () => {
  it('counts one run in the singular, and a falling run count as down', () => {
    const card = evaluateReadiness({ ...HEALTHY, runs: 1 });
    expect(card.reasons.find((reason) => reason.code === 'activity')?.message).toBe(
      '1 run in the window',
    );
    expect(
      buildDigest({
        current: { runs: 3, passRate: null, flakyKeys: [], failingKeys: [], slowKeys: [] },
        previous: { runs: 8, passRate: null, flakyKeys: [], failingKeys: [] },
        coverageDelta: null,
      }),
    ).toEqual([{ kind: 'runs', tone: 'neutral', text: '3 runs, down from 8' }]);
  });
});
