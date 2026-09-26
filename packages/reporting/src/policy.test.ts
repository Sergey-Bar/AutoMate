import { describe, expect, it } from 'vitest';
import type { CanonicalRunResult as RunResult } from '@automate/shared-contracts';
import {
  ALL_RUN_STATUSES,
  canonicalJson,
  classifyRetention,
  classifyStatus,
  evaluateCompleteness,
  fingerprint,
  isNonProductStatus,
  isProductOutcome,
  NON_PRODUCT_STATUSES,
  type StatusClass,
} from './policy.js';
import { projectRunSummary } from './projections.js';

type CanonicalStatus = RunResult['status'];

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
    // A cancelled run produced no outcome at all, so it proves nothing about
    // the product and must not sit in the pass-rate denominator.
    expect([...NON_PRODUCT_STATUSES].sort()).toEqual([
      'blocked',
      'cancelled',
      'configFailed',
      'infraFailed',
      'runnerFailed',
    ]);
    for (const status of NON_PRODUCT_STATUSES) {
      expect(isNonProductStatus(status)).toBe(true);
      expect(isProductOutcome(status)).toBe(false);
    }
    // A timeout is a real result about the product: a non-pass, not an exclusion.
    for (const status of ['passed', 'failed', 'flaky', 'skipped', 'timedOut'] as const) {
      expect(isNonProductStatus(status)).toBe(false);
      expect(isProductOutcome(status)).toBe(true);
    }
    expect(isProductOutcome('unknown')).toBe(false);
  });

  it('classifies every canonical status, with no status left unclassified', () => {
    const expected: Record<CanonicalStatus, StatusClass> = {
      passed: 'product',
      failed: 'product',
      flaky: 'product',
      skipped: 'product',
      timedOut: 'product',
      cancelled: 'nonProduct',
      blocked: 'nonProduct',
      configFailed: 'nonProduct',
      infraFailed: 'nonProduct',
      runnerFailed: 'nonProduct',
      unknown: 'indeterminate',
    };
    expect(ALL_RUN_STATUSES.sort()).toEqual(Object.keys(expected).sort());
    for (const status of ALL_RUN_STATUSES) {
      expect(classifyStatus(status), `status ${status} is unclassified`).toBe(expected[status]);
    }
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
      unexpectedShards: [],
    });
  });

  it('reports complete when every shard arrives exactly once', () => {
    expect(evaluateCompleteness(2, [0, 1])).toEqual({
      state: 'complete',
      missingShards: [],
      duplicateShards: [],
      unexpectedShards: [],
    });
  });

  it('does not certify a zero-shard run as complete', () => {
    // "0 of 0 shards received" is not evidence; it used to be reported complete.
    expect(evaluateCompleteness(0, []).state).toBe('partial');
    expect(evaluateCompleteness(0, [0]).state).toBe('partial');
  });

  it('reports a shard outside the expected range instead of dropping it', () => {
    expect(evaluateCompleteness(2, [0, 1, 7])).toEqual({
      state: 'partial',
      missingShards: [],
      duplicateShards: [],
      unexpectedShards: [7],
    });
  });

  it('sorts shard facts so the verdict does not depend on input order', () => {
    const forwards = evaluateCompleteness(5, [0, 0, 2, 2]);
    const backwards = evaluateCompleteness(5, [2, 2, 0, 0]);
    expect(forwards).toEqual(backwards);
    expect(forwards.duplicateShards).toEqual([0, 2]);
  });

  it('refuses impossible shard arithmetic rather than reporting on it', () => {
    expect(() => evaluateCompleteness(-1, [])).toThrow(RangeError);
    expect(() => evaluateCompleteness(1.5, [0])).toThrow(RangeError);
    expect(() => evaluateCompleteness(2, [-1])).toThrow(RangeError);
    expect(() => evaluateCompleteness(2, [0.5])).toThrow(RangeError);
  });

  it('reports rejected only when explicitly marked, keeping shard facts', () => {
    expect(evaluateCompleteness(2, [0, 1], { rejected: true })).toEqual({
      state: 'rejected',
      missingShards: [],
      duplicateShards: [],
      unexpectedShards: [],
    });
    expect(evaluateCompleteness(3, [0, 1, 1], { rejected: true })).toEqual({
      state: 'rejected',
      missingShards: [2],
      duplicateShards: [1],
      unexpectedShards: [],
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
