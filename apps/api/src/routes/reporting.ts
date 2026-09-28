import { Hono } from 'hono';
import { DomainError } from '../errors/domain-error.js';
import { calculateKpis, projectRunSummary } from '@automate/reporting';
import type { ReporterResultStore } from '../services/reporter-ingestion.js';

export function createReportingRoutes(service: ReporterResultStore) {
  const app = new Hono();
  app.get('/api/v1/reporting/runs/:runId', async (context) => {
    const result = await service.get(context.req.param('runId'));
    if (!result) throw new DomainError('RUN_NOT_FOUND', 'Run not found');
    return context.json({ result, summary: projectRunSummary(result) });
  });
  app.get('/api/v1/reporting/kpis', async (context) => {
    const runId = context.req.query('runId');
    const result = runId ? await service.get(runId) : undefined;
    if (runId && !result) throw new DomainError('RUN_NOT_FOUND', 'Run not found');
    return context.json({ metrics: calculateKpis(result ? [result] : []) });
  });
  return app;
}
