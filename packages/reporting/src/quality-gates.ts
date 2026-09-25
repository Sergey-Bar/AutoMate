import type { CanonicalRunResult } from '@automate/shared-contracts';

export interface GatePolicy {
  requiredProof: 'verified';
  requiredCompleteness: 'complete';
  allowedStatuses: CanonicalRunResult['status'][];
}

export interface GateEvaluation {
  status: 'passed' | 'failed' | 'inconclusive';
  reasons: string[];
}

export function evaluateQualityGate(
  results: CanonicalRunResult[],
  policy: GatePolicy,
): GateEvaluation {
  const reasons: string[] = [];
  if (results.length === 0) reasons.push('no-runs');
  if (results.some((result) => result.proof.state !== policy.requiredProof)) {
    reasons.push('proof-ceiling-not-met');
  }
  if (results.some((result) => result.completeness.state !== policy.requiredCompleteness)) {
    reasons.push('completeness-not-met');
  }
  if (results.some((result) => !policy.allowedStatuses.includes(result.status))) {
    reasons.push('terminal-status-not-allowed');
  }
  if (
    results.some(
      (result) =>
        result.status === 'passed' &&
        result.evidence.length === 0 &&
        result.attempts.every((attempt) => attempt.evidence.length === 0) &&
        result.steps.every((step) => step.evidence.length === 0),
    )
  ) {
    reasons.push('missing-evidence');
  }
  if (reasons.length === 0) return { status: 'passed', reasons };
  if (
    reasons.includes('no-runs') ||
    reasons.includes('proof-ceiling-not-met') ||
    reasons.includes('missing-evidence')
  ) {
    return { status: 'inconclusive', reasons };
  }
  return { status: 'failed', reasons };
}
