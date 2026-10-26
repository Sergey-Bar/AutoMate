import { describe, expect, it } from 'vitest';
import { ScorecardSchema } from '@automate/shared-contracts';
import {
  classifyDora,
  computeDora,
  DORA_BANDS,
  doraScorecard,
  type DoraChange,
  type DoraDeployment,
  type DoraIncident,
  type DoraInput,
} from './dora.js';

/**
 * A hand-computed fixture. Every number asserted below was worked out on paper from the
 * rows here, not read back from the implementation.
 *
 * Window: 28 days ending 2026-10-31T00:00Z, so the current window starts 2026-10-03 and
 * the previous one 2026-09-05.
 */
const NOW = new Date('2026-10-31T00:00:00.000Z');

const deployments: DoraDeployment[] = [
  // Previous window: two clean deployments.
  {
    id: 'p1',
    environment: 'production',
    status: 'success',
    createdAt: '2026-09-20T00:00:00.000Z',
    sha: 'p',
  },
  {
    id: 'p2',
    environment: 'production',
    status: 'success',
    createdAt: '2026-09-25T00:00:00.000Z',
    sha: 'q',
  },
  // Current window.
  {
    id: 'd1',
    environment: 'Production', // case-insensitive match
    status: 'success',
    createdAt: '2026-10-05T00:00:00.000Z',
    sha: 'b',
    shas: ['a', 'b'],
  },
  {
    id: 'd2',
    environment: 'production',
    status: 'failure',
    createdAt: '2026-10-10T00:00:00.000Z',
    sha: 'c',
  },
  {
    id: 'd3',
    environment: 'production',
    status: 'success',
    createdAt: '2026-10-10T02:00:00.000Z',
    sha: 'c2',
    shas: ['c', 'c2'],
    hotfix: true,
  },
  {
    id: 's1',
    environment: 'staging', // not production: ignored everywhere
    status: 'failure',
    createdAt: '2026-10-12T00:00:00.000Z',
    sha: 'x',
  },
  {
    id: 'd5',
    environment: 'production',
    status: 'success',
    createdAt: '2026-10-20T00:00:00.000Z',
    sha: 'd',
  },
  {
    id: 'd6',
    environment: 'production',
    status: 'success',
    createdAt: '2026-10-25T00:00:00.000Z',
    sha: 'e',
    unplanned: true,
  },
];

const changes: DoraChange[] = [
  { sha: 'p', firstCommitAt: '2026-09-19T00:00:00.000Z', mergedAt: null },
  { sha: 'a', firstCommitAt: '2026-10-04T00:00:00.000Z', mergedAt: null }, // 24h
  { sha: 'b', firstCommitAt: '2026-10-03T12:00:00.000Z', mergedAt: null }, // 36h
  { sha: 'c', firstCommitAt: '2026-10-09T00:00:00.000Z', mergedAt: null }, // 26h, via d3
  { sha: 'c2', firstCommitAt: '2026-10-10T01:00:00.000Z', mergedAt: null }, // 1h
  { sha: 'd', firstCommitAt: '2026-10-19T06:00:00.000Z', mergedAt: null }, // 18h
  { sha: 'e', firstCommitAt: '2026-10-24T12:00:00.000Z', mergedAt: null }, // 12h
  { sha: 'z', firstCommitAt: '2026-10-24T12:00:00.000Z', mergedAt: null }, // never deployed
];

const incidents: DoraIncident[] = [
  {
    id: 'i1',
    openedAt: '2026-10-20T01:00:00.000Z',
    resolvedAt: '2026-10-20T04:00:00.000Z',
    deploymentId: 'd5',
  },
  // Not caused by a deployment: outside DORA's failed-deployment definition.
  { id: 'i2', openedAt: '2026-10-21T00:00:00.000Z', resolvedAt: null, deploymentId: null },
];

const input: DoraInput = {
  deployments,
  changes,
  incidents,
  productionEnvironments: ['PRODUCTION'],
  now: NOW,
  windowDays: 28,
  minSample: 2,
};

