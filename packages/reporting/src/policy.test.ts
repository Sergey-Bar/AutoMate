import { describe, expect, it } from 'vitest';
import type { CanonicalRunResult as RunResult } from '@automate/shared-contracts';
import {
  canonicalJson,
  classifyRetention,
  evaluateCompleteness,
  fingerprint,
  isNonProductStatus,
  isProductOutcome,
  NON_PRODUCT_STATUSES,
} from './policy.js';
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
  it('separates non-product statuses from determinate product outcomes', () => {
    expect([...NON_PRODUCT_STATUSES]).toEqual([
      'blocked',
      'configFailed',
      'infraFailed',
      'runnerFailed',
    ]);
    for (const status of NON_PRODUCT_STATUSES) {
      expect(isNonProductStatus(status)).toBe(true);
      expect(isProductOutcome(status)).toBe(false);
    }
    for (const status of [
      'passed',
      'failed',
      'flaky',
      'skipped',
      'timedOut',
      'cancelled',
    ] as const) {
      expect(isNonProductStatus(status)).toBe(false);
      expect(isProductOutcome(status)).toBe(true);
    }
    expect(isProductOutcome('unknown')).toBe(false);
  });

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

  it('reports complete when every shard arrives exactly once', () => {
    expect(evaluateCompleteness(2, [0, 1])).toEqual({
      state: 'complete',
      missingShards: [],
      duplicateShards: [],
    });
  });

  it('reports rejected only when explicitly marked, keeping shard facts', () => {
    expect(evaluateCompleteness(2, [0, 1], { rejected: true })).toEqual({
      state: 'rejected',
      missingShards: [],
      duplicateShards: [],
    });
    expect(evaluateCompleteness(3, [0, 1, 1], { rejected: true })).toEqual({
      state: 'rejected',
      missingShards: [2],
      duplicateShards: [1],
    });
    expect(evaluateCompleteness(2, [0, 1], { rejected: false }).state).toBe('complete');
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

  it('reports lifecycle cleanup as an expired retention class', () => {
    expect(classifyRetention(result, { expired: true })).toEqual({
      class: 'expired',
      reason: 'lifecycle-cleanup',
    });
    expect(classifyRetention(result, { quarantined: true, expired: true })).toEqual({
      class: 'quarantine',
      reason: 'quarantined',
    });
    expect(classifyRetention({ retention: { class: 'expired' } })).toEqual({ class: 'expired' });
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

  it('projects every canonical status including the non-product taxonomy', () => {
    const attempt = (
      index: number,
      status: RunResult['status'],
    ): RunResult['attempts'][number] => ({
      ...result.attempts[0],
      index,
      testId: `test-${index}`,
      status,
      rawStatus: status,
    });
    const statuses: RunResult['status'][] = [
      'passed',
      'blocked',
      'configFailed',
      'infraFailed',
      'runnerFailed',
    ];
    const summary = projectRunSummary({
      ...result,
      attempts: statuses.map((status, index) => attempt(index + 1, status)),
    });

    expect(summary.nonProduct).toBe(4);
    expect(summary.passed).toBe(1);
    expect(summary.byStatus).toMatchObject({
      passed: 1,
      failed: 0,
      blocked: 1,
      configFailed: 1,
      infraFailed: 1,
      runnerFailed: 1,
    });
    expect(Object.keys(summary.byStatus).sort()).toEqual(
      [
        'blocked',
        'cancelled',
        'configFailed',
        'failed',
        'flaky',
        'infraFailed',
        'passed',
        'runnerFailed',
        'skipped',
        'timedOut',
        'unknown',
      ].sort(),
    );
  });
});
