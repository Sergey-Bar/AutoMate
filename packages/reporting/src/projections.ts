import type { CanonicalRunResult as RunResult } from '@automate/shared-contracts';
import { fingerprint } from './policy.js';

export interface RunSummary {
  id: string;
  workspaceId: string;
  projectId?: string;
  status: RunResult['status'];
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  timedOut: number;
  cancelled: number;
  unknown: number;
  completeness: RunResult['completeness']['state'];
  fingerprint: string;
}

export function projectRunSummary(result: RunResult): RunSummary {
  const counts: Record<RunResult['status'], number> = {
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    timedOut: 0,
    unknown: 0,
    cancelled: 0,
  };
  let total = 0;
  for (const attempt of result.attempts) {
    total += 1;
    counts[attempt.status] += 1;
  }
  return {
    id: result.identity.runId,
    workspaceId: result.identity.workspaceId,
    projectId: result.identity.projectId,
    status: result.status,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    total,
    passed: counts.passed,
    failed: counts.failed,
    flaky: counts.flaky,
    skipped: counts.skipped,
    timedOut: counts.timedOut,
    cancelled: counts.cancelled,
    unknown: counts.unknown,
    completeness: result.completeness.state,
    fingerprint: fingerprint(result),
  };
}
