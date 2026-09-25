export interface PerformanceMetrics {
  lcp: number; // Largest Contentful Paint in ms
  fid: number; // First Input Delay in ms
  cls: number; // Cumulative Layout Shift (unitless)
  tti: number; // Time to Interactive in ms
  bundleSize?: number; // Bundle size in KB
}

export interface PerformanceThresholds {
  lcp: number;
  fid: number;
  cls: number;
  tti: number;
  bundleSize?: number;
}

export interface BudgetResult {
  metric: string;
  value: number;
  threshold: number;
  pass: boolean;
  unit: string;
}

export const DEFAULT_THRESHOLDS: PerformanceThresholds = {
  lcp: 2500,
  fid: 100,
  cls: 0.1,
  tti: 3800,
  bundleSize: 500,
};

export function checkBudget(
  metrics: PerformanceMetrics,
  thresholds: PerformanceThresholds = DEFAULT_THRESHOLDS,
): BudgetResult[] {
  const results: BudgetResult[] = [
    {
      metric: 'LCP',
      value: metrics.lcp,
      threshold: thresholds.lcp,
      pass: metrics.lcp <= thresholds.lcp,
      unit: 'ms',
    },
    {
      metric: 'FID',
      value: metrics.fid,
      threshold: thresholds.fid,
      pass: metrics.fid <= thresholds.fid,
      unit: 'ms',
    },
    {
      metric: 'CLS',
      value: metrics.cls,
      threshold: thresholds.cls,
      pass: metrics.cls <= thresholds.cls,
      unit: '',
    },
    {
      metric: 'TTI',
      value: metrics.tti,
      threshold: thresholds.tti,
      pass: metrics.tti <= thresholds.tti,
      unit: 'ms',
    },
  ];

  if (metrics.bundleSize !== undefined && thresholds.bundleSize !== undefined) {
    results.push({
      metric: 'Bundle Size',
      value: metrics.bundleSize,
      threshold: thresholds.bundleSize,
      pass: metrics.bundleSize <= thresholds.bundleSize,
      unit: 'KB',
    });
  }

  return results;
}

export function getScoreColor(score: number): 'red' | 'yellow' | 'green' {
  if (score >= 90) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

export function metricToScore(metric: string, value: number): number {
  switch (metric) {
    case 'LCP': {
      if (value <= 1200) return 100;
      if (value >= 4000) return 0;
      return Math.round(100 - ((value - 1200) / (4000 - 1200)) * 100);
    }
    case 'FID': {
      if (value <= 50) return 100;
      if (value >= 300) return 0;
      return Math.round(100 - ((value - 50) / (300 - 50)) * 100);
    }
    case 'CLS': {
      if (value <= 0.05) return 100;
      if (value >= 0.25) return 0;
      return Math.round(100 - ((value - 0.05) / (0.25 - 0.05)) * 100);
    }
    case 'TTI': {
      if (value <= 2400) return 100;
      if (value >= 7300) return 0;
      return Math.round(100 - ((value - 2400) / (7300 - 2400)) * 100);
    }
    default:
      return 0;
  }
}
