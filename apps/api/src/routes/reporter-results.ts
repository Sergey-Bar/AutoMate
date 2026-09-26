import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { CanonicalRunResultSchema } from '@automate/shared-contracts';
import type { ReporterResultStore } from '../services/reporter-ingestion.js';

export interface ReporterResultsRouteOptions {
  /**
   * Injected rather than read from `process.env` at request time: the secret
   * must be resolved once at composition, and the fail-closed decision must be
   * testable without mutating the environment.
   */
  reporterSecret?: string;
  /** When true an absent secret is an error (503). Only a dev/test harness opts out. */
  requireReporterSecret?: boolean;
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Dummy compare so a length mismatch costs the same as a value mismatch.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function createReporterResultsRoute(
  service: ReporterResultStore,
  options: ReporterResultsRouteOptions = {},
) {
  const reporterSecret = options.reporterSecret ?? process.env['REPORTER_SECRET'];
  const required = options.requireReporterSecret ?? true;
  const app = new Hono();
  app.post('/api/v1/reporter/results', async (context) => {
    // An unset secret used to leave the endpoint completely open, because the
    // `if` below short-circuited on falsiness. Fail closed instead.
    if (reporterSecret === undefined || reporterSecret === '') {
      if (required)
        return context.json(
          {
            error: {
              code: 'REPORTER_SECRET_NOT_CONFIGURED',
              message: 'Reporter ingestion is unavailable until REPORTER_SECRET is configured',
            },
          },
          503,
        );
    } else {
      const presented = context.req.header('authorization') ?? '';
      const token = presented.startsWith('Bearer ') ? presented.slice(7).trim() : '';
      if (!safeCompare(token, reporterSecret))
        return context.json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }, 401);
    }
    const body = await context.req.json().catch(() => null);
    const parsed = CanonicalRunResultSchema.safeParse(body);
    if (!parsed.success)
      return context.json({ status: 'quarantined', reason: 'invalid canonical result' }, 422);
    const result = await service.ingest(parsed.data);
    if (result.status === 'conflict')
      return context.json({ status: 'quarantined', reason: 'conflicting result' }, 409);
    return context.json(
      { status: result.status, runId: parsed.data.identity.runId },
      result.status === 'duplicate' ? 200 : 202,
    );
  });
  return app;
}