describe('computeDora on the hand-computed fixture', () => {
  const result = computeDora(input);

  it('counts successful production deployments per week', () => {
    // d1, d3, d5, d6 over four weeks; previous window p1, p2.
    expect(result.metrics.deploymentFrequency).toEqual({
      value: 1,
      sampleSize: 4,
      band: 'high',
      status: 'measured',
      previous: 0.5,
      previousSampleSize: 2,
    });
  });

  it('takes the median lead time from first commit to the first successful deploy', () => {
    // [1, 12, 18, 24, 26, 36] → (18 + 24) / 2. `c` shipped in d3, not the failed d2.
    expect(result.metrics.changeLeadTime).toMatchObject({
      value: 21,
      sampleSize: 6,
      band: 'elite',
      status: 'measured',
      // Only `p` in the previous window: below minSample.
      previous: null,
      previousSampleSize: 1,
    });
  });

  it('counts a failed deploy and an incident-linked deploy as change failures', () => {
    // d2 (failed, then hotfixed by d3) and d5 (incident i1) of five.
    expect(result.metrics.changeFailureRate).toMatchObject({
      value: 0.4,
      sampleSize: 5,
      band: 'low',
      previous: 0,
    });
  });

  it('measures recovery to the next success or to incident resolution', () => {
    // d2 → d3 is 2h; i1 is open 3h. Median 2.5h.
    expect(result.metrics.recoveryTime).toMatchObject({
      value: 2.5,
      sampleSize: 2,
      band: 'high',
      previous: null,
      previousSampleSize: 0,
    });
  });

  it('reports rework rate with no tier', () => {
    // d3 (hotfix) and d6 (unplanned) of five.
    expect(result.metrics.reworkRate).toMatchObject({
      value: 0.4,
      sampleSize: 5,
      band: null,
      status: 'measured',
      previous: 0,
    });
  });

  it('records the window and the sample floor it used', () => {
    expect(result.windowDays).toBe(28);
    expect(result.minSample).toBe(2);
  });
});

describe('computeDora edge rules', () => {
  const base = (extra: Partial<DoraInput>): DoraInput => ({
    deployments: [],
    changes: [],
    incidents: [],
    productionEnvironments: ['production'],
    now: NOW,
    windowDays: 28,
    minSample: 1,
    ...extra,
  });
  const deploy = (id: string, createdAt: string, extra: Partial<DoraDeployment> = {}) => ({
    id,
    environment: 'production',
    status: 'success' as const,
    createdAt,
    sha: id,
    ...extra,
  });

  it('attributes a rollback to the latest deployment that shipped something new', () => {
    const result = computeDora(
      base({
        deployments: [
          deploy('a', '2026-10-05T00:00:00.000Z'),
          // A redeploy of `a`: ships nothing new, so it cannot be what the rollback undid.
          deploy('a-again', '2026-10-06T00:00:00.000Z', { sha: 'a' }),
          // Ships nothing at all.
          deploy('empty', '2026-10-06T06:00:00.000Z', { sha: null }),
          deploy('rb', '2026-10-07T00:00:00.000Z', { sha: 'a', rollback: true }),
        ],
      }),
    );
    // Only `a` failed; recovery is a → the next success (a-again), 24h.
    expect(result.metrics.changeFailureRate.value).toBe(0.25);
    expect(result.metrics.recoveryTime.value).toBe(24);
    expect(result.metrics.reworkRate.value).toBe(0.25);
  });

  it('blames nothing when no earlier deployment shipped a change', () => {
    const result = computeDora(
      base({
        deployments: [deploy('rb', '2026-10-07T00:00:00.000Z', { sha: null, hotfix: true })],
      }),
    );
    expect(result.metrics.changeFailureRate.value).toBe(0);
    expect(result.metrics.recoveryTime.status).toBe('insufficient');
  });

  it('does not recover a failure with no later success or with an open incident', () => {
    const result = computeDora(
      base({
        deployments: [
          deploy('f', '2026-10-05T00:00:00.000Z', { status: 'failure' }),
          deploy('g', '2026-10-06T00:00:00.000Z'),
          deploy('h', '2026-10-07T00:00:00.000Z', { status: 'failure' }),
        ],
        incidents: [
          {
            id: 'open',
            openedAt: '2026-10-06T01:00:00.000Z',
            resolvedAt: null,
            deploymentId: 'g',
          },
          {
            id: 'bad-time',
            openedAt: 'not a date',
            resolvedAt: '2026-10-06T02:00:00.000Z',
            deploymentId: 'g',
          },
        ],
      }),
    );
    // f, g (incident), h failed; f recovers at g (24h); g's incident is open; h never recovers.
    expect(result.metrics.changeFailureRate.value).toBe(1);
    expect(result.metrics.recoveryTime).toMatchObject({ value: 24, sampleSize: 1 });
  });

  it('spans every linked incident, earliest open to last resolution', () => {
    const result = computeDora(
      base({
        deployments: [deploy('g', '2026-10-06T00:00:00.000Z')],
        incidents: [
          {
            id: 'one',
            openedAt: '2026-10-06T01:00:00.000Z',
            resolvedAt: '2026-10-06T02:00:00.000Z',
            deploymentId: 'g',
          },
          {
            id: 'two',
            openedAt: '2026-10-06T03:00:00.000Z',
            resolvedAt: '2026-10-06T05:00:00.000Z',
            deploymentId: 'g',
          },
        ],
      }),
    );
    expect(result.metrics.recoveryTime.value).toBe(4);
  });

  it('drops a recovery that ends before it starts', () => {
    const result = computeDora(
      base({
        deployments: [deploy('g', '2026-10-06T00:00:00.000Z')],
        incidents: [
          {
            id: 'skew',
            openedAt: '2026-10-06T05:00:00.000Z',
            resolvedAt: '2026-10-06T01:00:00.000Z',
            deploymentId: 'g',
          },
        ],
      }),
    );
    expect(result.metrics.recoveryTime.sampleSize).toBe(0);
  });

  it('drops negative lead times, unparseable timestamps and redeploys of a shipped change', () => {
    const result = computeDora(
      base({
        deployments: [
          deploy('a', '2026-10-05T00:00:00.000Z'),
          deploy('a2', '2026-10-06T00:00:00.000Z', { sha: 'a', shas: ['late'] }),
          deploy('broken', 'yesterday'),
        ],
        changes: [
          { sha: 'a', firstCommitAt: '2026-10-04T00:00:00.000Z', mergedAt: null },
          { sha: 'late', firstCommitAt: '2026-10-07T00:00:00.000Z', mergedAt: null },
          { sha: 'broken', firstCommitAt: '2026-10-01T00:00:00.000Z', mergedAt: null },
          { sha: 'a', firstCommitAt: 'garbage', mergedAt: null },
        ],
      }),
    );
    // `a` is counted once (24h) though a2 redeployed it; `late` was first committed after
    // the deploy that carried it (clock skew); `broken` has no parseable deploy time; the
    // garbage timestamp is dropped.
    expect(result.metrics.changeLeadTime).toMatchObject({ value: 24, sampleSize: 1 });
    expect(result.metrics.deploymentFrequency.sampleSize).toBe(2);
  });

  it('orders simultaneous deployments by id so the result is stable', () => {
    const rows = [
      deploy('b', '2026-10-05T00:00:00.000Z', { status: 'failure' }),
      deploy('a', '2026-10-05T00:00:00.000Z'),
    ];
    const forward = computeDora(base({ deployments: rows }));
    const backward = computeDora(base({ deployments: [...rows].reverse() }));
    expect(forward).toEqual(backward);
    // a then b: b's failure never recovers.
    expect(forward.metrics.recoveryTime.sampleSize).toBe(0);
  });

  it('treats a metric below minSample as insufficient, with no band', () => {
    const result = computeDora(
      base({ deployments: [deploy('a', '2026-10-05T00:00:00.000Z')], minSample: 5 }),
    );
    for (const metric of Object.values(result.metrics)) {
      expect(metric.status).toBe('insufficient');
      expect(metric.value).toBeNull();
      expect(metric.band).toBeNull();
    }
  });

  it('defaults minSample to 5 and never lets it fall below 1', () => {
    expect(computeDora({ ...base({}), minSample: undefined }).minSample).toBe(5);
    const zero = computeDora(base({ minSample: 0 }));
    expect(zero.minSample).toBe(1);
    expect(zero.metrics.changeFailureRate.value).toBeNull();
  });

  it('refuses a window that is not a positive number of days', () => {
    expect(() => computeDora(base({ windowDays: 0 }))).toThrow(RangeError);
    expect(() => computeDora(base({ windowDays: Number.NaN }))).toThrow(RangeError);
  });
});

