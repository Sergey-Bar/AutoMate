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
  evidence: [],
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
      denominator: 2,
      unknown: 1,
      numerator: 1,
    });
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
});
