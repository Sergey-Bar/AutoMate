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

/** The part of a diff-coverage result the gate reads. `ratio` is 0–1, `null` when unmeasured. */
export interface GateDiffCoverage {
  ratio: number | null;
  executable: number;
}

function diffCoverageReason(
  minimum: number,
  diff: GateDiffCoverage | null | undefined,
): string | null {
  if (diff === null || diff === undefined || diff.ratio === null) {
    return `Diff coverage was not measured for this commit; the policy requires at least ${String(minimum)}%`;
  }
  const percent = diff.ratio * 100;
  if (percent >= minimum) return null;
  return `Diff coverage ${percent.toFixed(1)}% of ${String(diff.executable)} changed executable line${
    diff.executable === 1 ? '' : 's'
  }; the policy requires at least ${String(minimum)}%`;
}

function letterReason(minimum: HealthLetter, grade: HealthGrade): string | null {
  if (grade.letter === null) {
    return `The grade is incomplete, and the policy requires at least ${minimum}`;
  }
  return ORDER.indexOf(grade.letter) < ORDER.indexOf(minimum)
    ? `Graded ${grade.letter}; the policy requires at least ${minimum}`
    : null;
}

function plural(count: number, severity: string): string {
  return `${String(count)} new ${severity} finding${count === 1 ? '' : 's'}`;
}

/**
 * The delivery scorecard's verdict, when the policy gates on delivery (`gateOnDelivery`).
 * Passed only when gated, and then anything but `pass` fails: `insufficient` and
 * `not_configured` are numbers nobody measured, and — as with diff coverage — an unmeasured
 * number does not show the policy was met. Each reason is the scorecard's own sentence.
 */
export interface GateDelivery {
  status: 'pass' | 'fail' | 'insufficient' | 'not_configured';
  reasons: readonly string[];
}

/**
 * The AI-governance verdict on the pull request, when the policy enables it. Only `fail` fails
 * the gate; `not-applicable` is a human change, which the rules never govern (AIGOV-1).
 */
export interface GateAiGovernance {
  verdict: 'pass' | 'fail' | 'not-applicable';
  reasons: readonly string[];
}

const UNMEASURED: Readonly<Record<'insufficient' | 'not_configured', string>> = {
  insufficient: 'too little data',
  not_configured: 'not configured',
};

/** The reasons a gated scorecard adds: its own on `fail`, one "not measured" otherwise. */
function scorecardReasons(label: string, gatedOn: string, card: GateDelivery): string[] {
  if (card.status === 'pass') return [];
  if (card.status === 'fail') return card.reasons.map((reason) => `${label}: ${reason}`);
  const why = card.reasons.join(' ').replace(/\.$/u, '');
  return [
    `${label} was not measured (${UNMEASURED[card.status]})${why === '' ? '' : `: ${why}`}; the policy gates on ${gatedOn}`,
  ];
}

function verdictReasons(
  delivery: GateDelivery | null | undefined,
  aiGovernance: GateAiGovernance | null | undefined,
): string[] {
  return [
    ...(delivery === null || delivery === undefined
      ? []
      : scorecardReasons('Delivery', 'delivery', delivery)),
    ...(aiGovernance?.verdict === 'fail'
      ? aiGovernance.reasons.map((reason) => `AI governance: ${reason}`)
      : []),
  ];
}

/** One eval suite as the gate reads it. */
export interface GateEvalSuite {
  suite: string;
  /**
   * `no-baseline`: the default branch never ran the suite. `missing`: the default branch runs
   * it and this branch did not.
   */
  verdict: 'pass' | 'fail' | 'insufficient' | 'no-baseline' | 'missing';
  reasons: readonly string[];
}

/**
 * The agent-quality verdicts: each eval suite's comparison against the default branch, passed
 * only when the policy says `gateOnEvals` (`null` otherwise), and the runtime scorecard, passed
 * only when it says `gateOnRuntime`. Once gated, only a pass passes: an insufficient
 * comparison, a suite with no baseline, a suite the branch did not run, and an empty list —
 * nothing measured at all — each fail with a reason, the way unmeasured diff coverage does.
 */
export interface GateAgents {
  evals: readonly GateEvalSuite[] | null;
  runtime: GateDelivery | null;
}

const EVAL_DEFAULT_REASONS: Readonly<Record<Exclude<GateEvalSuite['verdict'], 'pass'>, string>> = {
  fail: 'regressed against the default branch',
  insufficient: 'too few attempts to tell a regression from noise',
  'no-baseline': 'the default branch has no run of this suite to compare against',
  missing: 'the suite runs on the default branch but did not run on this branch',
};

function evalReasons(evals: readonly GateEvalSuite[] | null): string[] {
  if (evals === null) return [];
  if (evals.length === 0) {
    return [
      'Evals were not measured: no eval run on this branch or the default branch; the policy gates on evals',
    ];
  }
  return evals.flatMap((suite) => {
    if (suite.verdict === 'pass') return [];
    if (suite.reasons.length > 0) {
      return suite.reasons.map((reason) => `Evals (${suite.suite}): ${reason}`);
    }
    return [
      `Evals (${suite.suite}): ${EVAL_DEFAULT_REASONS[suite.verdict]}; the policy gates on evals`,
    ];
  });
}

function agentReasons(agents: GateAgents | null | undefined): string[] {
  if (agents === null || agents === undefined) return [];
  const runtime =
    agents.runtime === null ? [] : scorecardReasons('Agent runtime', 'runtime', agents.runtime);
  return [...evalReasons(agents.evals), ...runtime];
}

/**
 * `diff` is the diff coverage of the commit being gated. With `minDiffCoverage` in the policy,
 * a missing one fails rather than passes: a number nobody measured is not above a minimum.
 * `delivery` is passed only when the policy gates on delivery, `aiGovernance` only when the
 * policy enables it.
 */
export function evaluateHealthGate(
  policy: HealthPolicy['gate'] | undefined,
  grade: HealthGrade,
  added: readonly Pick<CanonicalFinding, 'severity'>[],
  diff?: GateDiffCoverage | null,
  delivery?: GateDelivery | null,
  aiGovernance?: GateAiGovernance | null,
  agents?: GateAgents | null,
): GateVerdict {
  const critical = added.filter((finding) => finding.severity === 'critical').length;
  const high = added.filter((finding) => finding.severity === 'high').length;
  const maxCritical = policy?.maxNewCritical ?? DEFAULT_MAX_NEW_CRITICAL;
  const maxHigh = policy?.maxNewHigh;
  const reasons = [
    critical > maxCritical
      ? `${plural(critical, 'critical')} (at most ${String(maxCritical)} allowed)`
      : null,
    maxHigh !== undefined && high > maxHigh
      ? `${plural(high, 'high')} (at most ${String(maxHigh)} allowed)`
      : null,
    policy?.minLetter === undefined ? null : letterReason(policy.minLetter, grade),
    policy?.minDiffCoverage === undefined ? null : diffCoverageReason(policy.minDiffCoverage, diff),
    ...verdictReasons(delivery, aiGovernance),
    ...agentReasons(agents),
  ].filter((reason): reason is string => reason !== null);
  return {
    verdict: reasons.length === 0 ? 'passed' : 'failed',
    reasons,
    newFindings: { critical, high, total: added.length },
  };
}
