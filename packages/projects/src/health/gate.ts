import type {
  CanonicalFinding,
  HealthGrade,
  HealthLetter,
  HealthPolicy,
} from '@automate/shared-contracts';

/**
 * The pull-request gate: does this branch make the repository worse than policy allows?
 *
 * It reads two things and nothing else — the branch's grade and the findings the branch has
 * that the default branch does not. A finding already on the default branch is not this
 * pull request's to fix, which is what keeps a gate on an old repository from failing every
 * change until someone pays down a backlog nobody asked them to touch.
 *
 * With no policy the default is the one rule nobody argues with: no new critical finding.
 */
export interface GateVerdict {
  verdict: 'passed' | 'failed';
  reasons: string[];
  newFindings: { critical: number; high: number; total: number };
}

export const DEFAULT_MAX_NEW_CRITICAL = 0;

const ORDER: readonly HealthLetter[] = ['F', 'D', 'C', 'B', 'A', 'A+'];

export function evaluateHealthGate(
  policy: HealthPolicy['gate'] | undefined,
  grade: HealthGrade,
  added: readonly Pick<CanonicalFinding, 'severity'>[],
): GateVerdict {
  const critical = added.filter((finding) => finding.severity === 'critical').length;
  const high = added.filter((finding) => finding.severity === 'high').length;
  const reasons: string[] = [];
  const maxCritical = policy?.maxNewCritical ?? DEFAULT_MAX_NEW_CRITICAL;
  if (critical > maxCritical) {
    reasons.push(
      `${String(critical)} new critical finding${critical === 1 ? '' : 's'} (at most ${String(maxCritical)} allowed)`,
    );
  }
  if (policy?.maxNewHigh !== undefined && high > policy.maxNewHigh) {
    reasons.push(
      `${String(high)} new high finding${high === 1 ? '' : 's'} (at most ${String(policy.maxNewHigh)} allowed)`,
    );
  }
  if (policy?.minLetter !== undefined) {
    if (grade.letter === null) {
      reasons.push(`The grade is incomplete, and the policy requires at least ${policy.minLetter}`);
    } else if (ORDER.indexOf(grade.letter) < ORDER.indexOf(policy.minLetter)) {
      reasons.push(`Graded ${grade.letter}; the policy requires at least ${policy.minLetter}`);
    }
  }
  return {
    verdict: reasons.length === 0 ? 'passed' : 'failed',
    reasons,
    newFindings: { critical, high, total: added.length },
  };
}
