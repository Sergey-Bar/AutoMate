import { Hono } from 'hono';
import { z } from 'zod/v4';
import { RunnerControlService } from '../services/runner-control.js';

const EnrollmentSchema = z.object({ enrollmentToken: z.string().min(1), capabilities: z.array(z.string()).default([]) });
const EventSchema = z.object({
  eventId: z.string().min(1),
  jobId: z.string().min(1),
  leaseId: z.string().min(1),
  fencingToken: z.number().int().min(1),
  sequence: z.number().int().min(1),
  type: z.enum(['progress', 'artifact', 'terminal']),
  payload: z.record(z.string(), z.unknown()),
});

export function createRunnerRoutes(service: RunnerControlService) {
  const app = new Hono();
  app.post('/api/v1/runner/v1/enroll', async (context) => {
    const parsed = EnrollmentSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Invalid enrollment request' }, 400);
    try {
      const identity = service.enroll(parsed.data.enrollmentToken, parsed.data.capabilities);
      return context.json({ runnerId: identity.id, credential: identity.credential }, 201);
    } catch {
      return context.json({ error: 'Invalid enrollment token' }, 401);
    }
  });
  app.post('/api/v1/runner/v1/sync', async (context) => {
    try {
      const identity = service.authenticate(bearer(context.req.header('Authorization')));
      return context.json({ runnerId: identity.id, status: identity.status, jobs: [] });
    } catch {
      return context.json({ error: 'Unauthorized' }, 401);
    }
  });
  app.post('/api/v1/runner/v1/jobs/:jobId/events/batch', async (context) => {
    try {
      const identity = service.authenticate(bearer(context.req.header('Authorization')));
      const events = z.array(EventSchema).safeParse(await context.req.json().catch(() => null));
      if (!events.success) return context.json({ error: 'Invalid event batch' }, 400);
      const results = events.data.map((event) => service.acceptEvent(identity, { ...event, jobId: context.req.param('jobId') }));
      if (results.includes('conflict')) return context.json({ error: 'Stale or conflicting event' }, 409);
      return context.json({ results });
    } catch {
      return context.json({ error: 'Unauthorized' }, 401);
    }
  });
  return app;
}

function bearer(header: string | undefined): string {
  return header?.startsWith('Bearer ') ? header.slice(7) : '';
}
