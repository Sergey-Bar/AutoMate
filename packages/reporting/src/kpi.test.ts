import { describe, expect, it } from 'vitest';
import type { CanonicalRunResult } from '@automate/shared-contracts';
import { calculateKpis } from './kpi.js';
import { evaluateQualityGate } from './quality-gates.js';

const timestamp = '2026-09-25T00:00:00.000Z';
const digest = 'a'.repeat(64);
const result = (
  status: CanonicalRunResult['status'],
  completeness: CanonicalRunResult['completeness']['state'] = 'complete',
): CanonicalRunResult => ({
  contractVersion: '2',
  identity: { runId: `run-${status}-${completeness}`, workspaceId: 'workspace-1' },
  status,
  startedAt: timestamp,
  attempts: [
    {
      index: 1,
      testId: 'test-1',
      specPath: 'tests/example.spec.ts',
      title: 'test',
      status,
      rawStatus: status,
      startedAt: timestamp,
      evidence: [],
      flakiness: 'unknown',
    },
  ],
  steps: [],
  evidence: [
    {
      uri: 'artifact://run-1/evidence/report.json',
      mediaType: 'application/json',
      byteSize: 1,
      digest,
    },
  ],
  provenance: {
    producer: 'playwright',
    producerVersion: '1',
    adapterVersion: '1',
    sourceDigest: digest,
    sourceUri: 'artifact://run/report.json',
  },
  retention: { class: 'standard' },
  proof: { state: 'verified', digest, verifier: 'test' },
  completeness: { state: completeness, missingShards: [], duplicateShards: [] },
  raw: {},
});

