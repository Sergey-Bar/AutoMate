import { Hono } from 'hono';
import { z } from 'zod/v4';
import { RunnerControlService } from '../services/runner-control.js';

const EnrollmentSchema = z.object({
  enrollmentToken: z.string().min(1),
  capabilities: z.array(z.string()).default([]),
});
const EventSchema = z.object({
  eventId: z.string().min(1),
  jobId: z.string().min(1),
  leaseId: z.string().min(1),
  fencingToken: z.number().int().min(1),
  sequence: z.number().int().min(1),
  type: z.enum(['progress', 'artifact', 'terminal']),
  payload: z.record(z.string(), z.unknown()),
});

/** The one failure a runner can legitimately provoke: an unusable credential. */
class UnauthorizedError extends Error {}

type RunnerIdentity = ReturnType<RunnerControlService['authenticate']>;

/**
 * The service signals "this credential is not acceptable" by throwing. Every
 * handler used to wrap its whole body in `try { … } catch { return 401 }`, so an
 * internal defect inside a handler was reported to the runner as an
 * authentication failure — the hardest kind of bug to notice across a network.
 * Only this call is guarded; anything else reaches the central error handler
 * and becomes a logged 500.
 */
function requireIdentity(
  service: RunnerControlService,
  header: string | undefined,
): RunnerIdentity {
  try {
    return service.authenticate(bearer(header));
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid runner credential')
      throw new UnauthorizedError('Unauthorized');
    throw error;
  }
}

export function createRunnerRoutes(service: RunnerControlService) {
  const app = new Hono();
  app.onError((error, context) => {
    if (error instanceof UnauthorizedError) return context.json({ error: 'Unauthorized' }, 401);
    console.error('runner route failed', {
      path: context.req.path,
      error: error instanceof Error ? error.message : String(error),
    });
    return context.json({ error: 'Internal error' }, 500);
  });

  app.post('/api/v1/runner/v1/enroll', async (context) => {
    const parsed = EnrollmentSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: 'Invalid enrollment request' }, 400);
    try {
      const identity = service.enroll(parsed.data.enrollmentToken, parsed.data.capabilities);
      return context.json({ runnerId: identity.id, credential: identity.credential }, 201);
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid enrollment token')
        return context.json({ error: 'Invalid enrollment token' }, 401);
      throw error;
    }
  });
  app.post('/api/v1/runner/v1/sync', async (context) => {
    const identity = requireIdentity(service, context.req.header('Authorization'));
    return context.json({ runnerId: identity.id, status: identity.status, jobs: [] });
  });
  app.post('/api/v1/runner/v1/jobs/:jobId/events/batch', async (context) => {
    const identity = requireIdentity(service, context.req.header('Authorization'));
    const events = z.array(EventSchema).safeParse(await context.req.json().catch(() => null));
    if (!events.success) return context.json({ error: 'Invalid event batch' }, 400);
    const results = events.data.map((event) =>
      service.acceptEvent(identity, { ...event, jobId: context.req.param('jobId') }),
    );
    if (results.includes('conflict'))
      return context.json({ error: 'Stale or conflicting event' }, 409);
    return context.json({ results });
  });
  return app;
}

function bearer(header: string | undefined): string {
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
}
