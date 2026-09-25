import { describe, expect, it } from 'vitest';
import { InMemoryRunRepository } from './in-memory-run-repository.js';
import type { RunRecord, TestRecord } from './run-repository.js';

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run-1',
    startedAt: '2026-05-06T00:00:00.000Z',
    finishedAt: null,
    status: 'running',
    total: 2,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    durationMs: null,
    branch: null,
    commitSha: null,
    triggeredBy: 'reporter',
    ...overrides,
  };
}

function makeTest(overrides: Partial<TestRecord> = {}): TestRecord {
  return {
    id: 'test-1',
    runId: 'run-1',
    title: 'passes',
    file: 'tests/example.spec.ts',
    status: 'running',
    durationMs: null,
    ...overrides,
  };
}

describe('InMemoryRunRepository', () => {
  it('upserts runs idempotently by run id and returns defensive copies', async () => {
    const repo = new InMemoryRunRepository();
    const original = makeRun({ total: 1 });

    await repo.upsertRun(original);
    original.total = 99;
    await repo.upsertRun(makeRun({ total: 3, branch: 'main' }));

    const stored = await repo.getRun('run-1');

    expect(repo.getAllRuns()).toHaveLength(1);
    expect(stored).toMatchObject({ id: 'run-1', total: 3, branch: 'main' });
  });

  it('patches status, finish fields, and counter deltas without replacing unrelated values', async () => {
    const repo = new InMemoryRunRepository();
    await repo.upsertRun(makeRun({ total: 4, branch: 'feature/a' }));

    await repo.patchRun('run-1', {
      status: 'failed',
      finishedAt: '2026-05-06T00:00:10.000Z',
      durationMs: 10_000,
      passedDelta: 1,
      failedDelta: 2,
      skippedDelta: 1,
    });
    await repo.patchRun('run-1', { passedDelta: 1, flakyDelta: 1 });

    expect(await repo.getRun('run-1')).toMatchObject({
      status: 'failed',
      finishedAt: '2026-05-06T00:00:10.000Z',
      durationMs: 10_000,
      total: 4,
      passed: 2,
      failed: 2,
      flaky: 1,
      skipped: 1,
      branch: 'feature/a',
    });
  });

  it('treats patches for missing runs and tests as safe no-ops', async () => {
    const repo = new InMemoryRunRepository();

    await repo.patchRun('missing-run', { status: 'passed', passedDelta: 1 });
    await repo.patchTest('missing-test', 'missing-run', { status: 'failed', durationMs: 42 });

    expect(await repo.getRun('missing-run')).toBeNull();
    expect(await repo.getTest('missing-test', 'missing-run')).toBeNull();
    expect(repo.getAllRuns()).toEqual([]);
    expect(repo.getAllTests()).toEqual([]);
  });

  it('upserts and patches tests by composite test id and run id', async () => {
    const repo = new InMemoryRunRepository();

    await repo.upsertTest(makeTest({ id: 'same-id', runId: 'run-a', title: 'A' }));
    await repo.upsertTest(makeTest({ id: 'same-id', runId: 'run-b', title: 'B' }));
    await repo.upsertTest(makeTest({ id: 'same-id', runId: 'run-a', title: 'A updated' }));
    await repo.patchTest('same-id', 'run-a', { status: 'passed', durationMs: 123 });

    expect(repo.getAllTests()).toHaveLength(2);
    expect(await repo.getTest('same-id', 'run-a')).toMatchObject({
      title: 'A updated',
      status: 'passed',
      durationMs: 123,
    });
    expect(await repo.getTest('same-id', 'run-b')).toMatchObject({
      title: 'B',
      status: 'running',
      durationMs: null,
    });
    expect(await repo.listTests('run-a')).toHaveLength(1);
  });
});
