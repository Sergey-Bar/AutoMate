import { describe, expect, it } from 'vitest';
import { QaInsightsSchema } from '@automate/shared-contracts';
import { InMemoryExecutionStore } from './in-memory-execution-store.js';
import { belongsTo, buildInsights, createInsightsRoutes } from './insights.js';
import type { ExecutionRun, ExecutionTestResult } from './types.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');

function test(
  title: string,
  status: ExecutionTestResult['status'],
  durationMs: number | null = 100,
): ExecutionTestResult {
  return { id: title, title, file: 'a.spec.ts', status, durationMs };
}

let sequence = 0;
function run(
  createdAt: string,
  outcome: ExecutionRun['outcome'],
  tests: ExecutionTestResult[] = [],
  extra: Partial<ExecutionRun> = {},
): ExecutionRun {
  sequence += 1;
  return {
    id: `run-${String(sequence)}`,
    createdAt,
    completedAt: createdAt,
    outcome,
    suite: 'e2e',
    branch: 'main',
    projectId: 'p1',
    tests,
    summary: {
      total: tests.length,
      passed: 0,
      failed: 0,
      flaky: 0,
      skipped: 0,
      blocked: 0,
      unknown: 0,
      durationMs: null,
    },
    ...extra,
  } as ExecutionRun;
}

