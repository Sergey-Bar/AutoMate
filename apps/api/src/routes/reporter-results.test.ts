import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { ReporterIngestionService } from '../services/reporter-ingestion.js';
import { createReporterResultsRoute } from './reporter-results.js';

const digest = 'e'.repeat(64);
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

describe('reporter results route', () => {
  const openIngestion = () =>
    new Hono().route(
      '/',
      createReporterResultsRoute(new ReporterIngestionService('workspace-1'), {
        reporterSecret: undefined,
        requireReporterSecret: false,
      }),
    );

  it('accepts canonical results and reports duplicates', async () => {
    const app = openIngestion();
    const first = await app.request('/api/v1/reporter/results', {
      method: 'POST',
      body: JSON.stringify(result),
      headers: { 'content-type': 'application/json' },
    });
    const second = await app.request('/api/v1/reporter/results', {
      method: 'POST',
      body: JSON.stringify(result),
      headers: { 'content-type': 'application/json' },
    });
    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
  });

  it('requires the reporter secret when configured', async () => {
    const app = new Hono().route(
      '/',
      createReporterResultsRoute(new ReporterIngestionService('workspace-1'), {
        reporterSecret: 'reporter-secret',
      }),
    );
    const unauthorized = await app.request('/api/v1/reporter/results', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(unauthorized.status).toBe(401);
    const authorized = await app.request('/api/v1/reporter/results', {
      method: 'POST',
      body: JSON.stringify(result),
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer reporter-secret',
      },
    });
    expect(authorized.status).toBe(202);
  });

  it('fails closed with 503 when the secret is unset and one is required', async () => {
    const previous = process.env['REPORTER_SECRET'];
    delete process.env['REPORTER_SECRET'];
    try {
      const app = new Hono().route(
        '/',
        createReporterResultsRoute(new ReporterIngestionService('workspace-1'), {
          reporterSecret: undefined,
        }),
      );
      // An unset secret used to leave this endpoint completely open.
      const response = await app.request('/api/v1/reporter/results', {
        method: 'POST',
        body: JSON.stringify(result),
        headers: { 'content-type': 'application/json' },
      });
      expect(response.status).toBe(503);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'REPORTER_SECRET_NOT_CONFIGURED',
      );
    } finally {
      if (previous === undefined) delete process.env['REPORTER_SECRET'];
      else process.env['REPORTER_SECRET'] = previous;
    }
  });

  it('rejects a token that is a prefix of the secret, differs in case, or is empty', async () => {
    const app = new Hono().route(
      '/',
      createReporterResultsRoute(new ReporterIngestionService('workspace-1'), {
        reporterSecret: 'reporter-secret',
      }),
    );
    for (const token of ['reporter-secre', 'Reporter-secret', '']) {
      const response = await app.request('/api/v1/reporter/results', {
        method: 'POST',
        body: JSON.stringify(result),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(401);
    }
  });

  it('quarantines invalid results', async () => {
    const app = openIngestion();
    const response = await app.request('/api/v1/reporter/results', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(422);
  });
});
