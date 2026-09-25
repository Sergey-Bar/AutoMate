import { Hono } from 'hono';
import { calculateKpis, projectRunSummary } from '@automate/reporting';
import { ReporterIngestionService } from '../services/reporter-ingestion.js';

export function createReportingRoutes(service: ReporterIngestionService) {
  const app = new Hono();
  app.get('/api/v1/reporting/runs/:runId', (context) => {
    const result = service.get(context.req.param('runId'));
    if (!result) return context.json({ error: 'Run not found' }, 404);
    return context.json({ result, summary: projectRunSummary(result) });
  });
  app.get('/api/v1/reporting/kpis', (context) => {
    const runId = context.req.query('runId');
    const result = runId ? service.get(runId) : undefined;
    if (runId && !result) return context.json({ error: 'Run not found' }, 404);
    return context.json({ metrics: calculateKpis(result ? [result] : []) });
  });
  return app;
}
