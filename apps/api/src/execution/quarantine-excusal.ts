/**
 * Which of a run's failures an approved quarantine excuses, and whether that is all of them.
 *
 * **Excusing is a reading, not a rewrite.** Nothing here changes a status: the run stays
 * `failed`, the test stays `failed`, and the summary still counts it. The gate reads the
 * excusal and passes the run as a warning; every other consumer — the trend, the flake
 * score, the history — keeps seeing what the producer reported, which is the only thing
 * that lets a quarantined test be released when it stops failing.
 *
 * A run is excused only when it is **completely** explained by quarantined tests:
 *
 * - at least one failed, timed-out or flaky test is matched by an `approved` entry;
 * - every failed and timed-out test is matched — one unexcused failure blocks as before;
 * - the run's own error is empty: a failure outside the tests (a global setup that threw, a
 *   reporter error) is not a test, and no quarantine entry is about it;
 * - the summary's failure count is the number of failures the tests show, so a run that
 *   says it failed five tests and lists three cannot be excused on the three.
 *
 * Matching: an entry with a `stableId` matches that identity only (one project, one
 * describe path). An entry recorded before identities existed has none, and matches by
 * title and file, in every project — the reading it had when it was approved.
 */

import { storedTestIdentity } from '@automate/shared-contracts';
import type { ExecutionRun, ExecutionTestResult } from './types.js';

export interface QuarantineMatch {
  stableId: string | null;
  testTitle: string;
  testFile: string;
  status: 'pending' | 'approved' | 'rejected' | 'released';
  /** The project the entry is about; `null` or absent matches the test in any project. */
  projectId?: string | null;
}

export interface QuarantineExcusal {
  /** True only when every failure is excused and there was at least one to excuse. */
  complete: boolean;
  /** Excused failed and timed-out tests. */
  excusedFailures: number;
  /** Excused flaky passes. */
  excusedFlaky: number;
  /** `excusedFailures + excusedFlaky`. */
  excused: number;
  /** Identities of the excused tests, sorted. */
  tests: string[];
}

type ExcusableRun = Pick<Partial<ExecutionRun>, 'tests' | 'summary' | 'error' | 'projectId'>;

const FAILED = new Set<ExecutionTestResult['status']>(['failed', 'timed_out']);

/**
 * Whether an entry is about this test. An entry naming a project is about that project's
 * test only; an entry naming none, or a run naming none, is matched on the test alone.
 */
export function quarantineMatches(
  entry: QuarantineMatch,
  test: Pick<ExecutionTestResult, 'title' | 'file' | 'stableId'>,
  projectId: string | null | undefined,
): boolean {
  if (
    entry.projectId !== undefined &&
    entry.projectId !== null &&
    projectId !== undefined &&
    projectId !== null &&
    entry.projectId !== projectId
  ) {
    return false;
  }
  if (entry.stableId !== null && entry.stableId !== '') {
    return entry.stableId === storedTestIdentity(test);
  }
  return entry.testTitle === test.title && entry.testFile === (test.file ?? '');
}

export function excuseQuarantined(
  run: ExcusableRun,
  entries: readonly QuarantineMatch[],
): QuarantineExcusal {
  const approved = entries.filter((entry) => entry.status === 'approved');
  const tests = run.tests ?? [];
  let failures = 0;
  let excusedFailures = 0;
  let excusedFlaky = 0;
  const excusedIds: string[] = [];
  for (const test of tests) {
    const failed = FAILED.has(test.status);
    if (failed) failures += 1;
    if (!failed && test.status !== 'flaky') continue;
    if (!approved.some((entry) => quarantineMatches(entry, test, run.projectId))) continue;
    if (failed) excusedFailures += 1;
    else excusedFlaky += 1;
    excusedIds.push(storedTestIdentity(test));
  }
  const excused = excusedFailures + excusedFlaky;
  const summaryFailures = run.summary?.failed ?? failures;
  const complete =
    excused > 0 &&
    excusedFailures === failures &&
    summaryFailures === failures &&
    (run.error === null || run.error === undefined);
  return {
    complete,
    excusedFailures,
    excusedFlaky,
    excused,
    tests: [...new Set(excusedIds)].sort(),
  };
}

/**
 * Whether the quarantine excuses this run: every failure excused (`excuseQuarantined`), and
 * at least one test passed. A run whose every test is quarantined has nothing left to pass
 * on, so it is not excused — the warning is for a run that proved something and carried
 * known noise. The gate and `POST /api/v1/projects/:id/tests/reports` both ask this, so a
 * CI job and the recorded gate cannot disagree about the same run.
 */
export function excusesRun(
  run: ExcusableRun,
  entries: readonly QuarantineMatch[],
): { excused: boolean; excusal: QuarantineExcusal } {
  const excusal = excuseQuarantined(run, entries);
  const passed =
    run.summary?.passed ?? (run.tests ?? []).filter((test) => test.status === 'passed').length;
  return { excused: excusal.complete && passed > 0, excusal };
}

/**
 * A quarantine source for a store bound to one workspace: that workspace's entries, and
 * nothing for any other. The dashboard's quarantine store is bound to the configured
 * workspace, so without this a run in a second workspace would be excused by the first
 * workspace's approvals.
 */
export function boundQuarantineSource(
  boundWorkspaceId: string,
  list: () => Promise<readonly QuarantineMatch[]>,
): (workspaceId: string) => Promise<readonly QuarantineMatch[]> {
  return async (workspaceId) => (workspaceId === boundWorkspaceId ? list() : []);
}
