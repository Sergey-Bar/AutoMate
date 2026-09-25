import { describe, it, expect } from 'vitest';
import {
  checkBudget,
  getScoreColor,
  metricToScore,
  DEFAULT_THRESHOLDS,
  type PerformanceMetrics,
  type PerformanceThresholds,
} from './performance-budget.js';

describe('checkBudget', () => {
  const goodMetrics: PerformanceMetrics = {
    lcp: 1000,
    fid: 50,
    cls: 0.05,
    tti: 2000,
    bundleSize: 300,
  };

  const badMetrics: PerformanceMetrics = {
    lcp: 5000,
    fid: 200,
    cls: 0.3,
    tti: 8000,
    bundleSize: 800,
  };

  it('returns pass for all metrics within thresholds', () => {
    const results = checkBudget(goodMetrics);
    expect(results.every(r => r.pass)).toBe(true);
  });

  it('returns fail for all metrics exceeding thresholds', () => {
    const results = checkBudget(badMetrics);
    expect(results.every(r => !r.pass)).toBe(true);
  });

  it('returns correct metric names', () => {
    const results = checkBudget(goodMetrics);
    const names = results.map(r => r.metric);
    expect(names).toContain('LCP');
    expect(names).toContain('FID');
    expect(names).toContain('CLS');
    expect(names).toContain('TTI');
    expect(names).toContain('Bundle Size');
  });

  it('includes value and threshold in each result', () => {
    const results = checkBudget(goodMetrics);
    const lcp = results.find(r => r.metric === 'LCP');
    expect(lcp).toBeDefined();
    expect(lcp!.value).toBe(1000);
    expect(lcp!.threshold).toBe(DEFAULT_THRESHOLDS.lcp);
  });

  it('omits bundleSize result when not provided in metrics', () => {
    const metrics: PerformanceMetrics = { lcp: 1000, fid: 50, cls: 0.05, tti: 2000 };
    const results = checkBudget(metrics);
    expect(results.find(r => r.metric === 'Bundle Size')).toBeUndefined();
  });

  it('uses custom thresholds when provided', () => {
    const custom: PerformanceThresholds = { lcp: 500, fid: 20, cls: 0.01, tti: 1000 };
    const results = checkBudget(goodMetrics, custom);
    // goodMetrics.lcp=1000 > custom.lcp=500 → fail
    const lcp = results.find(r => r.metric === 'LCP');
    expect(lcp!.pass).toBe(false);
  });

  it('returns correct units for each metric', () => {
    const results = checkBudget(goodMetrics);
    expect(results.find(r => r.metric === 'LCP')!.unit).toBe('ms');
    expect(results.find(r => r.metric === 'CLS')!.unit).toBe('');
    expect(results.find(r => r.metric === 'Bundle Size')!.unit).toBe('KB');
  });

  it('passes exactly at threshold boundary', () => {
    const boundary: PerformanceMetrics = {
      lcp: DEFAULT_THRESHOLDS.lcp,
      fid: DEFAULT_THRESHOLDS.fid,
      cls: DEFAULT_THRESHOLDS.cls,
      tti: DEFAULT_THRESHOLDS.tti,
    };
    const results = checkBudget(boundary);
    expect(results.every(r => r.pass)).toBe(true);
  });
});

describe('getScoreColor', () => {
  it('returns green for score >= 90', () => {
    expect(getScoreColor(90)).toBe('green');
    expect(getScoreColor(100)).toBe('green');
  });

  it('returns yellow for score 50-89', () => {
    expect(getScoreColor(50)).toBe('yellow');
    expect(getScoreColor(89)).toBe('yellow');
  });

  it('returns red for score < 50', () => {
    expect(getScoreColor(0)).toBe('red');
    expect(getScoreColor(49)).toBe('red');
  });
});

describe('metricToScore', () => {
  it('returns 100 for excellent LCP', () => {
    expect(metricToScore('LCP', 1000)).toBe(100);
  });

  it('returns 0 for very poor LCP', () => {
    expect(metricToScore('LCP', 5000)).toBe(0);
  });

  it('returns 100 for excellent FID', () => {
    expect(metricToScore('FID', 30)).toBe(100);
  });

  it('returns 0 for very poor FID', () => {
    expect(metricToScore('FID', 400)).toBe(0);
  });

  it('returns 100 for excellent CLS', () => {
    expect(metricToScore('CLS', 0.01)).toBe(100);
  });

  it('returns 0 for very poor CLS', () => {
    expect(metricToScore('CLS', 0.5)).toBe(0);
  });

  it('returns 100 for excellent TTI', () => {
    expect(metricToScore('TTI', 1000)).toBe(100);
  });

  it('returns 0 for very poor TTI', () => {
    expect(metricToScore('TTI', 10000)).toBe(0);
  });

  it('returns 0 for unknown metric', () => {
    expect(metricToScore('UNKNOWN', 100)).toBe(0);
  });
});
