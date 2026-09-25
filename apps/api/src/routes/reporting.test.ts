import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { ReporterIngestionService } from '../services/reporter-ingestion.js';
import { createReportingRoutes } from './reporting.js';

const digest = 'a'.repeat(64);
const result = {
  contractVersion: '2' as const,
  identity: { runId: 'run-1', workspaceId: 'workspace-1' },
  status: 'passed' as const,
  startedAt: '2026-09-25T00:00:00.000Z',
  attempts: [
    {
      index: 1,
      testId: 'test-1',
      specPath: 'tests/example.spec.ts',
      title: 'example',
      status: 'passed' as const,
      rawStatus: 'passed',
      startedAt: '2026-09-25T00:00:00.000Z',
      evidence: [],
      flakiness: 'unknown' as const,
    },
  ],
  steps: [],
  evidence: [],
  provenance: {
    producer: 'playwright' as const,
    producerVersion: '1',
    adapterVersion: '1',
    sourceDigest: digest,
    sourceUri: 'artifact://run/report.json',
  },
  retention: { class: 'standard' as const },
  proof: { state: 'verified' as const, digest, verifier: 'test' },
  completeness: { state: 'complete' as const, missingShards: [], duplicateShards: [] },
  raw: {},
};

describe('reporting routes', () => {
  it('returns 404 for missing runs and empty aggregate metrics', async () => {
    const service = new ReporterIngestionService('workspace-1');
    const app = new Hono().route('/', createReportingRoutes(service));
    expect((await app.request('/api/v1/reporting/runs/missing')).status).toBe(404);
    expect((await app.request('/api/v1/reporting/kpis?runId=missing')).status).toBe(404);
    const empty = await app.request('/api/v1/reporting/kpis');
    expect(((await empty.json()) as { metrics: unknown[] }).metrics).toHaveLength(5);
  });

  it('returns canonical run and KPI projections', async () => {
    const service = new ReporterIngestionService('workspace-1');
    service.ingest(result);
    const app = new Hono().route('/', createReportingRoutes(service));
    const run = await app.request('/api/v1/reporting/runs/run-1');
    expect(run.status).toBe(200);
    expect(((await run.json()) as { summary: { total: number } }).summary.total).toBe(1);
    const kpis = await app.request('/api/v1/reporting/kpis?runId=run-1');
    expect(((await kpis.json()) as { metrics: unknown[] }).metrics).toHaveLength(5);
  });
});