describe('classifyDora and DORA_BANDS', () => {
  it('cites the report the bands come from', () => {
    expect(DORA_BANDS.source).toContain('2024');
    expect(DORA_BANDS.url).toMatch(/^https:\/\/dora\.dev\//u);
    expect(DORA_BANDS.reworkRate).toBeNull();
  });

  it('places a value in the best tier whose published bound it meets', () => {
    expect(classifyDora('deploymentFrequency', 10)).toBe('elite');
    expect(classifyDora('deploymentFrequency', 7)).toBe('elite');
    expect(classifyDora('deploymentFrequency', 2)).toBe('high');
    expect(classifyDora('deploymentFrequency', 0.5)).toBe('medium');
    expect(classifyDora('deploymentFrequency', 0.1)).toBe('low');
    expect(classifyDora('deploymentFrequency', 0)).toBe('low');
    expect(classifyDora('changeLeadTime', 24)).toBe('elite');
    expect(classifyDora('changeLeadTime', 100)).toBe('high');
    expect(classifyDora('changeLeadTime', 500)).toBe('medium');
    expect(classifyDora('changeLeadTime', 10_000)).toBe('low');
    expect(classifyDora('recoveryTime', 0.5)).toBe('elite');
    expect(classifyDora('recoveryTime', 48)).toBe('low');
  });

  it('cannot reach medium change failure rate, because 2024 published it below high', () => {
    // 2024: elite 5%, high 20%, medium 10%, low 40%. Anything at or under 10% is already
    // within high's 20%, so the monotone rule never lands on medium.
    expect(classifyDora('changeFailureRate', 0.05)).toBe('elite');
    expect(classifyDora('changeFailureRate', 0.08)).toBe('high');
    expect(classifyDora('changeFailureRate', 0.2)).toBe('high');
    expect(classifyDora('changeFailureRate', 0.3)).toBe('low');
    expect(classifyDora('changeFailureRate', 0.9)).toBe('low');
  });

  it('gives rework rate no tier', () => {
    expect(classifyDora('reworkRate', 0.1)).toBeNull();
  });
});

describe('doraScorecard', () => {
  const result = computeDora(input);

  it('builds a valid card scored by the geometric mean of the tiers', () => {
    const card = ScorecardSchema.parse(doraScorecard(result, { now: NOW, windowDays: 28 }));
    expect(card.id).toBe('delivery');
    expect(card.dimension).toBe('delivery');
    expect(card.evaluatedAt).toBe(NOW.toISOString());
    expect(card.status).toBe('pass');
    // high 75, elite 100, low 25, high 75 → (75·100·25·75)^¼ = 61.237…
    expect(card.score).toBe(61.2);
    expect(card.cappedBy).toBe('change-failure-rate');
    expect(card.reasons).toEqual([]);
    const byKey = Object.fromEntries(card.metrics.map((metric) => [metric.key, metric]));
    expect(byKey['deployment-frequency']).toMatchObject({
      value: 1,
      unit: 'per-week',
      band: 'high',
      status: 'good',
      trend: 0.5,
      target: null,
    });
    expect(byKey['change-lead-time']).toMatchObject({ band: 'elite', trend: null });
    expect(byKey['change-failure-rate']).toMatchObject({ status: 'bad', trend: 0.4 });
    expect(byKey['failed-deployment-recovery-time']).toMatchObject({ status: 'good' });
    // Rework rose against the previous window and has no tier to judge it by.
    expect(byKey['rework-rate']).toMatchObject({ band: null, status: 'warn', trend: 0.4 });
  });

  it('fails with one reason per exceeded policy limit', () => {
    const card = ScorecardSchema.parse(
      doraScorecard(result, {
        now: NOW,
        windowDays: 28,
        policy: {
          maxChangeFailureRate: 0.15,
          maxLeadTimeHours: 12,
          minDeploysPerWeek: 2,
          maxRecoveryHours: 1,
        },
      }),
    );
    expect(card.status).toBe('fail');
    expect(card.reasons).toHaveLength(4);
    expect(card.reasons.join(' ')).toMatch(/change failure rate/iu);
    const failure = card.metrics.find((metric) => metric.key === 'change-failure-rate');
    expect(failure).toMatchObject({ target: 0.15, status: 'bad' });
    const lead = card.metrics.find((metric) => metric.key === 'change-lead-time');
    expect(lead).toMatchObject({ target: 12, status: 'bad' });
  });

  it('passes when every policy limit holds', () => {
    const card = doraScorecard(result, {
      now: NOW,
      windowDays: 28,
      policy: {
        maxChangeFailureRate: 0.5,
        maxLeadTimeHours: 48,
        minDeploysPerWeek: 1,
        maxRecoveryHours: 3,
      },
    });
    expect(card.status).toBe('pass');
  });

  it('is insufficient, unscored and uncapped when nothing has enough data', () => {
    const empty = computeDora({ ...input, deployments: [], changes: [], incidents: [] });
    const card = ScorecardSchema.parse(
      doraScorecard(empty, { now: NOW, windowDays: 28, policy: { maxChangeFailureRate: 0 } }),
    );
    expect(card.status).toBe('insufficient');
    expect(card.score).toBeNull();
    expect(card.cappedBy).toBeNull();
    expect(card.reasons).toEqual([]);
    for (const metric of card.metrics) {
      expect(metric.value).toBeNull();
      expect(metric.status).toBe('insufficient');
    }
  });

  it('marks a medium tier as a warning and steady rework as good', () => {
    const steady = computeDora({
      ...input,
      deployments: [
        {
          id: 'm1',
          environment: 'production',
          status: 'success',
          createdAt: '2026-10-05T00:00:00.000Z',
          sha: 'm1',
        },
        {
          id: 'm2',
          environment: 'production',
          status: 'success',
          createdAt: '2026-10-20T00:00:00.000Z',
          sha: 'm2',
        },
      ],
      changes: [],
      incidents: [],
    });
    const card = ScorecardSchema.parse(doraScorecard(steady, { now: NOW, windowDays: 28 }));
    const byKey = Object.fromEntries(card.metrics.map((metric) => [metric.key, metric]));
    expect(byKey['deployment-frequency']).toMatchObject({ band: 'medium', status: 'warn' });
    expect(byKey['rework-rate']).toMatchObject({ value: 0, status: 'good', trend: null });
  });
});
