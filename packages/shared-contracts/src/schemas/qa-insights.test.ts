import { describe, expect, it } from 'vitest';
import {
  FlakyTestSchema,
  MttrSchema,
  ProjectHistorySchema,
  QaInsightsSchema,
  ReleaseReadinessCardSchema,
} from './qa-insights.js';
import { ToolboxEntrySchema, QaCapabilitySchema, ToolKindSchema } from './repo-scan.js';
import { TrendBucketSchema } from './analytics-trend.js';

const ENTRY = {
  id: 'browserstack',
  name: 'BrowserStack',
  capability: 'e2e',
  description: 'Real browsers and devices in the cloud.',
  ecosystems: ['any'],
  status: 'available',
  priority: 'high',
  reason: 'An alternative for e2e.',
  setup: 'npx browserstack-node-sdk playwright test',
  docsUrl: 'https://www.browserstack.com/docs',
  pricing: 'paid',
  vendorUrl: 'https://www.browserstack.com/pricing',
};

describe('the toolbox entry carries a pricing tier', () => {
  it('accepts the three tiers and refuses anything else', () => {
    for (const pricing of ['free', 'freemium', 'paid']) {
      expect(ToolboxEntrySchema.safeParse({ ...ENTRY, pricing }).success).toBe(true);
    }
    expect(ToolboxEntrySchema.safeParse({ ...ENTRY, pricing: '$29/month' }).success).toBe(false);
  });

  it('requires the tier, and a vendor URL that is a URL when it is given', () => {
    const { pricing: _pricing, ...missing } = ENTRY;
    expect(ToolboxEntrySchema.safeParse(missing).success).toBe(false);
    expect(ToolboxEntrySchema.safeParse({ ...ENTRY, vendorUrl: 'pricing page' }).success).toBe(
      false,
    );
    const { vendorUrl: _vendor, ...free } = { ...ENTRY, pricing: 'free' };
    expect(ToolboxEntrySchema.safeParse(free).success).toBe(true);
  });

  it('knows the four capabilities the expanded toolbox added, as tool kinds too', () => {
    for (const capability of ['api', 'mobile', 'dast', 'test-management']) {
      expect(QaCapabilitySchema.safeParse(capability).success).toBe(true);
      expect(ToolKindSchema.safeParse(capability).success).toBe(true);
    }
  });
});

describe('the trend bucket counts flaky runs on their own', () => {
  it('requires the flaky count', () => {
    const bucket = {
      date: '2026-10-20',
      runs: 4,
      passed: 2,
      failed: 1,
      flaky: 1,
      other: 0,
      passRate: 66.7,
      avgDurationMs: null,
      tests: 10,
      testsFailed: 1,
    };
    expect(TrendBucketSchema.safeParse(bucket).success).toBe(true);
    const { flaky: _flaky, ...without } = bucket;
    expect(TrendBucketSchema.safeParse(without).success).toBe(false);
  });
});

describe('the insights contract', () => {
  it('bounds a flaky score to 0–1 and refuses a test seen in no run', () => {
    const flaky = {
      key: 'a.spec.ts › logs in',
      title: 'logs in',
      file: 'a.spec.ts',
      runs: 4,
      flaky: 1,
      flips: 2,
      score: 0.75,
      lastSeen: '2026-10-20T10:00:00.000Z',
    };
    expect(FlakyTestSchema.safeParse(flaky).success).toBe(true);
    expect(FlakyTestSchema.safeParse({ ...flaky, score: 1.5 }).success).toBe(false);
    expect(FlakyTestSchema.safeParse({ ...flaky, runs: 0 }).success).toBe(false);
  });

  it('lets MTTR be unknown and an incident be open, rather than forcing a zero', () => {
    expect(
      MttrSchema.safeParse({
        suite: 'e2e',
        recoveries: 0,
        medianMs: null,
        p90Ms: null,
        openSince: '2026-10-19T08:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('parses an empty window', () => {
    expect(
      QaInsightsSchema.safeParse({
        days: 7,
        from: '2026-10-14T00:00:00.000Z',
        to: '2026-10-21T00:00:00.000Z',
        dates: ['2026-10-14'],
        runs: 0,
        flakyLeaderboard: [],
        slowestTests: [],
        failureHeatmap: [],
        mttr: {
          overall: { recoveries: 0, medianMs: null, p90Ms: null, openSince: null },
          suites: [],
        },
        passRateByBranch: [],
        digest: [],
        truncated: false,
      }).success,
    ).toBe(true);
  });

  it('parses failure clusters and quarantine suggestions, and refuses a score over one', () => {
    const base = {
      days: 7,
      from: '2026-10-14T00:00:00.000Z',
      to: '2026-10-21T00:00:00.000Z',
      dates: ['2026-10-14'],
      runs: 2,
      flakyLeaderboard: [],
      slowestTests: [],
      failureHeatmap: [],
      mttr: {
        overall: { recoveries: 0, medianMs: null, p90Ms: null, openSince: null },
        suites: [],
      },
      passRateByBranch: [],
      digest: [],
      truncated: false,
      failureClusters: {
        clusters: [
          {
            signature: 'error: connect econnrefused <n>',
            errorType: 'Error',
            sampleMessage: 'Error: connect ECONNREFUSED 127.0.0.1:5432',
            count: 2,
            tests: ['a.spec.ts › a', 'b.spec.ts › b'],
            branches: ['main'],
            runs: 1,
            firstSeen: '2026-10-14T00:00:00.000Z',
            lastSeen: '2026-10-14T00:00:00.000Z',
          },
        ],
        totals: { failures: 2, causes: 1 },
        summary: '2 failures, 1 cause',
      },
    };
    const suggestion = {
      testKey: 'a.spec.ts › a',
      title: 'a',
      flakyScore: 0.5,
      observations: 6,
      retriesSpent: 2,
      wastedMs: 1200,
      blockedRuns: 1,
      reason: 'Disagreed with itself in 50% of 6 runs.',
    };
    const thresholds = { minScore: 0.2, minObservations: 5 };
    expect(
      QaInsightsSchema.safeParse({
        ...base,
        quarantineSuggestions: { thresholds, suggestions: [suggestion] },
      }).success,
    ).toBe(true);
    expect(
      QaInsightsSchema.safeParse({
        ...base,
        quarantineSuggestions: { thresholds, suggestions: [{ ...suggestion, flakyScore: 1.5 }] },
      }).success,
    ).toBe(false);
  });

  it('allows a history with no points yet, and says since when it has collected', () => {
    expect(
      ProjectHistorySchema.safeParse({
        projectId: 'p',
        days: 30,
        points: [],
        collectingSince: null,
      }).success,
    ).toBe(true);
  });

  it('refuses a readiness verdict with no reason behind it', () => {
    const card = {
      projectId: 'p',
      verdict: 'go',
      reasons: [],
      evaluatedAt: '2026-10-20T00:00:00.000Z',
    };
    expect(ReleaseReadinessCardSchema.safeParse(card).success).toBe(false);
    expect(
      ReleaseReadinessCardSchema.safeParse({
        ...card,
        reasons: [{ code: 'gate', level: 'unknown', message: 'No gate yet', evidence: 'no run' }],
      }).success,
    ).toBe(true);
  });
});
