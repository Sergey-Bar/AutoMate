import { describe, expect, it } from 'vitest';
import { evaluateAiGovernance, type GovernedPullRequest } from './ai-governance-gate.js';

const agentPr: GovernedPullRequest = {
  attribution: 'agent-authored',
  agent: 'github-copilot',
  humanApprovals: 1,
  testsTouched: true,
  diffCoverage: 0.9,
  newHighFindings: 0,
  newCriticalFindings: 0,
};

describe('evaluateAiGovernance', () => {
  it('passes an agent PR that meets every rule', () => {
    expect(
      evaluateAiGovernance(agentPr, {
        requireHumanApproval: true,
        requireTestsTouched: true,
        minDiffCoverage: 0.8,
        maxNewHighOrCritical: 0,
      }),
    ).toEqual({ applies: true, verdict: 'pass', reasons: [], attributionNote: null });
  });

  it('requires a human approval by default', () => {
    const result = evaluateAiGovernance({ ...agentPr, humanApprovals: 0 }, {});
    expect(result.verdict).toBe('fail');
    expect(result.reasons).toEqual([
      'Agent-authored change by github-copilot needs at least one human approval; it has none.',
    ]);
    expect(
      evaluateAiGovernance({ ...agentPr, humanApprovals: 0 }, { requireHumanApproval: false })
        .verdict,
    ).toBe('pass');
  });

  it('fails an agent PR that touches no tests when tests are required', () => {
    const result = evaluateAiGovernance(
      { ...agentPr, testsTouched: false },
      { requireTestsTouched: true },
    );
    expect(result.verdict).toBe('fail');
    expect(result.reasons).toEqual(['Agent-authored change by github-copilot touches no tests.']);
    expect(evaluateAiGovernance({ ...agentPr, testsTouched: false }, {}).verdict).toBe('pass');
  });

  it('fails diff coverage below the floor, and coverage nobody measured', () => {
    const low = evaluateAiGovernance({ ...agentPr, diffCoverage: 0.5 }, { minDiffCoverage: 0.8 });
    expect(low.verdict).toBe('fail');
    expect(low.reasons).toEqual(['Diff coverage 0.5 is below the minimum of 0.8.']);

    const unmeasured = evaluateAiGovernance(
      { ...agentPr, diffCoverage: null },
      { minDiffCoverage: 0.8 },
    );
    expect(unmeasured.verdict).toBe('fail');
    expect(unmeasured.reasons).toEqual([
      'Diff coverage was not measured, and a minimum of 0.8 is required.',
    ]);

    expect(
      evaluateAiGovernance({ ...agentPr, diffCoverage: 0.8 }, { minDiffCoverage: 0.8 }).verdict,
    ).toBe('pass');
    expect(evaluateAiGovernance({ ...agentPr, diffCoverage: null }, {}).verdict).toBe('pass');
  });

  it('counts high and critical findings together against the ceiling', () => {
    const result = evaluateAiGovernance(
      { ...agentPr, newHighFindings: 1, newCriticalFindings: 1 },
      { maxNewHighOrCritical: 1 },
    );
    expect(result.verdict).toBe('fail');
    expect(result.reasons).toEqual([
      'It adds 2 new high or critical findings; at most 1 is allowed.',
    ]);
    expect(
      evaluateAiGovernance({ ...agentPr, newHighFindings: 1 }, { maxNewHighOrCritical: 1 }).verdict,
    ).toBe('pass');
    expect(evaluateAiGovernance({ ...agentPr, newCriticalFindings: 5 }, {}).verdict).toBe('pass');
  });

  it('reports every failed rule, not only the first', () => {
    const result = evaluateAiGovernance(
      {
        ...agentPr,
        agent: null,
        humanApprovals: 0,
        testsTouched: false,
        diffCoverage: null,
        newHighFindings: 3,
      },
      { requireTestsTouched: true, minDiffCoverage: 0.7, maxNewHighOrCritical: 0 },
    );
    expect(result.reasons).toHaveLength(4);
    expect(result.reasons[0]).toBe(
      'Agent-authored change by an unnamed agent needs at least one human approval; it has none.',
    );
  });

  it('never subjects a human PR to the rules', () => {
    const result = evaluateAiGovernance(
      { ...agentPr, attribution: 'human', humanApprovals: 0, testsTouched: false },
      { requireTestsTouched: true, applyTo: ['agent-authored', 'ai-assisted'] },
    );
    expect(result).toEqual({
      applies: false,
      verdict: 'not-applicable',
      reasons: [],
      attributionNote: null,
    });
  });

  it('applies to ai-assisted change only when the policy says so', () => {
    const assisted = { ...agentPr, attribution: 'ai-assisted' as const, humanApprovals: 0 };
    expect(evaluateAiGovernance(assisted, {}).verdict).toBe('not-applicable');
    const applied = evaluateAiGovernance(assisted, { applyTo: ['ai-assisted'] });
    expect(applied.verdict).toBe('fail');
    expect(applied.reasons[0]).toContain('AI-assisted change by github-copilot');
    expect(evaluateAiGovernance(agentPr, { applyTo: ['ai-assisted'] }).verdict).toBe(
      'not-applicable',
    );
  });

  it('treats unknown attribution as human by default, and says so', () => {
    const unknown = { ...agentPr, attribution: 'unknown' as const, humanApprovals: 0 };
    expect(evaluateAiGovernance(unknown, {})).toEqual({
      applies: false,
      verdict: 'not-applicable',
      reasons: [],
      attributionNote: 'Attribution was unknown; the change was treated as human.',
    });
    const strict = evaluateAiGovernance(unknown, { treatUnknownAs: 'agent-authored' });
    expect(strict.applies).toBe(true);
    expect(strict.verdict).toBe('fail');
    expect(strict.attributionNote).toBe(
      'Attribution was unknown; the change was treated as agent-authored.',
    );
  });

  it('refuses a policy it cannot apply', () => {
    expect(() => evaluateAiGovernance(agentPr, { minDiffCoverage: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() => evaluateAiGovernance(agentPr, { maxNewHighOrCritical: -1 })).toThrow(RangeError);
    expect(() => evaluateAiGovernance(agentPr, { maxNewHighOrCritical: 0.5 })).toThrow(RangeError);
  });
});