describe('buildInsights', () => {
  it('describes an empty window without inventing a number', () => {
    const insights = buildInsights([], NOW, 7, false);
    expect(QaInsightsSchema.parse(insights)).toEqual(insights);
    expect(insights.dates).toHaveLength(7);
    expect(insights.dates.at(-1)).toBe('2026-10-20');
    expect(insights.flakyLeaderboard).toEqual([]);
    expect(insights.mttr.overall).toEqual({
      recoveries: 0,
      medianMs: null,
      p90Ms: null,
      openSince: null,
    });
    expect(insights.digest).toEqual([]);
  });

  it('ranks flaky tests by flips and retries, and never ranks a test that only fails', () => {
    const insights = buildInsights(
      [
        run('2026-10-18T08:00:00.000Z', 'passed', [
          test('flips', 'passed'),
          test('broken', 'failed'),
          test('retried', 'flaky'),
        ]),
        run('2026-10-19T08:00:00.000Z', 'failed', [
          test('flips', 'failed'),
          test('broken', 'failed'),
          test('retried', 'passed'),
        ]),
        run('2026-10-20T08:00:00.000Z', 'passed', [
          test('flips', 'passed'),
          test('broken', 'failed'),
          test('retried', 'passed'),
        ]),
        // A run without a verdict for the test neither adds a flip nor breaks the chain.
        run('2026-10-20T09:00:00.000Z', 'cancelled', [test('flips', 'skipped')]),
      ],
      NOW,
      7,
      false,
    );
    expect(insights.flakyLeaderboard.map((entry) => entry.title)).toEqual(['flips', 'retried']);
    expect(insights.flakyLeaderboard[0]).toMatchObject({ runs: 4, flips: 2, flaky: 0, score: 0.5 });
    expect(insights.flakyLeaderboard[1]).toMatchObject({
      runs: 3,
      flips: 0,
      flaky: 1,
      score: 0.333,
    });
    expect(insights.flakyLeaderboard[0]?.key).toBe('a.spec.ts › flips');
  });

  it('ranks the slowest tests by p95 and compares the median with the window before', () => {
    const insights = buildInsights(
      [
        run('2026-10-10T08:00:00.000Z', 'passed', [test('slow', 'passed', 1000)]),
        run('2026-10-19T08:00:00.000Z', 'passed', [
          test('slow', 'passed', 1400),
          test('fast', 'passed', 10),
        ]),
        run('2026-10-20T08:00:00.000Z', 'passed', [
          test('slow', 'passed', 1600),
          test('fast', 'passed', null),
        ]),
      ],
      NOW,
      7,
      false,
    );
    const [slow, fast] = insights.slowestTests;
    expect(slow).toMatchObject({
      title: 'slow',
      samples: 2,
      p50Ms: 1400,
      p95Ms: 1600,
      previousP50Ms: 1000,
      changePct: 40,
    });
    expect(slow?.daily.slice(-2)).toEqual([1400, 1600]);
    expect(slow?.daily[0]).toBeNull();
    expect(fast).toMatchObject({ samples: 1, previousP50Ms: null, changePct: null });
    expect(insights.digest).toContainEqual({
      kind: 'newly-slow',
      tone: 'bad',
      text: 'slow is 40% slower',
    });
  });

  it('maps failures by suite and day, worst suite first', () => {
    const insights = buildInsights(
      [
        run('2026-10-19T08:00:00.000Z', 'failed', [], { suite: 'api' }),
        run('2026-10-20T08:00:00.000Z', 'failed', [], { suite: 'api' }),
        run('2026-10-20T09:00:00.000Z', 'passed', [], { suite: 'api' }),
        run('2026-10-20T08:00:00.000Z', 'passed', [], { suite: null }),
      ],
      NOW,
      7,
      false,
    );
    expect(insights.failureHeatmap.map((row) => row.suite)).toEqual(['api', 'unnamed suite']);
    expect(insights.failureHeatmap[0]?.failed).toBe(2);
    expect(insights.failureHeatmap[0]?.cells.slice(-2)).toEqual([
      { runs: 1, failed: 1 },
      { runs: 2, failed: 1 },
    ]);
  });

  it('measures recovery from the first failure to the next pass, and keeps an open incident open', () => {
    const insights = buildInsights(
      [
        run('2026-10-18T08:00:00.000Z', 'failed', [], { suite: 'api' }),
        run('2026-10-18T09:00:00.000Z', 'failed', [], { suite: 'api' }),
        run('2026-10-18T10:00:00.000Z', 'passed', [], { suite: 'api' }),
        run('2026-10-19T08:00:00.000Z', 'passed', [], { suite: 'web' }),
        run('2026-10-20T08:00:00.000Z', 'failed', [], { suite: 'web' }),
      ],
      NOW,
      7,
      false,
    );
    expect(insights.mttr.suites).toEqual([
      {
        suite: 'web',
        recoveries: 0,
        medianMs: null,
        p90Ms: null,
        openSince: '2026-10-20T08:00:00.000Z',
      },
      { suite: 'api', recoveries: 1, medianMs: 7_200_000, p90Ms: 7_200_000, openSince: null },
    ]);
    expect(insights.mttr.overall).toEqual({
      recoveries: 1,
      medianMs: 7_200_000,
      p90Ms: 7_200_000,
      openSince: '2026-10-20T08:00:00.000Z',
    });
  });

  it('reports pass rate by branch, with no verdict as no rate', () => {
    const insights = buildInsights(
      [
        run('2026-10-20T08:00:00.000Z', 'passed'),
        run('2026-10-20T09:00:00.000Z', 'failed'),
        run('2026-10-20T10:00:00.000Z', 'passed'),
        run('2026-10-20T10:30:00.000Z', 'cancelled', [], { branch: null }),
      ],
      NOW,
      7,
      false,
    );
    expect(insights.passRateByBranch).toEqual([
      { branch: 'main', runs: 3, passed: 2, failed: 1, passRate: 66.7 },
      { branch: 'unknown', runs: 1, passed: 0, failed: 0, passRate: null },
    ]);
  });

  it('digests new flaky tests and the change in pass rate against the window before', () => {
    const insights = buildInsights(
      [
        run('2026-10-10T08:00:00.000Z', 'passed', [test('t', 'passed')]),
        run('2026-10-11T08:00:00.000Z', 'passed', [test('t', 'passed')]),
        run('2026-10-19T08:00:00.000Z', 'passed', [test('t', 'flaky')]),
        run('2026-10-20T08:00:00.000Z', 'failed', [test('t', 'failed')]),
      ],
      NOW,
      7,
      false,
    );
    expect(insights.digest.map((item) => item.text)).toEqual([
      '1 new flaky test',
      '1 newly failing test',
      'Pass rate −50.0 pts',
    ]);
  });
});

