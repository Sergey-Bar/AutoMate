import { describe, expect, it } from 'vitest';
import {
  createGateEvaluation,
  defaultPolicy,
  evaluateQualityGate,
  type GatePolicy,
} from './quality-gate.js';

const run = (
  outcome: 'passed' | 'failed' | 'partial' | 'cancelled' | null,
  status: 'passed' | 'failed' = 'passed',
) => ({
  outcome,
  tests: [
    {
      id: 'test-1',
      title: 'Test',
      file: null,
      status,
      durationMs: 10,
      attempt: 1,
      error: null,
      metadata: {},
    },
  ],
  artifacts: [],
  rawEvidenceRefs: ['report:test-result'],
  summary: {
    total: 1,
    passed: status === 'passed' ? 1 : 0,
    failed: status === 'failed' ? 1 : 0,
    flaky: 0,
    skipped: 0,
    blocked: 0,
    unknown: 0,
    durationMs: 10,
  },
});

describe('quality gate policy evaluation', () => {
  it('distinguishes pass, fail, warning, and unknown outcomes', () => {
    const policy = defaultPolicy('workspace-1');
    expect(evaluateQualityGate({ run: run('passed'), policy }).status).toBe('passed');
    expect(evaluateQualityGate({ run: run('failed', 'failed'), policy }).decision).toBe('blocked');
    expect(evaluateQualityGate({ run: run('partial'), policy }).status).toBe('warning');
    expect(evaluateQualityGate({ run: run('cancelled'), policy }).status).toBe('unknown');
  });

  it('does not turn a passed browser domain green without evidence', () => {
    const result = evaluateQualityGate({
      run: { ...run('passed'), rawEvidenceRefs: [] },
      policy: defaultPolicy('workspace-1'),
    });
    expect(result.status).toBe('unknown');
    expect(result.decision).toBe('not_ready');
    expect(result.reasons).toContain('evidence:MISSING_REQUIRED_EVIDENCE');
  });

  it('evaluates thresholds, rules, infrastructure reasons, and gate metadata', () => {
    const policy = {
      ...defaultPolicy('workspace-1'),
      requiredDomains: ['browser', 'api'],
      browserPassRateThreshold: 100,
      maxFlakyRate: 0,
      maxDurationMs: 1,
      rules: [
        {
          domain: 'browser' as const,
          required: true,
          minimumPassRate: 100,
          requiredArtifactKinds: ['screenshot'],
        },
        { domain: 'api' as const, required: false, requiredArtifactKinds: [] },
      ],
    } as GatePolicy;
    const infra = evaluateQualityGate({
      run: {
        ...run('passed'),
        outcome: 'infra_failed',
        phase: 'infra_failed',
        summary: { ...run('passed').summary, total: 2, passed: 1, flaky: 1, durationMs: 20 },
      },
      policy,
    });
    expect(infra.status).toBe('failed');
    expect(infra.reasons).toContain('infra_failed:RUNNER_INFRASTRUCTURE');
    const missing = evaluateQualityGate({ run: run('passed'), policy });
    expect(missing.reasons).toContain('browser:MISSING_EVIDENCE');
    expect(
      evaluateQualityGate({
        run: {
          ...run('partial'),
          summary: { ...run('partial').summary, durationMs: 0 },
          artifacts: [{ id: 'artifact-1', kind: 'screenshot' } as never],
        },
        policy,
        domainStatuses: { browser: 'warning', api: 'warning' },
      }).status,
    ).toBe('warning');
    const gate = createGateEvaluation({
      run: { ...run('passed'), id: 'run-x', updatedAt: '2026-01-01T00:00:00.000Z' } as never,
      policy: { ...policy, hash: '' },
    });
    expect(gate.evaluatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(gate.policyHash).toHaveLength(64);
  });

  it('records deterministic evidence and policy metadata', () => {
    const result = createGateEvaluation({
      run: {
        ...run('passed'),
        id: 'run-1',
        workspaceId: 'workspace-1',
        releaseId: 'release-1',
        tests: [],
        artifacts: [{ id: 'artifact-1' } as never],
      } as never,
      policy: { ...defaultPolicy('workspace-1'), id: 'policy-1', version: '2', hash: 'hash' },
      domainStatuses: { browser: 'passed' },
    });
    expect(result.status).toBe('passed');
    expect(result.evidenceRefs).toContain('artifact:artifact-1');
    expect(result.policyVersion).toBe('2');
  });

  describe('a green claim with nothing behind it', () => {
    // Every threshold above sits behind `if (summary.total > 0)`, so a run with
    // no tests evaluated nothing at all and could gate `ready`.
    const emptyRun = (outcome: 'passed' | 'failed') => ({
      ...run(outcome),
      tests: [],
      rawEvidenceRefs: ['report:test-result'],
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        flaky: 0,
        skipped: 0,
        blocked: 0,
        unknown: 0,
        durationMs: null,
      },
    });

    it('refuses to pass a run that executed nothing', () => {
      const result = evaluateQualityGate({
        run: emptyRun('passed'),
        policy: defaultPolicy('workspace-1'),
        domainStatuses: { browser: 'passed' },
      });
      expect(result.status).toBe('failed');
      expect(result.decision).toBe('blocked');
      expect(result.reasons).toContain('evidence:NO_TESTS');
    });

    it('still reports the failure honestly for a run that did execute', () => {
      const result = evaluateQualityGate({
        run: { ...emptyRun('failed'), tests: run('failed', 'failed').tests },
        policy: defaultPolicy('workspace-1'),
        domainStatuses: { browser: 'passed' },
      });
      expect(result.reasons).not.toContain('evidence:NO_TESTS');
    });

    it('passes a run whose total is zero but which recorded a real test', () => {
      // The count and the array must agree before a claim is refused: a run can
      // legitimately carry a zero total with a test present if the reporter
      // omitted the summary.
      const result = evaluateQualityGate({
        run: { ...emptyRun('passed'), tests: run('passed').tests },
        policy: defaultPolicy('workspace-1'),
        domainStatuses: { browser: 'passed' },
      });
      expect(result.reasons).not.toContain('evidence:NO_TESTS');
    });
  });

  describe('the gate evaluation id matches the upsert conflict target', () => {
    it('includes the policy hash, so a policy update updates rather than collides', () => {
      // `DrizzleExecutionStore.saveGate` upserts on
      // [runId, releaseId, policyId, policyVersion, policyHash]. An id without
      // the hash is a different primary key for the same row, so the first
      // policy update raised a unique violation instead of updating.
      const policy = { ...defaultPolicy('workspace-1'), id: 'policy-1', version: '1' };
      const runForGate = {
        ...run('passed'),
        id: 'run-1',
        workspaceId: 'workspace-1',
        releaseId: null,
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as never;

      const first = createGateEvaluation({ run: runForGate, policy: { ...policy, hash: 'aaa' } });
      const unchanged = createGateEvaluation({
        run: runForGate,
        policy: { ...policy, hash: 'aaa' },
      });
      const updated = createGateEvaluation({ run: runForGate, policy: { ...policy, hash: 'bbb' } });

      // Same policy: the same row, so the upsert is a no-op rather than a
      // second insert under a different primary key.
      expect(unchanged.id).toBe(first.id);
      // Different policy content: a genuinely different evaluation.
      expect(updated.id).not.toBe(first.id);
      // And the hash is part of the id, not only a column beside it.
      expect(first.id).toContain(first.policyHash);
      expect(updated.id).toContain(updated.policyHash);
    });
  });
});
