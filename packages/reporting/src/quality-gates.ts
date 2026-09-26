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

/**
 * Every reason this gate can raise, and how bad it is.
 *
 * Ranked rather than checked in an `if` chain, because the previous chain
 * resolved ties in favour of the *weaker* verdict: a run that both failed a
 * policy status and failed its proof ceiling was reported `inconclusive`, so a
 * hard failure was downgraded to "we don't know". This product's promise is
 * evidence before claims, so a claim that cannot be evidenced is a failure, not
 * an unknown.
 *
 * `failed` reasons win over `inconclusive`, and the most severe reason decides
 * the verdict. Adding a reason without a classification is a type error.
 */
const REASON_SEVERITY = {
  /** A run's terminal status is not one the policy allows. */
  'terminal-status-not-allowed': 'failed',
  /** Shards are missing or duplicated, so the picture is incomplete. */
  'completeness-not-met': 'failed',
  /** A green claim whose evidence cannot be verified. */
  'missing-evidence': 'failed',
  /** A claim below the policy's proof ceiling. */
  'proof-ceiling-not-met': 'failed',
  /** Nothing to evaluate: the gate has no opinion yet. */
  'no-runs': 'inconclusive',
} as const satisfies Record<string, GateEvaluation['status']>;

type GateReason = keyof typeof REASON_SEVERITY;

const SEVERITY_RANK = { inconclusive: 1, failed: 2 } as const satisfies Record<
  'inconclusive' | 'failed',
  number
>;

function worstReason(reasons: readonly GateReason[]): GateEvaluation['status'] {
  let worst: 'inconclusive' | 'failed' | undefined;
  for (const reason of reasons) {
    const severity = REASON_SEVERITY[reason];
    if (worst === undefined || SEVERITY_RANK[severity] > SEVERITY_RANK[worst]) worst = severity;
  }
  return worst ?? 'passed';
}

export function evaluateQualityGate(
  results: CanonicalRunResult[],
  policy: GatePolicy,
): GateEvaluation {
  const reasons: GateReason[] = [];
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
  return { status: worstReason(reasons), reasons };
}