describe('GET /api/v1/dashboard/insights', () => {
  it('counts a run with no project toward the project, and never another project’s run', () => {
    expect(belongsTo({ projectId: 'p1' }, 'p1')).toBe(true);
    expect(belongsTo({ projectId: null }, 'p1')).toBe(true);
    expect(belongsTo({ projectId: 'p2' }, 'p1')).toBe(false);
  });

  it('reads one workspace, filters by project, and falls back to 14 days', async () => {
    const store = new InMemoryExecutionStore();
    await store.create({ projectId: 'p1' }, 'k1', 'ws-1');
    await store.create({ projectId: 'p2' }, 'k2', 'ws-1');
    await store.create({ projectId: 'p1' }, 'k3', 'ws-other');
    const app = createInsightsRoutes({ store, workspaceId: 'ws-1' });

    const all = QaInsightsSchema.parse(
      await (await app.request('/api/v1/dashboard/insights?days=7')).json(),
    );
    expect(all.days).toBe(7);
    // The other workspace's run is not counted.
    expect(all.runs).toBe(2);
    const one = QaInsightsSchema.parse(
      await (await app.request('/api/v1/dashboard/insights?days=30&projectId=p1')).json(),
    );
    expect(one.runs).toBe(1);
    const fallback = QaInsightsSchema.parse(
      await (await app.request('/api/v1/dashboard/insights?days=11')).json(),
    );
    expect(fallback.days).toBe(14);
  });
});

describe('failure clusters and quarantine suggestions', () => {
  const failing = (title: string, message: string): ExecutionTestResult => ({
    ...test(title, 'failed'),
    error: { message },
  });

  it('groups failures by root cause and says how many causes there are', () => {
    const insights = buildInsights(
      [
        run('2026-10-18T08:00:00.000Z', 'failed', [
          failing('a', 'Error: connect ECONNREFUSED 127.0.0.1:5432'),
          failing('b', 'Error: connect ECONNREFUSED 127.0.0.1:6543'),
          failing('c', "TypeError: Cannot read properties of undefined (reading 'id')"),
          test('d', 'passed'),
        ]),
        run('2026-10-19T08:00:00.000Z', 'failed', [
          failing('a', 'Error: connect ECONNREFUSED 10.0.0.1:5432'),
          { ...test('e', 'timed_out'), error: null },
        ]),
      ],
      NOW,
      7,
      false,
    );
    expect(QaInsightsSchema.parse(insights)).toEqual(insights);
    expect(insights.failureClusters?.totals).toEqual({ failures: 5, causes: 3 });
    expect(insights.failureClusters?.summary).toBe('5 failures, 3 causes');
    expect(insights.failureClusters?.clusters[0]).toMatchObject({
      count: 3,
      runs: 2,
      tests: ['a.spec.ts › a', 'a.spec.ts › b'],
      sampleMessage: 'Error: connect ECONNREFUSED 127.0.0.1:5432',
    });
  });

  it('suggests quarantining a test that flips, never one that only fails, with the default thresholds', () => {
    const statuses: ExecutionTestResult['status'][] = [
      'passed',
      'failed',
      'passed',
      'flaky',
      'passed',
      'failed',
    ];
    const runs = statuses.map((status, index) =>
      run(
        `2026-10-${String(14 + index)}T08:00:00.000Z`,
        status === 'failed' ? 'failed' : 'passed',
        [
          { ...test('wobbly', status, 1000), attempt: status === 'flaky' ? 2 : 1 },
          test('broken', 'failed'),
          test('steady', 'passed'),
        ],
        status === 'failed'
          ? ({ policyEvaluation: { status: 'failed' } } as Partial<ExecutionRun>)
          : {},
      ),
    );
    const insights = buildInsights(runs, NOW, 7, false);
    expect(QaInsightsSchema.parse(insights)).toEqual(insights);
    expect(insights.quarantineSuggestions?.thresholds).toEqual({
      minScore: 0.2,
      minObservations: 5,
    });
    expect(insights.quarantineSuggestions?.suggestions).toEqual([
      expect.objectContaining({
        testKey: 'a.spec.ts › wobbly',
        observations: 6,
        retriesSpent: 1,
        wastedMs: 500,
        blockedRuns: 2,
      }),
    ]);
    // Fewer runs than the minimum: nothing is suggested.
    expect(
      buildInsights(runs.slice(0, 4), NOW, 7, false).quarantineSuggestions?.suggestions,
    ).toEqual([]);
  });
});

