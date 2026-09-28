import { describe, expect, it } from 'vitest';
import {
  LEGACY_FLAT_V1_CONTRACT_ID,
  REPORTER_EVENT_TYPES,
  RUN_CONTRACT_ID,
  RUN_CONTRACT_VERSION,
  RUNNER_PROTOCOL_VERSION,
  RealtimeEnvelopeSchema,
  ReporterEventSchema,
  RunResultSchema,
} from './canonical-reporting.js';
import { QA_CONTRACT_VERSION } from './execution.js';

type Evidence = { uri: string; mediaType: string; byteSize: number; digest: string };
const baseEvidence: Evidence[] = [];
const digest = 'a'.repeat(64);
const timestamp = '2026-09-25T00:00:00.000Z';
const baseAttempt = {
  index: 1,
  testId: 'test-1',
  specPath: 'tests/example.spec.ts',
  title: 'example test',
  status: 'passed' as const,
  rawStatus: 'passed',
  startedAt: timestamp,
  finishedAt: timestamp,
  evidence: baseEvidence,
  flakiness: 'unknown' as const,
};
const baseResult = {
  contractVersion: '2' as const,
  identity: { runId: 'run-1', workspaceId: 'workspace-1' },
  status: 'passed' as const,
  startedAt: timestamp,
  finishedAt: timestamp,
  attempts: [baseAttempt],
  steps: [] as Array<Record<string, unknown>>,
  evidence: baseEvidence,
  provenance: {
    producer: 'playwright' as const,
    producerVersion: '1.0.0',
    adapterVersion: '1.0.0',
    sourceDigest: digest,
    sourceUri: 'artifact://run-1/report.json',
  },
  retention: { class: 'standard' as const },
  proof: { state: 'verified' as const, digest, verifier: 'test' },
  completeness: { state: 'complete' as const, missingShards: [], duplicateShards: [] },
  raw: {},
};

describe('attempt identity within a run', () => {
  /**
   * F-4. `testId` is built by two adapters from two different key pairs —
   * `junit-xml.ts` from `classname:name`, `playwright-json.ts` from `file:title` —
   * and the contract imposed no rule on it, so two distinct tests can arrive carrying
   * the same `testId` and be indistinguishable to any consumer that keys on it.
   *
   * **The rule is deliberately NOT `testId` uniqueness, and that is the judgement this
   * row turns on.** A retried test is *one* test with several attempts:
   * `playwright-json.ts` emits one attempt per `test.results` entry with
   * `index: attemptIndex + 1` and the same `testId`, and JUnit expresses the same
   * thing as `flakyFailure`/`rerunFailure`. So `testId` alone cannot be unique, and a
   * uniqueness check on it would reject every flaky run — a normal case, not an
   * unlucky one. The one demonstrated consumer, `in-memory-run-repository.ts`, keys a
   * Map on `${testId}::${runId}` and its `patchTest` silently no-ops on a missing key,
   * so the two rows that actually collide are the two a consumer cannot tell apart.
   *
   * So the invariant is: **for each `testId`, its attempt `index` values are exactly
   * 1..n.** A retried test satisfies it by construction. Two distinct tests colliding on
   * one `testId` produce `[1, 2, 1, 2]`, which does not — and that is precisely the
   * defect, because a consumer has no way to decide where one test's attempts end and
   * the next one's begin.
   */
  it('accepts a retried test, whose attempts share one testId', () => {
    const retried = { ...baseAttempt, testId: 'tests/a.spec.ts:flaky', index: 1 };
    const second = { ...baseAttempt, testId: 'tests/a.spec.ts:flaky', index: 2 };
    const result = { ...baseResult, attempts: [retried, second] };
    expect(RunResultSchema.safeParse(result).success).toBe(true);
  });

  it('refuses two distinct tests that collided on one testId', () => {
    // Both adapters number `index` per test — `playwright-json.ts` uses
    // `attemptIndex + 1` within one test's `results` — so two *distinct* tests that
    // collided on an identity both arrive as attempt 1. That is the real shape, and it
    // is what the in-memory repository cannot represent: it keys a Map on
    // `${testId}::${runId}` and its `patchTest` silently no-ops on a missing key, so
    // the second row is the one that disappears.
    const first = { ...baseAttempt, testId: 'suite:duplicated name', index: 1 };
    const second = { ...baseAttempt, testId: 'suite:duplicated name', index: 1 };
    const result = { ...baseResult, attempts: [first, second] };
    expect(RunResultSchema.safeParse(result).success).toBe(false);
  });

  it('cannot separate a collision that happens to look exactly like a retry', () => {
    // Stated rather than papered over. Two distinct tests arriving as attempts 1 and 2
    // on one `testId` are byte-identical to one test that ran twice, and no contract
    // rule can tell them apart — the difference would have to be carried in the `testId`
    // itself. Namespacing it is the change this row deliberately does not make: it buys
    // nothing observable today, it is visible in an evidence UI (`run-detail.tsx`
    // renders `testId` and keys `data-testid` on it), and the only demonstrated consumer
    // is the in-memory store's silent no-op, which this rule already covers.
    const first = { ...baseAttempt, testId: 'suite:ambiguous', index: 1 };
    const second = { ...baseAttempt, testId: 'suite:ambiguous', index: 2 };
    const result = { ...baseResult, attempts: [first, second] };
    expect(RunResultSchema.safeParse(result).success).toBe(true);
  });

  it('refuses a gap in one test’s attempt sequence', () => {
    // Attempts 1 and 3 with nothing between: the second attempt was lost, and nothing
    // downstream would say so. This is a different defect from the collision — one
    // test, one lost attempt — and it is the one a `Set`-size check would miss.
    const first = { ...baseAttempt, testId: 'tests/a.spec.ts:gapped', index: 1 };
    const third = { ...baseAttempt, testId: 'tests/a.spec.ts:gapped', index: 3 };
    const result = { ...baseResult, attempts: [first, third] };
    expect(RunResultSchema.safeParse(result).success).toBe(false);
  });

  it('still accepts distinct tests side by side', () => {
    const first = { ...baseAttempt, testId: 'tests/a.spec.ts:one', index: 1 };
    const second = { ...baseAttempt, testId: 'tests/b.spec.ts:two', index: 1 };
    const result = { ...baseResult, attempts: [first, second] };
    expect(RunResultSchema.safeParse(result).success).toBe(true);
  });
});

