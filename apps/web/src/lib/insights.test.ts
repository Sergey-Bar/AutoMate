import { describe, expect, it } from 'vitest';
import {
  compareWindows,
  formatCount,
  formatDelta,
  formatDuration,
  orDash,
  shortDate,
  tally,
  verdictFor,
} from './insights.js';
import { makeTrend } from '../test-utils.js';

describe('before versus now', () => {
  it('calls a change better or worse in the direction that metric is good in', () => {
    expect(verdictFor(5, 'higher-is-better')).toBe('better');
    expect(verdictFor(-5, 'higher-is-better')).toBe('worse');
    expect(verdictFor(-5, 'lower-is-better')).toBe('better');
    expect(verdictFor(5, 'lower-is-better')).toBe('worse');
    expect(verdictFor(5, 'neutral')).toBe('same');
    expect(verdictFor(0, 'higher-is-better')).toBe('same');
    expect(verdictFor(null, 'higher-is-better')).toBe('unknown');
  });

  it('compares every metric of two windows and keeps a missing value missing', () => {
    const trend = makeTrend({ current: { passRate: null } });
    const comparisons = compareWindows(trend.previous, trend.current);
    expect(comparisons.map((entry) => entry.key)).toEqual([
      'passRate',
      'runs',
      'failedRuns',
      'avgDurationMs',
      'tests',
      'testsFailed',
      'flakyTests',
    ]);
    const passRate = comparisons[0];
    expect(passRate).toMatchObject({ before: 80, now: null, delta: null, verdict: 'unknown' });
    expect(comparisons.find((entry) => entry.key === 'avgDurationMs')).toMatchObject({
      delta: -1_000,
      verdict: 'better',
    });
    expect(tally(comparisons)).toEqual({ better: 3, worse: 0 });
  });
});

describe('formatting', () => {
  it('formats durations at three scales', () => {
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(4_200)).toBe('4.2 s');
    expect(formatDuration(192_000)).toBe('3m 12s');
  });

  it('signs a delta in the metric’s own unit, and dashes an absent one', () => {
    expect(formatDelta({ delta: 2, format: formatCount })).toBe('+2');
    expect(formatDelta({ delta: -1_500, format: formatDuration })).toBe('\u22121.5 s');
    expect(formatDelta({ delta: 0, format: formatCount })).toBe('±0');
    expect(formatDelta({ delta: null, format: formatCount })).toBe('—');
    expect(orDash(null, formatCount)).toBe('—');
    expect(formatCount(1234.4)).toBe('1,234');
  });

  it('labels a bucket by its UTC day', () => {
    expect(shortDate('2026-10-20')).toBe('Oct 20');
  });
});
