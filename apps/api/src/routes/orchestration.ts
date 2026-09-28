import { Hono } from 'hono';
import { DomainError } from '../errors/domain-error.js';
import { AutomationDefinitionSchema, ScheduleSchema } from '@automate/shared-contracts';
import { OrchestrationService } from '../services/orchestration-service.js';

/**
 * A miss, as opposed to a fault.
 *
 * The service signals "no such automation" by throwing a plain `Error`, so the
 * handler cannot tell that apart from a defect inside `enqueue` itself — and
 * `catch { return 404 }` reported every failure as "not found". A caller whose
 * enqueue had a bug would be told to check their id, and nothing would be logged.
 *
 * So the message is matched, and anything else becomes a 500 through the app's
 * error boundary with the cause recorded. Returning 404 for a genuine internal
 * error is how a broken feature stays broken.
 */
function notFoundIfMissing(error: unknown, what: string): boolean {
  return error instanceof Error && error.message === `${what} not found`;
}

export function createOrchestrationRoutes(service: OrchestrationService) {
  const app = new Hono();
  app.get('/api/v1/automations', (context) =>
    context.json({ automations: service.listAutomations() }),
  );
  app.post('/api/v1/automations', async (context) => {
    const parsed = AutomationDefinitionSchema.omit({ id: true }).safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success)
      throw new DomainError('INVALID_AUTOMATION_DEFINITION', 'Invalid automation definition');
    return context.json({ automation: service.createAutomation(parsed.data) }, 201);
  });
  app.get('/api/v1/schedules', (context) => context.json({ schedules: [] }));
  app.post('/api/v1/schedules', async (context) => {
    const parsed = ScheduleSchema.omit({ id: true }).safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) throw new DomainError('INVALID_SCHEDULE', 'Invalid schedule');
    return context.json({ schedule: service.createSchedule(parsed.data) }, 201);
  });
  app.get('/api/v1/jobs', (context) => context.json({ jobs: service.listJobs() }));
  app.post('/api/v1/automations/:id/jobs', (context) => {
    try {
      return context.json({ job: service.enqueue(context.req.param('id')) }, 202);
    } catch (failure) {
      if (notFoundIfMissing(failure, 'Automation')) {
        throw new DomainError('AUTOMATION_NOT_FOUND', 'Automation not found');
      }
      // Re-thrown so the app boundary classifies it and logs it, rather than a
      // defect inside `enqueue` being reported as a missing automation.
      throw failure;
    }
  });
  app.post('/api/v1/jobs/:id/cancel', (context) => {
    try {
      return context.json({ job: service.cancel(context.req.param('id')) });
    } catch (failure) {
      if (notFoundIfMissing(failure, 'Job')) {
        throw new DomainError('JOB_NOT_FOUND', 'Job not found');
      }
      throw failure;
    }
  });
  return app;
}
