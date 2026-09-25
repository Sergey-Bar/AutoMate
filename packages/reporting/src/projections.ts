import type { CanonicalRunResult as RunResult } from '@automate/shared-contracts';
import { CanonicalStatusSchema } from '@automate/shared-contracts';
import { fingerprint, NON_PRODUCT_STATUSES } from './policy.js';

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
  /** Non-product outcomes (blocked, configFailed, infraFailed, runnerFailed). */
  nonProduct: number;
  /** Every canonical status, including the non-product taxonomy values. */
  byStatus: Record<RunResult['status'], number>;
  completeness: RunResult['completeness']['state'];
  fingerprint: string;
}

export function projectRunSummary(result: RunResult): RunSummary {
  const counts: Record<RunResult['status'], number> = Object.fromEntries(
    CanonicalStatusSchema.options.map((status) => [status, 0]),
  ) as Record<RunResult['status'], number>;
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
    nonProduct: NON_PRODUCT_STATUSES.reduce((total, status) => total + counts[status], 0),
    byStatus: counts,
    completeness: result.completeness.state,
    fingerprint: fingerprint(result),
  };
}
