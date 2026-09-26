import { describe, expect, it } from 'vitest';
import { InMemoryExecutionStore } from './in-memory-execution-store.js';
import { isCoherentSummary } from './summary.js';
import type { CreateRunInput, ExecutionTestResult, JobCompletionInput } from './types.js';

/**
 * A summary's buckets must account for its total.
 *
 * `countTests` incremented `blocked` *and* `unknown` for a blocked test, and put
 * `cancelled` in `unknown` with no bucket of its own — so the buckets summed to
 * more than `total`. Any consumer dividing by `total` for a pass rate got a
 * number that could not exist, and a run of ten blocked tests reported twenty
 * observations.
 *
 * The second property is the fail-closed half: a runner's own summary is accepted
 * only if it accounts for its own total, and is otherwise replaced by a count of
 * the run's actual tests.
 */
function runBody(key: string): CreateRunInput {
  return {
    externalId: `external-${key}`,
    source: 'api',
    testType: 'browser',
    framework: 'playwright',
    timeoutMs: 60_000,
    requiredCapabilities: [],
    labels: [],
    configuration: {},
  };
}

function test(id: string, status: ExecutionTestResult['status']): ExecutionTestResult {
  return { id, title: id, file: `tests/${id}.spec.ts`, status, durationMs: 1 };
}

async function claimedJob() {
  const store = new InMemoryExecutionStore();
  const runner = await store.registerRunner(
    {
      id: 'runner-1',
      name: 'runner-1',
      version: '1.0.0',
      os: 'linux',
      arch: 'x64',
      capabilities: [],
      labels: [],
      slots: 1,
    },
    'a'.repeat(64),
    new Date(Date.now() + 3_600_000).toISOString(),
    'ws-summary',
  );
  const { run: created } = await store.createRun(runBody('summary-1'), 'summary-1', 'ws-summary');
  const claim = await store.claimJob(runner.id, [], [], undefined, 'ws-summary');
  if (claim === null) throw new Error('expected a claim');
  // The run id is a generated UUID; the idempotency key is not the id.
  return { store, claim, runId: created.id };
}

async function summaryOf(store: InMemoryExecutionStore, runId: string) {
  const run = await store.getRun(runId, 'ws-summary');
  const summary = run?.summary;
  expect(summary, `run ${runId} has no summary`).toBeDefined();
  return summary as NonNullable<typeof summary>;
}

describe('a derived summary is internally coherent', () => {
  it('puts each test in exactly one bucket', async () => {
    const statuses: ExecutionTestResult['status'][] = [
      'passed',
      'failed',
      'timed_out',
      'flaky',
      'skipped',
      'blocked',
      'unknown',
      'queued',
      'running',
      'cancelled',
    ];
    const tests = statuses.map((status, index) => test(`t-${index}-${status}`, status));
    // Ten tests, each in one bucket, so ten observations — not eleven, which is
    // what a blocked test used to produce.
    const expectedBuckets = statuses.filter((status) => status === 'blocked').length;

    const { store, claim, runId } = await claimedJob();
    await store.completeJob(
      claim.jobId,
      {
        leaseId: claim.leaseId,
        fencingToken: claim.fencingToken,
        status: 'passed',
        outcome: 'passed',
        tests,
      } as JobCompletionInput,
      'ws-summary',
    );
    const summary = await summaryOf(store, runId);
    expect(summary?.total).toBe(tests.length);
    expect(isCoherentSummary(summary)).toBe(true);
    expect(summary?.blocked).toBe(expectedBuckets);
    // A blocked test is counted once, not also as unknown.
    expect(summary?.unknown).toBe(
      statuses.filter((status) => ['unknown', 'queued', 'running', 'cancelled'].includes(status))
        .length,
    );
  });

  it('produces a coherent summary for an empty run rather than a dishonest one', async () => {
    const { store, claim, runId } = await claimedJob();
    await store.completeJob(
      claim.jobId,
      {
        leaseId: claim.leaseId,
        fencingToken: claim.fencingToken,
        status: 'passed',
        outcome: 'passed',
        tests: [],
        summary: { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, blocked: 0, unknown: 0 },
      } as JobCompletionInput,
      'ws-summary',
    );
    const summary = await summaryOf(store, runId);
    expect(summary?.total).toBe(0);
    expect(isCoherentSummary(summary)).toBe(true);
  });
});

describe('a reporter summary is believed only if it adds up', () => {
  const incoherent = {
    total: 3,
    passed: 1,
    failed: 1,
    flaky: 0,
    skipped: 0,
    blocked: 1,
    unknown: 1,
    durationMs: null,
  };

  it('rejects a summary whose buckets exceed its total and recounts instead', async () => {
    const { store, claim, runId } = await claimedJob();
    const tests = [test('a', 'passed'), test('b', 'failed')];
    await store.completeJob(
      claim.jobId,
      {
        leaseId: claim.leaseId,
        fencingToken: claim.fencingToken,
        status: 'passed',
        outcome: 'passed',
        tests,
        summary: incoherent,
      } as unknown as JobCompletionInput,
      'ws-summary',
    );
    const summary = await summaryOf(store, runId);
    // The claimed summary claimed 3 total with 3 observations plus a fourth; it
    // is not a slightly wrong number, it is an unverifiable claim, so the run's own
    // tests are counted instead.
    expect(summary?.total).toBe(2);
    expect(summary?.passed).toBe(1);
    expect(summary?.failed).toBe(1);
    expect(isCoherentSummary(summary)).toBe(true);
  });

  it('accepts a summary that does add up', async () => {
    const { store, claim, runId } = await claimedJob();
    const tests = [test('a', 'passed'), test('b', 'skipped')];
    await store.completeJob(
      claim.jobId,
      {
        leaseId: claim.leaseId,
        fencingToken: claim.fencingToken,
        status: 'passed',
        outcome: 'passed',
        tests,
        summary: {
          total: 2,
          passed: 1,
          failed: 0,
          flaky: 0,
          skipped: 1,
          blocked: 0,
          unknown: 0,
          durationMs: 2,
        },
      } as JobCompletionInput,
      'ws-summary',
    );
    const summary = await summaryOf(store, runId);
    expect(summary?.total).toBe(2);
    expect(summary?.skipped).toBe(1);
    expect(summary?.durationMs).toBe(2);
  });
});

describe('isCoherentSummary', () => {
  it('agrees only when the buckets account for the total', () => {
    const base = {
      total: 4,
      passed: 2,
      failed: 1,
      flaky: 0,
      skipped: 0,
      blocked: 1,
      unknown: 0,
      durationMs: null,
    };
    expect(isCoherentSummary(base)).toBe(true);
    expect(isCoherentSummary({ ...base, unknown: 1 })).toBe(false);
    expect(isCoherentSummary({ ...base, total: 5 })).toBe(false);
    expect(isCoherentSummary({ ...base, total: 0 })).toBe(false);
  });
});
