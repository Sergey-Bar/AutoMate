import { describe, expect, it } from 'vitest';
import type { CanonicalRunResult as RunResult } from '@automate/shared-contracts';
import { canonicalJson, classifyRetention, evaluateCompleteness, fingerprint } from './policy.js';
import { projectRunSummary } from './projections.js';

const timestamp = '2026-09-25T00:00:00.000Z';
const digest = 'b'.repeat(64);
const result: RunResult = {
  contractVersion: '2',
  identity: { runId: 'run-1', workspaceId: 'workspace-1' },
  status: 'passed',
  startedAt: timestamp,
  finishedAt: timestamp,
  attempts: [
    {
      index: 1,
      testId: 'test-1',
      specPath: 'tests/example.spec.ts',
      title: 'example',
      status: 'passed',
      rawStatus: 'passed',
      startedAt: timestamp,
      finishedAt: timestamp,
      evidence: [],
      flakiness: 'unknown' as const,
    },
  ],
  steps: [],
  evidence: [],
  provenance: {
    producer: 'playwright',
    producerVersion: '1.0.0',
    adapterVersion: '1.0.0',
    sourceDigest: digest,
    sourceUri: 'artifact://run-1/report.json',
  },
  retention: { class: 'standard' },
  proof: { state: 'verified', digest, verifier: 'test' },
  completeness: { state: 'complete', missingShards: [], duplicateShards: [] },
  raw: {},
};

describe('reporting policies', () => {
  it('canonicalizes object keys before fingerprinting', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(fingerprint({ b: 1, a: 2 })).toBe(fingerprint({ a: 2, b: 1 }));
  });

  it('detects missing and duplicate shards', () => {
    expect(evaluateCompleteness(3, [0, 1, 1])).toEqual({
      state: 'partial',
      missingShards: [2],
      duplicateShards: [1],
    });
  });

  it('prioritizes legal hold over quarantine', () => {
    expect(classifyRetention(result, { quarantined: true, legalHold: true })).toEqual({
      class: 'legal_hold',
      reason: 'legal-hold',
    });
    expect(classifyRetention(result, { quarantined: true })).toEqual({
      class: 'quarantine',
      reason: 'quarantined',
    });
    expect(classifyRetention(result)).toEqual({ class: 'standard' });
  });

  it('projects counts without treating unknown as passed', () => {
    const summary = projectRunSummary({
      ...result,
      attempts: [
        { ...result.attempts[0], status: 'unknown', rawStatus: 'mystery' },
        {
          ...result.attempts[0],
          index: 2,
          testId: 'test-2',
          status: 'failed',
          rawStatus: 'failed',
        },
      ],
    });
    expect(summary).toMatchObject({ total: 2, passed: 0, failed: 1, unknown: 1 });
  });
});
