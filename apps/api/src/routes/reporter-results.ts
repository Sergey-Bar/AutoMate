import { Hono } from 'hono';
import { CanonicalRunResultSchema } from '@automate/shared-contracts';
import { ReporterIngestionService } from '../services/reporter-ingestion.js';

export function createReporterResultsRoute(service: ReporterIngestionService) {
  const app = new Hono();
  app.post('/api/v1/reporter/results', async (context) => {
    const reporterSecret = process.env['REPORTER_SECRET'];
    if (reporterSecret && context.req.header('Authorization') !== `Bearer ${reporterSecret}`) {
      return context.json({ error: 'Unauthorized' }, 401);
    }
    const body = await context.req.json().catch(() => null);
    const parsed = CanonicalRunResultSchema.safeParse(body);
    if (!parsed.success)
      return context.json({ status: 'quarantined', reason: 'invalid canonical result' }, 422);
    const result = service.ingest(parsed.data);
    if (result.status === 'conflict')
      return context.json({ status: 'quarantined', reason: 'conflicting result' }, 409);
    return context.json(
      { status: result.status, runId: parsed.data.identity.runId },
      result.status === 'duplicate' ? 200 : 202,
    );
  });
  return app;
}
