/**
 * How a commit's tests went, for the pull-request comment.
 *
 * The latest run of the project on the commit (`RunRepository.latestRunForCommit`), its
 * tests, and the workspace quarantine, read through `excusesRun` — the function the gate and
 * `automate test` use — so the comment, the gate and the CI job say the same thing.
 */

import { storedTestIdentity } from '@automate/shared-contracts';
import { excusesRun, type QuarantineMatch } from '../execution/quarantine-excusal.js';
import type { ExecutionTestResult } from '../execution/types.js';
import type { RunRepository } from '../repositories/run-repository.js';

export interface CommitTests {
  runId: string;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  /** Errors outside any test; any one means the run is never excused. */
  reportErrors: number;
  /** Whether the run is excused: every failure quarantined, and something passed. */
  excused: boolean;
  /** Failed tests an approved entry excuses. */
  quarantinedFailures: string[];
  /** Failed tests nothing excuses. */
  failures: string[];
  /** Tests that passed only on a retry and that no entry, approved or pending, names. */
  flakyUnquarantined: string[];
}

export async function commitTests(
  deps: {
    repository: Pick<RunRepository, 'latestRunForCommit' | 'listTests'>;
    quarantined: () => Promise<readonly QuarantineMatch[]>;
    /** Errors outside any test in the run's canonical result (`reportErrors`). */
    reportErrors: (runId: string) => Promise<number>;
  },
  projectId: string,
  commit: string,
): Promise<CommitTests | null> {
  const run = await deps.repository.latestRunForCommit(projectId, commit);
  if (run === null) return null;
  const records = await deps.repository.listTests(run.id);
  const tests: ExecutionTestResult[] = records.map((record) => ({
    id: record.id,
    title: record.title,
    file: record.file,
    stableId: record.stableId,
    status: record.status === 'queued' || record.status === 'running' ? 'unknown' : record.status,
  }));
  const entries = await deps.quarantined();
  const reportErrors = await deps.reportErrors(run.id);
  const failedTests = tests.filter(
    (test) => test.status === 'failed' || test.status === 'timed_out',
  );
  const { excused, excusal } = excusesRun(
    {
      tests,
      summary: { ...summaryOf(tests), durationMs: null },
      error:
        reportErrors === 0
          ? null
          : { code: 'REPORT_ERROR', message: 'The report has errors outside its tests' },
    },
    entries,
  );
  const excusedIds = new Set(excusal.tests);
  const named = (test: ExecutionTestResult) =>
    entries.some((entry) =>
      entry.stableId !== null && entry.stableId !== ''
        ? entry.stableId === storedTestIdentity(test)
        : entry.testTitle === test.title && entry.testFile === (test.file ?? ''),
    );
  return {
    runId: run.id,
    total: tests.length,
    passed: tests.filter((test) => test.status === 'passed').length,
    failed: failedTests.length,
    flaky: tests.filter((test) => test.status === 'flaky').length,
    reportErrors,
    excused,
    quarantinedFailures: failedTests
      .map(storedTestIdentity)
      .filter((identity) => excusedIds.has(identity))
      .sort(),
    failures: failedTests
      .map(storedTestIdentity)
      .filter((identity) => !excusedIds.has(identity))
      .sort(),
    flakyUnquarantined: tests
      .filter((test) => test.status === 'flaky' && !named(test))
      .map(storedTestIdentity)
      .sort(),
  };
}

function summaryOf(tests: readonly ExecutionTestResult[]) {
  const count = (...statuses: ExecutionTestResult['status'][]) =>
    tests.filter((test) => statuses.includes(test.status)).length;
  return {
    total: tests.length,
    passed: count('passed'),
    failed: count('failed', 'timed_out'),
    flaky: count('flaky'),
    skipped: count('skipped'),
    blocked: count('blocked'),
    unknown: count('unknown'),
  };
}
