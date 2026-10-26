import { describe, expect, it } from 'vitest';
import { METRIC_UNITS, type MetricUnit } from '@automate/shared-contracts';
import {
  formatMetricChange,
  formatMetricValue,
  isUnmeasured,
  trendVerdict,
  unmeasuredSentence,
} from './scorecard-view.js';

describe('formatting a metric by its unit', () => {
  const cases: ReadonlyArray<readonly [MetricUnit, number, string]> = [
    ['count', 1234.56, '1,234.6'],
    ['percent', 12.345, '12.3%'],
    ['ratio', 0.157, '15.7%'],
    ['ms', 850, '850 ms'],
    ['hours', 20, '20.0 h'],
    ['days', 1.25, '1.3 d'],
    ['per-day', 1.5, '1.50/day'],
    ['per-week', 4, '4.0/week'],
    ['usd', 0.0123, '$0.0123'],
    ['tokens', 12_300, '12.3K tokens'],
    ['score', 71.6, '72'],
  ];

  it('has a case for every unit the contract declares', () => {
    expect(cases.map(([unit]) => unit).sort()).toEqual([...METRIC_UNITS].sort());
  });

  it.each(cases)('formats %s', (unit, value, text) => {
    expect(formatMetricValue(value, unit)).toBe(text);
  });

  it('keeps cents on a dollar figure of one or more', () => {
    expect(formatMetricValue(12.5, 'usd')).toBe('$12.50');
  });

  it('signs a change in the same unit, and says ±0 for none', () => {
    expect(formatMetricChange(4, 'percent')).toBe('+4.0%');
    expect(formatMetricChange(-1.2, 'hours')).toBe('\u22121.2 h');
    expect(formatMetricChange(0, 'count')).toBe('±0');
  });
});

describe('a trend is only better in the metric’s own direction', () => {
  it.each([
    [5, 'higher-better', 'better'],
    [-5, 'higher-better', 'worse'],
    [5, 'lower-better', 'worse'],
    [-5, 'lower-better', 'better'],
    [0, 'lower-better', 'same'],
    [null, 'higher-better', 'unknown'],
  ] as const)('%s while %s reads as %s', (trend, direction, verdict) => {
    expect(trendVerdict(trend, direction)).toBe(verdict);
  });
});

describe('unmeasured states', () => {
  it('names insufficient and not-configured as unmeasured, and nothing else', () => {
    expect(isUnmeasured('insufficient')).toBe(true);
    expect(isUnmeasured('not_configured')).toBe(true);
    expect(isUnmeasured('good')).toBe(false);
    expect(isUnmeasured('fail')).toBe(false);
  });

  it('says why there is no score, and nothing for a measured card', () => {
    expect(unmeasuredSentence('insufficient')).toMatch(/Too little data/u);
    expect(unmeasuredSentence('not_configured')).toMatch(/Not configured/u);
    expect(unmeasuredSentence('pass')).toBeNull();
    expect(unmeasuredSentence('fail')).toBeNull();
  });
});