describe('KPI and quality gate policies', () => {
  it('preserves unknown populations instead of treating them as passes', () => {
    const kpis = calculateKpis([
      result('passed'),
      { ...result('unknown'), attempts: [{ ...result('unknown').attempts[0], status: 'unknown' }] },
    ]);
    expect(kpis.find((kpi) => kpi.metric === 'first-pass-rate')).toMatchObject({
      // 1 product attempt, with the unknown one reported separately. The
      // denominator used to be 2 — the total — while the value was 1/1.
      denominator: 1,
      unknown: 1,
      numerator: 1,
      value: 1,
    });
  });

  it('reports a denominator that reproduces the value, for every rate', () => {
    const base = result('passed').attempts[0];
    const attempts = [
      { ...base, status: 'passed' as const, flakiness: 'observed' as const, durationMs: 10 },
      {
        ...base,
        index: 2,
        status: 'failed' as const,
        flakiness: 'unknown' as const,
        durationMs: 30,
      },
      { ...base, index: 3, status: 'skipped' as const, flakiness: 'unknown' as const },
      { ...base, index: 4, status: 'blocked' as const, flakiness: 'unknown' as const },
      { ...base, index: 5, status: 'unknown' as const, flakiness: 'unknown' as const },
    ];
    const kpis = calculateKpis([{ ...result('failed'), attempts }]);
    for (const metric of ['first-pass-rate', 'execution-failure-rate', 'flake-rate']) {
      const kpi = kpis.find((candidate) => candidate.metric === metric);
      expect(kpi, metric).toBeDefined();
      expect(kpi?.value, `${metric} value`).not.toBeNull();
      expect(kpi?.denominator, `${metric} denominator`).toBe(3);
      expect(kpi!.value, `${metric} numerator/denominator`).toBeCloseTo(
        kpi!.numerator / kpi!.denominator,
      );
    }
    expect(kpis.find((kpi) => kpi.metric === 'first-pass-rate')).toMatchObject({ numerator: 1 });
    expect(kpis.find((kpi) => kpi.metric === 'execution-failure-rate')).toMatchObject({
      numerator: 1,
    });
    expect(kpis.find((kpi) => kpi.metric === 'flake-rate')).toMatchObject({ numerator: 1 });
  });

  it('accounts for every attempt in exactly one bucket', () => {
    const attempts = [
      { ...result('passed').attempts[0], status: 'passed' as const, durationMs: 10 },
      { ...result('cancelled').attempts[0], index: 2, status: 'cancelled' as const },
      { ...result('blocked').attempts[0], index: 3, status: 'blocked' as const },
      { ...result('unknown').attempts[0], index: 4, status: 'unknown' as const },
    ];
    const kpi = calculateKpis([{ ...result('failed'), attempts }])[0];
    expect(kpi).toBeDefined();
    expect(kpi!.denominator + kpi!.unknown + kpi!.nonProduct).toBe(attempts.length);
  });

  it('calculates duration quantiles and marks unverified proof', () => {
    const measured = result('passed');
    measured.attempts[0].durationMs = 120;
    const values = calculateKpis([measured]);
    expect(values.find((kpi) => kpi.metric === 'duration-p50')?.value).toBe(120);
    const unverified = result('passed');
    unverified.proof = { state: 'unverified', digest, verifier: 'test' };
    expect(calculateKpis([unverified])[0]?.proofCeiling).toBe('unverified');
  });

  it('returns unavailable values for an empty population', () => {
    expect(calculateKpis([]).every((kpi) => kpi.value === null)).toBe(true);
  });

  it('excludes non-product statuses from product rates and reports them explicitly', () => {
    const attempts = [
      { ...result('passed').attempts[0], status: 'passed' as const, durationMs: 10 },
      { ...result('failed').attempts[0], index: 2, status: 'failed' as const, durationMs: 30 },
      { ...result('blocked').attempts[0], index: 3, status: 'blocked' as const, durationMs: 5 },
      { ...result('configFailed').attempts[0], index: 4, status: 'configFailed' as const },
      { ...result('infraFailed').attempts[0], index: 5, status: 'infraFailed' as const },
      { ...result('runnerFailed').attempts[0], index: 6, status: 'runnerFailed' as const },
      { ...result('unknown').attempts[0], index: 7, status: 'unknown' as const },
    ];
    const kpis = calculateKpis([{ ...result('failed'), attempts }]);
    const firstPass = kpis.find((kpi) => kpi.metric === 'first-pass-rate');
    const failure = kpis.find((kpi) => kpi.metric === 'execution-failure-rate');

    expect(firstPass).toMatchObject({
      numerator: 1,
      // The denominator the value was divided by: 2 product attempts, not all 7.
      // Reporting 7 here made `numerator / denominator` disagree with `value`.
      denominator: 2,
      unknown: 1,
      nonProduct: 4,
      value: 0.5,
      exclusions: [
        { reason: 'unknown-status', count: 1 },
        { reason: 'non-product-status', count: 4 },
      ],
    });
    expect(failure).toMatchObject({ numerator: 1, denominator: 2, value: 0.5 });
    // Non-product durations are excluded from latency, not silently averaged in.
    expect(kpis.find((kpi) => kpi.metric === 'duration-p50')).toMatchObject({
      value: 10,
      numerator: 2,
    });
  });

  it('reports no product rate when every attempt is non-product or unknown', () => {
    const nonProductOnly = calculateKpis([
      { ...result('blocked'), attempts: [{ ...result('blocked').attempts[0], status: 'blocked' }] },
      { ...result('unknown'), attempts: [{ ...result('unknown').attempts[0], status: 'unknown' }] },
    ]);
    expect(
      nonProductOnly
        .filter((kpi) => kpi.metric !== 'duration-p50' && kpi.metric !== 'duration-p95')
        .every((kpi) => kpi.value === null),
    ).toBe(true);
    expect(nonProductOnly[0]).toMatchObject({ unknown: 1, nonProduct: 1 });
  });

  it('caps the proof ceiling at the weakest run regardless of order', () => {
    type ProofState = 'verified' | 'proven' | 'unverified' | 'unproven' | 'stale' | 'contradictory';
    const proof = (state: ProofState) => {
      const value = result('passed');
      value.proof = { state, digest, verifier: 'test' };
      return value;
    };
    expect(calculateKpis([proof('verified'), proof('stale')])[0]?.proofCeiling).toBe('stale');
    expect(calculateKpis([proof('stale'), proof('verified')])[0]?.proofCeiling).toBe('stale');
    expect(calculateKpis([proof('verified'), proof('contradictory')])[0]?.proofCeiling).toBe(
      'contradictory',
    );
    expect(calculateKpis([proof('unproven'), proof('unverified')])[0]?.proofCeiling).toBe(
      'unproven',
    );
    expect(calculateKpis([proof('unverified'), proof('proven')])[0]?.proofCeiling).toBe(
      'unverified',
    );
    expect(calculateKpis([proof('verified'), proof('proven')])[0]?.proofCeiling).toBe('proven');
    expect(calculateKpis([proof('verified')])[0]?.proofCeiling).toBe('verified');
  });

  it('never reports a verified ceiling for unknown or rejected completeness', () => {
    const ambiguous = result('passed', 'unknown');
    expect(calculateKpis([ambiguous])[0]?.proofCeiling).toBe('unknown');
    const rejected = result('passed', 'rejected');
    expect(calculateKpis([rejected])[0]?.proofCeiling).toBe('rejected');
    expect(calculateKpis([rejected])[0]?.confidence).toBe('low');
  });

  it('does not pass incomplete or unproven evidence', () => {
    expect(
      evaluateQualityGate([result('passed', 'partial')], {
        requiredProof: 'verified',
        requiredCompleteness: 'complete',
        allowedStatuses: ['passed'],
      }),
    ).toEqual({ status: 'failed', reasons: ['completeness-not-met'] });
    expect(
      evaluateQualityGate([], {
        requiredProof: 'verified',
        requiredCompleteness: 'complete',
        allowedStatuses: ['passed'],
      }).status,
    ).toBe('inconclusive');
  });

  it('does not let an unproven claim weaken a hard policy failure', () => {
    // Both reasons are present. Reporting `inconclusive` here would let a run
    // that failed the policy hide behind an unverified proof.
    const evidenceLess = result('failed');
    evidenceLess.evidence = [];
    evidenceLess.proof = { state: 'unverified', digest: 'd'.repeat(64), verifier: 'test' };
    const evaluation = evaluateQualityGate([evidenceLess], {
      requiredProof: 'verified',
      requiredCompleteness: 'complete',
      allowedStatuses: ['passed'],
    });
    expect(evaluation.status).toBe('failed');
    expect(evaluation.reasons).toContain('terminal-status-not-allowed');
    expect(evaluation.reasons).toContain('proof-ceiling-not-met');
  });

  it('rejects passed results without evidence deterministically', () => {
    const policy = {
      requiredProof: 'verified' as const,
      requiredCompleteness: 'complete' as const,
      allowedStatuses: ['passed' as const],
    };
    const evidenceLess = result('passed');
    evidenceLess.evidence = [];

    expect(evaluateQualityGate([result('passed')], policy)).toEqual({
      status: 'passed',
      reasons: [],
    });
    // A green claim with no evidence is a failure, not an unknown: this product
    // promises evidence before claims.
    expect(evaluateQualityGate([evidenceLess], policy)).toEqual({
      status: 'failed',
      reasons: ['missing-evidence'],
    });
    expect(evaluateQualityGate([evidenceLess], policy)).toEqual({
      status: 'failed',
      reasons: ['missing-evidence'],
    });
  });

  it('reports an unverified proof ceiling as a failure, not an unknown', () => {
    const unproven = result('passed');
    unproven.proof = { state: 'unverified', digest: 'd'.repeat(64), verifier: 'test' };
    expect(
      evaluateQualityGate([unproven], {
        requiredProof: 'verified',
        requiredCompleteness: 'complete',
        allowedStatuses: ['passed'],
      }),
    ).toEqual({ status: 'failed', reasons: ['proof-ceiling-not-met'] });
  });
});
