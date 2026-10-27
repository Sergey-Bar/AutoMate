import { describe, expect, it } from 'vitest';
import { failureSignature } from '@automate/reporting';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';
import type { TestRecord } from '../repositories/run-repository.js';
import type { QuarantineMatch } from '../execution/quarantine-excusal.js';
import { commitTests } from './commit-tests.js';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const COMMIT = 'abcdef1234567';

async function seed(statuses: Record<string, TestRecord['status']>, startedAt: string, id: string) {
  const repository = new InMemoryRunRepository();
  await repository.upsertRun({
    id,
    workspaceId: 'ws',
    phase: 'complete',
    outcome: 'failed',
    startedAt,
    finishedAt: startedAt,
    status: 'failed',
    total: Object.keys(statuses).length,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    durationMs: null,
    branch: 'main',
    commitSha: COMMIT,
    projectId: PROJECT,
    triggeredBy: 'ci',
  });
  for (const [title, status] of Object.entries(statuses)) {
    await repository.upsertTest({
      id: title,
      runId: id,
      title,
      file: 'a.spec.ts',
      stableId: `a.spec.ts › ${title}`,
      status,
      durationMs: 1,
      errorCode: null,
      errorMessage: null,
    });
  }
  return repository;
}

const approved = (title: string, status: QuarantineMatch['status'] = 'approved') => ({
  stableId: `a.spec.ts › ${title}`,
  testTitle: title,
  testFile: 'a.spec.ts',
  status,
});

describe('commitTests', () => {
  it('reads the latest run of the project on the commit through the gate’s own rule', async () => {
    const repository = await seed(
      { pays: 'failed', lists: 'passed', retries: 'flaky', waits: 'flaky' },
      '2026-10-26T10:00:00.000Z',
      'run-1',
    );
    const tests = await commitTests(
      {
        repository,
        quarantined: async () => [approved('pays'), approved('waits', 'pending')],
        reportErrors: async () => 0,
      },
      PROJECT,
      COMMIT,
    );
    expect(tests).toEqual({
      runId: 'run-1',
      total: 4,
      passed: 1,
      failed: 1,
      flaky: 2,
      reportErrors: 0,
      excused: true,
      quarantinedFailures: ['a.spec.ts › pays'],
      failures: [],
      // `waits` has a pending entry: someone has acted on it, so it is not listed.
      flakyUnquarantined: ['a.spec.ts › retries'],
      // Its one failure is excused, so there is nothing left to label.
      unlabelledFailures: 0,
    });
  });

  it('counts the unexcused failures whose cause nobody labelled', async () => {
    const repository = await seed(
      { pays: 'failed', refunds: 'failed', lists: 'passed' },
      '2026-10-26T10:00:00.000Z',
      'r-labels',
    );
    // `seed` writes no message; a failure with none has the signature of "failed with no message".
    const tests = await commitTests(
      {
        repository,
        quarantined: async () => [],
        reportErrors: async () => 0,
        labelledSignatures: async () => new Set<string>(),
      },
      PROJECT,
      COMMIT,
    );
    expect(tests?.unlabelledFailures).toBe(2);
    const labelled = await commitTests(
      {
        repository,
        quarantined: async () => [],
        reportErrors: async () => 0,
        labelledSignatures: async () =>
          new Set([failureSignature('failed with no message').signature]),
      },
      PROJECT,
      COMMIT,
    );
    expect(labelled?.unlabelledFailures).toBe(0);
  });

  it('never excuses a run with an error outside its tests', async () => {
    const repository = await seed(
      { pays: 'failed', lists: 'passed' },
      '2026-10-26T10:00:00.000Z',
      'r',
    );
    const tests = await commitTests(
      { repository, quarantined: async () => [approved('pays')], reportErrors: async () => 1 },
      PROJECT,
      COMMIT,
    );
    expect(tests?.excused).toBe(false);
  });

  it('answers null for a commit with no run, and for another project', async () => {
    const repository = await seed({ pays: 'passed' }, '2026-10-26T10:00:00.000Z', 'r');
    const deps = { repository, quarantined: async () => [], reportErrors: async () => 0 };
    expect(await commitTests(deps, PROJECT, 'fffffff')).toBeNull();
    expect(await commitTests(deps, '22222222-2222-4222-8222-222222222222', COMMIT)).toBeNull();
  });
});
