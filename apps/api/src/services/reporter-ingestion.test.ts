import { describe, expect, it } from 'vitest';
import type { CanonicalRunResult } from '@automate/shared-contracts';
import { ReporterIngestionService } from './reporter-ingestion.js';

const digest = 'd'.repeat(64);
const result: CanonicalRunResult = {
  contractVersion: '2',
  identity: { runId: 'run-1', workspaceId: 'workspace-1' },
  status: 'passed',
  startedAt: '2026-09-25T00:00:00.000Z',
  attempts: [
    {
      index: 1,
      testId: 'test-1',
      specPath: 'tests/example.spec.ts',
      title: 'example',
      status: 'passed',
      rawStatus: 'passed',
      startedAt: '2026-09-25T00:00:00.000Z',
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

describe('ReporterIngestionService', () => {
  it('accepts once and treats identical input as duplicate', () => {
    const service = new ReporterIngestionService('workspace-1');
    expect(service.ingest(result).status).toBe('accepted');
    expect(service.ingest(result).status).toBe('duplicate');
  });

  it('rejects workspace mismatches and conflicting run payloads', () => {
    const service = new ReporterIngestionService('workspace-1');
    expect(
      service.ingest({ ...result, identity: { ...result.identity, workspaceId: 'other' } }).status,
    ).toBe('conflict');
    service.ingest(result);
    expect(service.ingest({ ...result, status: 'failed' }).status).toBe('conflict');
  });
});
