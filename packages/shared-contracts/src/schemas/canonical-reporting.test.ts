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
