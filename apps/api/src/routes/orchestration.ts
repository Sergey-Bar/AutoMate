import { Hono } from 'hono';
import { AutomationDefinitionSchema, ScheduleSchema } from '@automate/shared-contracts';
import { OrchestrationService } from '../services/orchestration-service.js';

export function createOrchestrationRoutes(service: OrchestrationService) {
  const app = new Hono();
  app.get('/api/v1/automations', (context) =>
    context.json({ automations: service.listAutomations() }),
  );
  app.post('/api/v1/automations', async (context) => {
    const parsed = AutomationDefinitionSchema.omit({ id: true }).safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) return context.json({ error: 'Invalid automation definition' }, 400);
    return context.json({ automation: service.createAutomation(parsed.data) }, 201);
  });
  app.get('/api/v1/schedules', (context) => context.json({ schedules: [] }));
  app.post('/api/v1/schedules', async (context) => {
    const parsed = ScheduleSchema.omit({ id: true }).safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) return context.json({ error: 'Invalid schedule' }, 400);
    return context.json({ schedule: service.createSchedule(parsed.data) }, 201);
  });
  app.get('/api/v1/jobs', (context) => context.json({ jobs: service.listJobs() }));
  app.post('/api/v1/automations/:id/jobs', (context) => {
    try {
      return context.json({ job: service.enqueue(context.req.param('id')) }, 202);
    } catch {
      return context.json({ error: 'Automation not found' }, 404);
    }
  });
  app.post('/api/v1/jobs/:id/cancel', (context) => {
    try {
      return context.json({ job: service.cancel(context.req.param('id')) });
    } catch {
      return context.json({ error: 'Job not found' }, 404);
    }
  });
  return app;
}
