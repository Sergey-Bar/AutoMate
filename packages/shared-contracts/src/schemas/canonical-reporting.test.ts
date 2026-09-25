import { describe, expect, it } from 'vitest';
import {
  RealtimeEnvelopeSchema,
  ReporterEventSchema,
  RunResultSchema,
} from './canonical-reporting.js';

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
});
