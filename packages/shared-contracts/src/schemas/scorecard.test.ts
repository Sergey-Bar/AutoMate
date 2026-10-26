import { describe, expect, it } from 'vitest';
import { HEALTH_DIMENSIONS } from './health.js';
import {
  HEATMAP_PROJECT_LIMIT,
  PortfolioHeatmapSchema,
  SCORECARD_IDS,
  ScorecardMetricSchema,
  ScorecardSchema,
  type ScorecardMetric,
} from './scorecard.js';

function metric(overrides: Partial<ScorecardMetric> = {}): ScorecardMetric {
  return {
    key: 'deployment-frequency',
    label: 'Deployment frequency',
    value: 1.4,
    unit: 'per-day',
    direction: 'higher-better',
    target: 1,
    trend: 0.2,
    sampleSize: 42,
    band: 'elite',
    status: 'good',
    summary: '1.4 production deploys a day',
    ...overrides,
  };
}

const card = {
  id: 'delivery',
  title: 'Delivery',
  dimension: 'delivery',
  evaluatedAt: '2026-10-26T00:00:00.000Z',
  windowDays: 30,
  status: 'pass',
  score: 88,
  cappedBy: 'deployment-frequency',
  metrics: [metric()],
  reasons: [],
} as const;

describe('the scorecard contract', () => {
  it('accepts a measured, passing scorecard', () => {
    expect(ScorecardSchema.safeParse(card).success).toBe(true);
  });

  it('refuses a value on a metric that has too few observations', () => {
    const result = ScorecardMetricSchema.safeParse(metric({ status: 'insufficient' }));
    expect(result.success).toBe(false);
  });

  it('refuses a measured status with no value', () => {
    const result = ScorecardMetricSchema.safeParse(metric({ value: null }));
    expect(result.success).toBe(false);
  });

  it('accepts a not-configured metric with no value', () => {
    const result = ScorecardMetricSchema.safeParse(
      metric({ value: null, status: 'not_configured', band: null }),
    );
    expect(result.success).toBe(true);
  });

  it('refuses a score that does not name what limited it', () => {
    expect(ScorecardSchema.safeParse({ ...card, cappedBy: null }).success).toBe(false);
  });

  it('refuses a failing scorecard that does not say why', () => {
    expect(ScorecardSchema.safeParse({ ...card, status: 'fail' }).success).toBe(false);
    expect(
      ScorecardSchema.safeParse({ ...card, status: 'fail', reasons: ['CFR 40% > 15%'] }).success,
    ).toBe(true);
  });

  it('accepts an unscored scorecard while nothing is measured', () => {
    expect(
      ScorecardSchema.safeParse({
        ...card,
        status: 'not_configured',
        score: null,
        cappedBy: null,
        metrics: [],
      }).success,
    ).toBe(true);
  });
});

describe('PortfolioHeatmapSchema', () => {
  const row = {
    projectId: '11111111-1111-4111-8111-111111111111',
    name: 'Checkout',
    slug: 'checkout',
    branch: 'main',
    score: null,
    letter: null,
    lastReportAt: null,
    dimensions: HEALTH_DIMENSIONS.map((dimension) => ({
      dimension,
      measured: false,
      score: null,
      letter: null,
    })),
    scorecards: SCORECARD_IDS.map((id) => ({ id, status: 'not_configured', score: null })),
  };
  const heatmap = {
    evaluatedAt: '2026-10-26T12:00:00.000Z',
    dimensions: [...HEALTH_DIMENSIONS],
    scorecards: [...SCORECARD_IDS],
    total: 1,
    limit: HEATMAP_PROJECT_LIMIT,
    truncated: false,
    projects: [row],
  };

  it('accepts every dimension and every scorecard for each project', () => {
    expect(PortfolioHeatmapSchema.parse(heatmap).projects).toHaveLength(1);
  });

  it('refuses a row missing a dimension or a scorecard, and more projects than the limit', () => {
    expect(
      PortfolioHeatmapSchema.safeParse({
        ...heatmap,
        projects: [{ ...row, dimensions: row.dimensions.slice(1) }],
      }).success,
    ).toBe(false);
    expect(
      PortfolioHeatmapSchema.safeParse({
        ...heatmap,
        projects: [{ ...row, scorecards: row.scorecards.slice(1) }],
      }).success,
    ).toBe(false);
    expect(
      PortfolioHeatmapSchema.safeParse({
        ...heatmap,
        projects: Array.from({ length: HEATMAP_PROJECT_LIMIT + 1 }, () => row),
      }).success,
    ).toBe(false);
  });
});
