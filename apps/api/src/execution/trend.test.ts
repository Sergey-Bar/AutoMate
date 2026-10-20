import { describe, expect, it } from 'vitest';
import { AnalyticsTrendSchema } from '@automate/shared-contracts';
import { InMemoryExecutionStore } from './in-memory-execution-store.js';
import { buildTrend, createAnalyticsTrendRoutes } from './trend.js';
import type { ExecutionRun } from './types.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');

function run(
  createdAt: string,
  outcome: ExecutionRun['outcome'],
  extra: Partial<ExecutionRun> = {},
) {
  return {
    id: `run-${createdAt}-${String(outcome)}`,
    createdAt,
    outcome,
    startedAt: null,
    completedAt: null,
    summary: {
      total: 4,
      passed: 3,
      failed: 1,
      flaky: 1,
      skipped: 0,
      blocked: 0,
      unknown: 0,
      durationMs: 1_000,
    },
    ...extra,
  } as ExecutionRun;
}

describe('buildTrend', () => {
  it('buckets the last N days and compares them with the N days before', () => {
    const trend = buildTrend(
      [
        run('2026-10-20T09:00:00.000Z', 'passed'),
        run('2026-10-20T08:00:00.000Z', 'failed'),
        run('2026-10-19T08:00:00.000Z', 'cancelled'),
        // The earlier window: two days before the current one starts.
        run('2026-10-17T08:00:00.000Z', 'failed'),
        // Outside both windows, so in neither.
        run('2026-10-01T08:00:00.000Z', 'passed'),
      ],
      NOW,
      2,
      false,
    );
    expect(AnalyticsTrendSchema.parse(trend)).toEqual(trend);
    expect(trend.buckets.map((bucket) => bucket.date)).toEqual(['2026-10-19', '2026-10-20']);
    expect(trend.buckets[1]).toMatchObject({ runs: 2, passed: 1, failed: 1, passRate: 50 });
    // A cancelled run has no verdict, so the day has no pass rate rather than 0%.
    expect(trend.buckets[0]).toMatchObject({ runs: 1, other: 1, flaky: 0, passRate: null });
    expect(trend.current).toMatchObject({ runs: 3, passRate: 50, failedRuns: 1, flakyTests: 3 });
    expect(trend.previous).toMatchObject({ runs: 1, passRate: 0, failedRuns: 1 });
  });

  it('counts a partial run with a flaky test as flaky, apart from passed, failed and other', () => {
    const clean = { ...run('x', 'partial').summary, flaky: 0 };
    const trend = buildTrend(
      [
        run('2026-10-20T09:00:00.000Z', 'partial'),
        run('2026-10-20T09:10:00.000Z', 'partial', { summary: clean }),
        // A cancelled run is cancelled, whatever its tests did before it stopped.
        run('2026-10-20T09:20:00.000Z', 'cancelled'),
        run('2026-10-20T09:30:00.000Z', 'passed'),
      ],
      NOW,
      1,
      false,
    );
    const [day] = trend.buckets;
    expect(day).toMatchObject({ runs: 4, passed: 1, failed: 0, flaky: 1, other: 2 });
    expect((day?.passed ?? 0) + (day?.failed ?? 0) + (day?.flaky ?? 0) + (day?.other ?? 0)).toBe(4);
  });

  it('falls back to the run timestamps when the summary has no duration', () => {
    const trend = buildTrend(
      [
        run('2026-10-20T09:00:00.000Z', 'passed', {
          startedAt: '2026-10-20T09:00:00.000Z',
          completedAt: '2026-10-20T09:00:04.000Z',
          summary: { ...run('x', 'passed').summary, durationMs: null },
        }),
        run('2026-10-20T09:30:00.000Z', 'passed', {
          summary: { ...run('x', 'passed').summary, durationMs: null },
        }),
      ],
      NOW,
      1,
      false,
    );
    expect(trend.current.avgDurationMs).toBe(4_000);
    expect(buildTrend([], NOW, 1, false).current.avgDurationMs).toBeNull();
  });
});

describe('GET /api/v1/dashboard/analytics/trend', () => {
  it('reads the execution store, clamps the window, and returns a schema-valid series', async () => {
    const store = new InMemoryExecutionStore();
    await store.create({ projectId: 'p1' }, 'k1', 'ws-1');
    await store.create({ projectId: 'p1' }, 'k2', 'ws-other');
    const app = createAnalyticsTrendRoutes({ store, workspaceId: 'ws-1' });
    const response = await app.request('/api/v1/dashboard/analytics/trend?days=500');
    const trend = AnalyticsTrendSchema.parse(await response.json());
    expect(trend.days).toBe(90);
    expect(trend.buckets).toHaveLength(90);
    // One run in this workspace; the other workspace's run is not counted.
    expect(trend.current.runs).toBe(1);
    const fallback = AnalyticsTrendSchema.parse(
      await (await app.request('/api/v1/dashboard/analytics/trend?days=abc')).json(),
    );
    expect(fallback.days).toBe(14);
  });

  it('pages through the store and stops at the start of the earlier window', async () => {
    const store = new InMemoryExecutionStore();
    for (let index = 0; index < 120; index += 1) {
      await store.create({ projectId: 'p1' }, `k${String(index)}`, 'ws-1');
    }
    const app = createAnalyticsTrendRoutes({ store, workspaceId: 'ws-1' });
    const trend = AnalyticsTrendSchema.parse(
      await (await app.request('/api/v1/dashboard/analytics/trend?days=1')).json(),
    );
    expect(trend.current.runs).toBe(120);
    expect(trend.truncated).toBe(false);

    const later = createAnalyticsTrendRoutes({
      store,
      workspaceId: 'ws-1',
      now: () => new Date(Date.now() + 10 * 86_400_000),
    });
    const empty = AnalyticsTrendSchema.parse(
      await (await later.request('/api/v1/dashboard/analytics/trend?days=1')).json(),
    );
    expect(empty.current.runs).toBe(0);
  });
});
