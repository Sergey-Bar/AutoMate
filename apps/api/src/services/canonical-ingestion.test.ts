/**
 * canonical-ingestion.test.ts — one write path from a canonical result to both tables.
 *
 * The whole content of this module is an **order**: the canonical row is written first and
 * is authoritative, and the projection follows from the result that was just accepted. Three
 * properties follow from that order, and each is a test.
 */

import { describe, expect, it } from 'vitest';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';
import { ReporterIngestionService } from './reporter-ingestion.js';
import { ingestCanonicalResult } from './canonical-ingestion.js';
import { InMemoryRealtimeBus } from '../realtime/realtime-bus.js';
import type { CanonicalRunResult } from '@automate/shared-contracts';
import { legacyUploadAdapter } from '@automate/reporter';
import { DEFAULT_WORKSPACE_ID } from '../repositories/run-repository.js';

const result = (overrides: Partial<Record<string, unknown>> = {}): CanonicalRunResult => {
  const parsed = legacyUploadAdapter.parse(
    new TextEncoder().encode(
      JSON.stringify({
        runId: 'ingest-1',
        tests: [{ id: 't-1', title: 'a', file: 'a.spec.ts', status: 'passed' }],
        ...overrides,
      }),
    ),
    {
      workspaceId: DEFAULT_WORKSPACE_ID,
      runId: 'ingest-1',
      sourceUri: 'reporter/upload',
      sourceDigest: 'a'.repeat(64),
      producerVersion: '1.0.0',
      adapterVersion: '2',
      startedAt: '2026-10-02T00:00:00.000Z',
    },
  );
  return parsed;
};

describe('ingesting a canonical result writes the authority and then its view', () => {
  it('accepts a fresh result and projects it', async () => {
    const store = new ReporterIngestionService(DEFAULT_WORKSPACE_ID);
    const repository = new InMemoryRunRepository();
    const outcome = await ingestCanonicalResult(result(), { store, repository });

    expect(outcome.status).toBe('accepted');
    // Both, and the authority first: the projection is written from the row that was
    // accepted, not recomputed from the request.
    expect(await store.get('ingest-1')).toBeDefined();
    expect((await repository.getRun('ingest-1'))?.status).toBe('passed');
    expect(await repository.listTests('ingest-1')).toHaveLength(1);
  });

  it('re-projects on a replay, and says so', async () => {
    const store = new ReporterIngestionService(DEFAULT_WORKSPACE_ID);
    const repository = new InMemoryRunRepository();
    await ingestCanonicalResult(result(), { store, repository });
    const replay = await ingestCanonicalResult(result(), { store, repository });

    // `duplicate` is not a failure: the same document, sent twice, is a reporter retry. What
    // must not happen is the second one being treated as new evidence.
    expect(replay.status).toBe('duplicate');
    expect(replay.projection.run.id).toBe('ingest-1');
    expect((await repository.getRun('ingest-1'))?.status).toBe('passed');
  });

  it('writes nothing at all for a conflicting result', async () => {
    const store = new ReporterIngestionService(DEFAULT_WORKSPACE_ID);
    const repository = new InMemoryRunRepository();
    await ingestCanonicalResult(result(), { store, repository });
    const conflicting = result({
      tests: [{ id: 't-1', title: 'a', file: 'a.spec.ts', status: 'failed' }],
    });

    const outcome = await ingestCanonicalResult(conflicting, { store, repository });

    // **A conflict is not projected.** The row for this run id exists with a different
    // fingerprint, so the two results disagree; writing the newer one's projection would
    // replace the dashboard's view of a run whose canonical evidence is the older one. The
    // conflict is reported and the caller decides.
    expect(outcome.status).toBe('conflict');
    expect((await repository.getRun('ingest-1'))?.status, 'the first verdict stands').toBe(
      'passed',
    );
    expect((await repository.listTests('ingest-1'))[0]?.status).toBe('passed');
    expect((await store.get('ingest-1'))?.status, 'the first evidence stands').toBe('passed');
  });

  it('refuses a result written for another workspace', async () => {
    const store = new ReporterIngestionService('workspace-a');
    const repository = new InMemoryRunRepository();
    const foreign = legacyUploadAdapter.parse(
      new TextEncoder().encode(
        JSON.stringify({
          runId: 'ingest-cross',
          tests: [{ id: 't', title: 'a', status: 'passed' }],
        }),
      ),
      {
        workspaceId: 'workspace-b',
        runId: 'ingest-cross',
        sourceUri: 'reporter/upload',
        sourceDigest: 'b'.repeat(64),
        producerVersion: '1.0.0',
        adapterVersion: '2',
        startedAt: '2026-10-02T00:00:00.000Z',
      },
    );
    const outcome = await ingestCanonicalResult(foreign, { store, repository });
    // The store's workspace is constructor-scoped, so the check is structural rather than
    // something a caller can forget — and a refusal means no projection either.
    expect(outcome.status).toBe('conflict');
    expect(await repository.getRun('ingest-cross')).toBeNull();
  });

  it('broadcasts the projected status, never the canonical one', async () => {
    const store = new ReporterIngestionService(DEFAULT_WORKSPACE_ID);
    const repository = new InMemoryRunRepository();
    const bus = new InMemoryRealtimeBus();
    await ingestCanonicalResult(result({ status: 'interrupted' }), {
      store,
      repository,
      bus,
    });
    // `RunEventEnvelope` has four run statuses. Publishing the eleven-value canonical one
    // would tell every subscriber a state the envelope does not have.
    expect(bus.published).toHaveLength(1);
    expect(bus.published[0]?.status).toBe('interrupted');
    expect((await store.get('ingest-1'))?.status).toBe('cancelled');
  });
});
