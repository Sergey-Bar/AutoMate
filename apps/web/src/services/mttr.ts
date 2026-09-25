/**
 * Mean Time To Recovery (MTTR) calculation.
 *
 * MTTR = average time between a test failure and the next passing run.
 */

export interface RunRecord {
  /** ISO timestamp or epoch ms */
  timestamp: string | number;
  /** Overall run status */
  status: 'passed' | 'failed';
}

export interface MttrResult {
  /** Average recovery time in milliseconds */
  avgRecoveryMs: number;
  /** Number of recovery events measured */
  recoveryCount: number;
}

function toMs(ts: string | number): number {
  if (typeof ts === 'number') return ts;
  return new Date(ts).getTime();
}

/**
 * Calculate MTTR from an ordered list of run records.
 *
 * Algorithm:
 * 1. Walk runs in chronological order.
 * 2. When a failure is encountered, record its timestamp.
 * 3. When the next pass is encountered after a failure, compute the gap.
 * 4. Average all gaps.
 *
 * @param runs - Run records ordered oldest → newest
 * @returns MttrResult with avgRecoveryMs and recoveryCount
 */
export function calculateMTTR(runs: RunRecord[]): MttrResult {
  if (runs.length === 0) {
    return { avgRecoveryMs: 0, recoveryCount: 0 };
  }

  const recoveries: number[] = [];
  let failureTs: number | null = null;

  for (const run of runs) {
    const ts = toMs(run.timestamp);

    if (run.status === 'failed') {
      // Record the first failure in a streak
      if (failureTs === null) {
        failureTs = ts;
      }
    } else if (run.status === 'passed' && failureTs !== null) {
      // Recovery: time from first failure to this pass
      recoveries.push(ts - failureTs);
      failureTs = null;
    }
  }

  if (recoveries.length === 0) {
    return { avgRecoveryMs: 0, recoveryCount: 0 };
  }

  const total = recoveries.reduce((sum, v) => sum + v, 0);
  return {
    avgRecoveryMs: Math.round(total / recoveries.length),
    recoveryCount: recoveries.length,
  };
}

/**
 * Format MTTR duration into a human-readable string.
 */
export function formatMttr(ms: number): string {
  if (ms === 0) return 'N/A';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}