describe('canonical reporting contracts', () => {
  it('accepts a complete canonical result', () => {
    expect(RunResultSchema.safeParse(baseResult).success).toBe(true);
  });

  it('rejects local absolute paths', () => {
    const result = structuredClone(baseResult);
    result.attempts[0].specPath = 'C:\\tests\\example.spec.ts';
    expect(RunResultSchema.safeParse(result).success).toBe(false);
  });

  it('rejects parent traversal while preserving valid relative paths', () => {
    const forwardTraversal = structuredClone(baseResult);
    forwardTraversal.attempts[0].specPath = '../outside.spec.ts';
    expect(RunResultSchema.safeParse(forwardTraversal).success).toBe(false);

    const backslashTraversal = structuredClone(baseResult);
    backslashTraversal.attempts[0].specPath = 'tests\\..\\outside.spec.ts';
    expect(RunResultSchema.safeParse(backslashTraversal).success).toBe(false);

    const validRelativePath = structuredClone(baseResult);
    validRelativePath.attempts[0].specPath = 'tests\\nested\\example.spec.ts';
    expect(RunResultSchema.safeParse(validRelativePath).success).toBe(true);

    const evidence = {
      uri: 'artifact://run-1/evidence/report.json',
      mediaType: 'application/json',
      byteSize: 1,
      digest,
    };
    const uriTraversal = {
      ...baseResult,
      evidence: [{ ...evidence, uri: 'artifact://run/../secret' }],
    };
    expect(RunResultSchema.safeParse(uriTraversal).success).toBe(false);

    const backslashUriTraversal = {
      ...baseResult,
      evidence: [{ ...evidence, uri: 'artifact://run\\..\\secret' }],
    };
    expect(RunResultSchema.safeParse(backslashUriTraversal).success).toBe(false);

    expect(RunResultSchema.safeParse({ ...baseResult, evidence: [evidence] }).success).toBe(true);
  });

  it('preserves recursive step evidence', () => {
    const result = structuredClone(baseResult);
    result.steps = [
      {
        id: 'step-1',
        ordinal: 0,
        status: 'passed',
        evidence: [],
        children: [
          {
            id: 'step-1-1',
            parentId: 'step-1',
            ordinal: 0,
            status: 'passed',
            evidence: [],
            children: [],
          },
        ],
      },
    ];
    expect(RunResultSchema.safeParse(result).success).toBe(true);
  });

  it('rejects invalid evidence and timestamps', () => {
    const posixPath = structuredClone(baseResult);
    posixPath.attempts[0].specPath = '/tests/example.spec.ts';
    expect(RunResultSchema.safeParse(posixPath).success).toBe(false);
    const invalidEvidence = structuredClone(baseResult);
    invalidEvidence.evidence = [
      {
        uri: 'file:///tmp/report.json',
        mediaType: 'application/json',
        byteSize: 1,
        digest,
      },
    ];
    expect(RunResultSchema.safeParse(invalidEvidence).success).toBe(false);
    const windowsEvidence = structuredClone(invalidEvidence);
    windowsEvidence.evidence[0].uri = 'C:\\artifacts\\report.json';
    expect(RunResultSchema.safeParse(windowsEvidence).success).toBe(false);
    const invalidTimestamp = structuredClone(baseResult);
    invalidTimestamp.startedAt = 'not-a-timestamp';
    expect(RunResultSchema.safeParse(invalidTimestamp).success).toBe(false);
  });

  it('rejects unknown reporter event versions and types', () => {
    expect(
      ReporterEventSchema.safeParse({
        contractVersion: '999',
        eventId: 'event-1',
        occurredAt: timestamp,
        runId: 'run-1',
        workspaceId: 'workspace-1',
        type: 'run.started',
        data: { runId: 'run-1', workspaceId: 'workspace-1' },
      }).success,
    ).toBe(false);
    expect(
      ReporterEventSchema.safeParse({
        contractVersion: '2',
        eventId: 'event-1',
        occurredAt: timestamp,
        runId: 'run-1',
        workspaceId: 'workspace-1',
        type: 'unknown',
        data: {},
      }).success,
    ).toBe(false);
  });

  it('validates the realtime envelope cursor', () => {
    expect(
      RealtimeEnvelopeSchema.safeParse({
        contractVersion: '2',
        cursor: 'cursor-1',
        eventType: 'run.updated',
        occurredAt: timestamp,
        data: { runId: 'run-1' },
      }).success,
    ).toBe(true);
  });

  it('names the run contract and keeps the runner protocol version independent', () => {
    expect(RUN_CONTRACT_VERSION).toBe('2');
    expect(RUN_CONTRACT_ID).toBe('automate.run@2');
    expect(RUNNER_PROTOCOL_VERSION).toBe('1');
    expect(LEGACY_FLAT_V1_CONTRACT_ID).toBe('legacy-flat-v1');
    // The runner protocol stays on its own version instead of drifting with the run contract.
    expect(RUNNER_PROTOCOL_VERSION).toBe(QA_CONTRACT_VERSION);
    expect(RUN_CONTRACT_VERSION).not.toBe(RUNNER_PROTOCOL_VERSION);
  });

  it('exposes the canonical reporter event types for ingestion boundaries', () => {
    expect([...REPORTER_EVENT_TYPES].sort()).toEqual([
      'artifact.ready',
      'check.attempt',
      'check.completed',
      'check.started',
      'run.completed',
      'run.started',
    ]);
  });

  it('accepts every plan proof, completeness and retention value', () => {
    for (const state of [
      'verified',
      'unverified',
      'proven',
      'unproven',
      'inconclusive',
      'contradictory',
      'unavailable',
      'stale',
    ]) {
      const result = { ...baseResult, proof: { state, digest, verifier: 'test' } };
      expect(RunResultSchema.safeParse(result).success, `proof ${state}`).toBe(true);
    }
    for (const state of ['complete', 'partial', 'unknown', 'rejected']) {
      const result = {
        ...baseResult,
        completeness: { state, missingShards: [], duplicateShards: [] },
      };
      expect(RunResultSchema.safeParse(result).success, `completeness ${state}`).toBe(true);
    }
    for (const retentionClass of ['standard', 'quarantine', 'legal_hold', 'expired']) {
      expect(
        RunResultSchema.safeParse({ ...baseResult, retention: { class: retentionClass } }).success,
        `retention ${retentionClass}`,
      ).toBe(true);
    }
    const unknown = {
      ...baseResult,
      proof: { state: 'asserted', digest, verifier: 'test' },
    };
    expect(RunResultSchema.safeParse(unknown).success).toBe(false);
    const unknownRetention = { ...baseResult, retention: { class: 'forever' } };
    expect(RunResultSchema.safeParse(unknownRetention).success).toBe(false);
  });

  it('keeps non-product attempt outcomes distinct from a product failure', () => {
    for (const status of ['blocked', 'configFailed', 'infraFailed', 'runnerFailed'] as const) {
      const result = { ...baseResult, attempts: [{ ...baseAttempt, status }] };
      expect(RunResultSchema.safeParse(result).success, `status ${status}`).toBe(true);
    }
    const invented = { ...baseResult, attempts: [{ ...baseAttempt, status: 'maybe' }] };
    expect(RunResultSchema.safeParse(invented).success).toBe(false);
  });

  it('rejects absolute, backslash-traversal and null-byte evidence paths', () => {
    const evidence = {
      uri: 'artifact://run-1/evidence/report.json',
      mediaType: 'application/json',
      byteSize: 1,
      digest,
    };
    for (const uri of [
      '/etc/passwd',
      '\\host\\share\\report.json',
      'C:\\artifacts\\report.json',
      'file:///tmp/report.json',
      'FILE:///tmp/report.json',
      'artifact://run/../secret',
      'artifact://run\\..\\secret',
      'artifact://run-1/evidence/re\0port.json',
    ]) {
      const result = { ...baseResult, evidence: [{ ...evidence, uri }] };
      expect(RunResultSchema.safeParse(result).success, `uri ${JSON.stringify(uri)}`).toBe(false);
    }
    for (const specPath of [
      '\\rooted\\example.spec.ts',
      'tests\\..\\outside.spec.ts',
      'tests/exam\0ple.spec.ts',
      '..',
      'tests/../example.spec.ts',
    ]) {
      const result = structuredClone(baseResult);
      result.attempts[0].specPath = specPath;
      expect(RunResultSchema.safeParse(result).success, `specPath ${specPath}`).toBe(false);
    }
    const valid = structuredClone(baseResult);
    valid.attempts[0].specPath = 'tests/nested\\example.spec.ts';
    expect(RunResultSchema.safeParse(valid).success).toBe(true);
  });
});