describe('test identity across Playwright projects', () => {
  /** One test, run in chromium (always passes) and webkit (always fails), on three runs. */
  function browsers(createdAt: string): ExecutionRun {
    return run(createdAt, 'failed', [
      {
        id: 'pays [chromium]',
        title: 'pays',
        file: 'a.spec.ts',
        status: 'passed',
        durationMs: 10,
        stableId: 'a.spec.ts › pays [chromium]',
      },
      {
        id: 'pays [webkit]',
        title: 'pays',
        file: 'a.spec.ts',
        status: 'failed',
        durationMs: 10,
        stableId: 'a.spec.ts › pays [webkit]',
        error: { message: 'Safari only' },
      },
    ]);
  }

  it('reads a webkit-only failure as broken, not flaky', () => {
    const insights = buildInsights(
      [
        browsers('2026-10-18T08:00:00.000Z'),
        browsers('2026-10-19T08:00:00.000Z'),
        browsers('2026-10-20T08:00:00.000Z'),
      ],
      NOW,
      7,
      false,
    );
    // Keyed on `file › title`, the two projects were one test that flipped on every
    // observation: score 1, the top of the leaderboard, and a quarantine suggestion.
    expect(insights.flakyLeaderboard).toEqual([]);
    expect(insights.quarantineSuggestions?.suggestions ?? []).toEqual([]);
    expect(insights.failureClusters?.clusters[0]?.tests).toEqual(['a.spec.ts › pays [webkit]']);
  });

  it('falls back to the legacy key for a result recorded before the identity existed', () => {
    const insights = buildInsights(
      [
        run('2026-10-18T08:00:00.000Z', 'passed', [test('old', 'flaky')]),
        run('2026-10-19T08:00:00.000Z', 'passed', [test('old', 'passed')]),
      ],
      NOW,
      7,
      false,
    );
    expect(insights.flakyLeaderboard[0]?.key).toBe('a.spec.ts › old');
  });
});

describe('which flake evidence automation may act on', () => {
  const at = (day: number, hour: number) =>
    `2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;

  it('never makes a test that was broken and then fixed on a branch eligible', () => {
    const history = [
      ['a1', 'passed'],
      ['b2', 'failed'],
      ['b2', 'failed'],
      ['c3', 'passed'],
      ['c3', 'passed'],
      ['c3', 'passed'],
    ] as const;
    const insights = buildInsights(
      history.map(([commit, status], index) =>
        run(at(15 + index, 8), status === 'passed' ? 'passed' : 'failed', [test('pays', status)], {
          commit,
          branch: 'fix/pay',
        }),
      ),
      NOW,
      7,
      false,
    );
    const [suggestion] = insights.quarantineSuggestions?.suggestions ?? [];
    // It is still ranked and suggested for a person to read: it did disagree with itself.
    expect(suggestion?.testKey).toBe('a.spec.ts › pays');
    expect(suggestion?.autoEligible).toBe(false);
    expect(suggestion?.evidence).toEqual({ retryPasses: 0, sameCommit: 0, crossCommitFlips: 2 });
  });

  it('makes a test that passed on a retry eligible', () => {
    const statuses = ['passed', 'flaky', 'passed', 'flaky', 'passed'] as const;
    const insights = buildInsights(
      statuses.map((status, index) =>
        run(
          at(15 + index, 8),
          'passed',
          [{ ...test('pays', status), attempt: status === 'flaky' ? 2 : 1 }],
          {
            commit: 'a1',
          },
        ),
      ),
      NOW,
      7,
      false,
    );
    const [suggestion] = insights.quarantineSuggestions?.suggestions ?? [];
    expect(suggestion?.autoEligible).toBe(true);
    expect(suggestion?.evidence?.retryPasses).toBe(2);
  });
});
