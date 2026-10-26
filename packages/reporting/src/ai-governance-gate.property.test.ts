import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  evaluateAiGovernance,
  type AiGovernancePolicy,
  type AiGovernanceVerdict,
  type GovernedPullRequest,
} from './ai-governance-gate.js';

/**
 * Property suite for AIGOV-1: a `human` pull request is always not-applicable, under any
 * policy and whatever its approvals, tests, coverage and findings.
 *
 * Fixed seed and `numRuns`, so a red run reproduces on any host. The policy generator
 * includes the strictest settings — every rule on, applied to both AI modes, unknown
 * treated as agent-authored — since those are the ones that would catch a human by mistake.
 */
const SEED = 20261027;
const params = { seed: SEED, numRuns: 500 } as const;

const policy: fc.Arbitrary<AiGovernancePolicy> = fc.record(
  {
    requireHumanApproval: fc.boolean(),
    requireTestsTouched: fc.boolean(),
    minDiffCoverage: fc.double({ min: 0, max: 100, noNaN: true }),
    maxNewHighOrCritical: fc.nat({ max: 5 }),
    applyTo: fc.subarray(['agent-authored', 'ai-assisted'] as const),
    treatUnknownAs: fc.constantFrom('human' as const, 'agent-authored' as const),
  },
  { requiredKeys: [] },
);

const humanPr: fc.Arbitrary<GovernedPullRequest> = fc.record({
  attribution: fc.constant('human' as const),
  agent: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
  humanApprovals: fc.nat({ max: 3 }),
  testsTouched: fc.boolean(),
  diffCoverage: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: null }),
  newHighFindings: fc.nat({ max: 10 }),
  newCriticalFindings: fc.nat({ max: 10 }),
});

function notApplicable(verdict: AiGovernanceVerdict): boolean {
  return (
    !verdict.applies &&
    verdict.verdict === 'not-applicable' &&
    verdict.reasons.length === 0 &&
    verdict.attributionNote === null
  );
}

describe('AIGOV-1: a human PR is always not-applicable', () => {
  it('holds under any policy', () => {
    fc.assert(
      fc.property(humanPr, policy, (pr, rules) => {
        expect(notApplicable(evaluateAiGovernance(pr, rules))).toBe(true);
      }),
      params,
    );
  });

  it('pins the strictest policy against the weakest human PR', () => {
    const examples: [GovernedPullRequest, AiGovernancePolicy][] = [
      [
        {
          attribution: 'human',
          agent: 'claude-code',
          humanApprovals: 0,
          testsTouched: false,
          diffCoverage: null,
          newHighFindings: 9,
          newCriticalFindings: 9,
        },
        {
          requireHumanApproval: true,
          requireTestsTouched: true,
          minDiffCoverage: 100,
          maxNewHighOrCritical: 0,
          applyTo: ['agent-authored', 'ai-assisted'],
          treatUnknownAs: 'agent-authored',
        },
      ],
    ];
    for (const [pr, rules] of examples) {
      expect(notApplicable(evaluateAiGovernance(pr, rules))).toBe(true);
    }
  });
});

describe('the property harness can fail', () => {
  it('refutes a gate that applies its rules to everyone', () => {
    // The obvious shortcut — ignore attribution and run the rules — must be caught.
    const everyone = (pr: GovernedPullRequest, rules: AiGovernancePolicy) =>
      evaluateAiGovernance(
        { ...pr, attribution: 'agent-authored' },
        { ...rules, applyTo: undefined },
      );
    const outcome = fc.check(
      fc.property(humanPr, policy, (pr, rules) => notApplicable(everyone(pr, rules))),
      params,
    );
    expect(outcome.failed).toBe(true);
  });
});
