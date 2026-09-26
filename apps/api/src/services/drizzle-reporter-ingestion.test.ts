import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@automate/db';
import type { CanonicalRunResult } from '@automate/shared-contracts';
import { DrizzleReporterIngestionService } from './drizzle-reporter-ingestion.js';

const clients: PGlite[] = [];
const digest = 'a'.repeat(64);
const result: CanonicalRunResult = {
  contractVersion: '2',
  identity: { runId: '00000000-0000-4000-8000-000000000001', workspaceId: 'workspace-1' },
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
      flakiness: 'unknown',
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

const CREATE_RESULTS_TABLE = `
  CREATE TABLE IF NOT EXISTS canonical_run_results (
    workspace_id text NOT NULL,
    run_id uuid NOT NULL,
    fingerprint text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, run_id)
  );
`;

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function createHarness(): Promise<{
  first: DrizzleReporterIngestionService;
  second: DrizzleReporterIngestionService;
}> {
  const client = new PGlite();
  clients.push(client);
  await client.exec(CREATE_RESULTS_TABLE);
  const db = drizzle(client, { schema });
  return {
    first: new DrizzleReporterIngestionService(db, 'workspace-1'),
    second: new DrizzleReporterIngestionService(db, 'workspace-1'),
  };
}

describe('DrizzleReporterIngestionService', () => {
  it('persists, deduplicates, and rejects conflicting results across service instances', async () => {
    const { first, second } = await createHarness();
    expect((await first.ingest(result)).status).toBe('accepted');
    expect((await first.ingest(result)).status).toBe('duplicate');
    expect((await first.ingest({ ...result, status: 'failed' })).status).toBe('conflict');
    expect(await first.get(result.identity.runId)).toEqual(result);
    expect((await second.ingest(result)).status).toBe('duplicate');
  });

  it('rejects results from another workspace and invalid payloads', async () => {
    const { first } = await createHarness();
    const service = first;
    expect(
      (await service.ingest({ ...result, identity: { ...result.identity, workspaceId: 'other' } }))
        .status,
    ).toBe('conflict');
    expect((await service.ingest({ identity: result.identity })).status).toBe('conflict');
  });
});
