import type { Attribution, AttributionMode } from './ai-attribution.js';

/**
 * The pull-request rules for change an AI agent wrote.
 *
 * The rules are the ones a team reaches for first when agents start opening pull
 * requests: a human must approve it, it must touch tests, its diff must be covered, and it
 * must not add high or critical findings. They are a gate on *agent* change, not a second
 * review policy for people: a human pull request is never subject to them (AIGOV-1), so
 * turning the gate on cannot slow down the team that did not ask for it.
 *
 * Unknown attribution is the hard case. Defaulting it to human keeps the gate from
 * blocking every commit made before attribution was set up; the `attributionNote` keeps
 * that choice visible on every verdict it affected, and `treatUnknownAs: 'agent-authored'`
 * is there for the team that would rather be strict.
 */

export interface GovernedPullRequest {
  attribution: Attribution;
  agent: string | null;
  humanApprovals: number;
  testsTouched: boolean;
  /** `null` when diff coverage was not measured. */
  diffCoverage: number | null;
  newHighFindings: number;
  newCriticalFindings: number;
}

export interface AiGovernancePolicy {
  /** Default `true`: the one rule that holds whenever the gate applies. */
  requireHumanApproval?: boolean;
  /** Default `false`. */
  requireTestsTouched?: boolean;
  /** In the same unit as `diffCoverage`. Unset means no coverage rule. */
  minDiffCoverage?: number;
  /** Unset means no findings rule. */
  maxNewHighOrCritical?: number;
  /** Default `['agent-authored']`. */
  applyTo?: readonly AttributionMode[];
  /** Default `'human'`. */
  treatUnknownAs?: 'human' | 'agent-authored';
}

export interface AiGovernanceVerdict {
  applies: boolean;
  verdict: 'pass' | 'fail' | 'not-applicable';
  /** One sentence per failed rule. */
  reasons: string[];
  /** Set exactly when the attribution was unknown and a default decided it. */
  attributionNote: string | null;
}

const DEFAULT_APPLY_TO: readonly AttributionMode[] = ['agent-authored'];

const MODE_LABEL: Readonly<Record<AttributionMode, string>> = {
  'agent-authored': 'Agent-authored',
  'ai-assisted': 'AI-assisted',
};

function validate(policy: AiGovernancePolicy): void {
  const { minDiffCoverage, maxNewHighOrCritical } = policy;
  if (minDiffCoverage !== undefined && !Number.isFinite(minDiffCoverage)) {
    throw new RangeError(`minDiffCoverage must be a finite number: ${minDiffCoverage}`);
  }
  if (
    maxNewHighOrCritical !== undefined &&
    (!Number.isInteger(maxNewHighOrCritical) || maxNewHighOrCritical < 0)
  ) {
    throw new RangeError(
      `maxNewHighOrCritical must be a non-negative integer: ${maxNewHighOrCritical}`,
    );
  }
}

/** Human approval (required unless switched off) and touched tests (only when asked for). */
function reviewReasons(pr: GovernedPullRequest, policy: AiGovernancePolicy, who: string): string[] {
  const reasons: string[] = [];
  if ((policy.requireHumanApproval ?? true) && pr.humanApprovals < 1) {
    reasons.push(`${who} needs at least one human approval; it has none.`);
  }
  if (policy.requireTestsTouched === true && !pr.testsTouched) {
    reasons.push(`${who} touches no tests.`);
  }
  return reasons;
}

/** Unmeasured coverage fails the rule: "not measured" is not "covered". */
function coverageReasons(pr: GovernedPullRequest, policy: AiGovernancePolicy): string[] {
  const minimum = policy.minDiffCoverage;
  if (minimum === undefined) return [];
  if (pr.diffCoverage === null) {
    return [`Diff coverage was not measured, and a minimum of ${minimum} is required.`];
  }
  if (pr.diffCoverage < minimum) {
    return [`Diff coverage ${pr.diffCoverage} is below the minimum of ${minimum}.`];
  }
  return [];
}

function findingReasons(pr: GovernedPullRequest, policy: AiGovernancePolicy): string[] {
  const maximum = policy.maxNewHighOrCritical;
  if (maximum === undefined) return [];
  const added = pr.newHighFindings + pr.newCriticalFindings;
  if (added <= maximum) return [];
  return [`It adds ${added} new high or critical findings; at most ${maximum} is allowed.`];
}

/**
 * Evaluate one pull request against the policy.
 *
 * Every failed rule is reported, not only the first, so an agent asked to fix its pull
 * request gets the whole list in one round. Coverage that was not measured fails a
 * coverage rule rather than passing it: an agent PR in a repository whose coverage job did
 * not run is exactly the PR the rule was written for, and "not measured" is not "covered".
 */
export function evaluateAiGovernance(
  pr: GovernedPullRequest,
  policy: AiGovernancePolicy,
): AiGovernanceVerdict {
  validate(policy);
  const unknown = pr.attribution === 'unknown';
  const effective: AttributionMode | 'human' =
    pr.attribution === 'unknown' ? (policy.treatUnknownAs ?? 'human') : pr.attribution;
  const attributionNote = unknown
    ? `Attribution was unknown; the change was treated as ${effective}.`
    : null;

  const applyTo = policy.applyTo ?? DEFAULT_APPLY_TO;
  if (effective === 'human' || !applyTo.includes(effective)) {
    return { applies: false, verdict: 'not-applicable', reasons: [], attributionNote };
  }

  const who = `${MODE_LABEL[effective]} change by ${pr.agent ?? 'an unnamed agent'}`;
  const reasons = [
    ...reviewReasons(pr, policy, who),
    ...coverageReasons(pr, policy),
    ...findingReasons(pr, policy),
  ];
  return {
    applies: true,
    verdict: reasons.length === 0 ? 'pass' : 'fail',
    reasons,
    attributionNote,
  };
}
