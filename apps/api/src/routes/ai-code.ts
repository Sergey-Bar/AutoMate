import { Hono } from 'hono';
import { z } from 'zod/v4';
import { AiAttributionSchema } from '@automate/shared-contracts';
import { invalidRequest } from '../http/invalid-request.js';
import { requireRole, type CallerResolver } from '../http/roles.js';
import {
  aiCodePullRequests,
  aiCodeReport,
  portfolioAiCode,
  type AiCodeOptions,
} from '../services/ai-code-service.js';

/**
 * AI-written code: how much change is agent-authored or AI-assisted, and whether it fares
 * worse than human change. Read-only, for any viewer. No response carries an author login, an
 * email address or a name — the unit is a kind of authorship and a tool, never a person.
 */
export interface AiCodeRouteOptions extends AiCodeOptions {
  access: CallerResolver;
}

const DaysSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(90) });

const PullRequestQuerySchema = z.object({
  attribution: AiAttributionSchema.optional(),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function createAiCodeRoutes(options: AiCodeRouteOptions): Hono {
  const app = new Hono();
  const viewer = requireRole('viewer', options.access);

  app.get('/api/v1/projects/:id/ai-code', viewer, async (context) => {
    const parsed = DaysSchema.safeParse(context.req.query());
    if (!parsed.success)
      return invalidRequest(context, 'Invalid ai-code window', parsed.error.issues);
    return context.json(await aiCodeReport(options, context.req.param('id'), parsed.data.days));
  });

  app.get('/api/v1/projects/:id/ai-code/pull-requests', viewer, async (context) => {
    const parsed = PullRequestQuerySchema.safeParse(context.req.query());
    if (!parsed.success)
      return invalidRequest(context, 'Invalid ai-code query', parsed.error.issues);
    return context.json(await aiCodePullRequests(options, context.req.param('id'), parsed.data));
  });

  app.get('/api/v1/portfolio/ai-code', viewer, async (context) => {
    const parsed = DaysSchema.safeParse(context.req.query());
    if (!parsed.success)
      return invalidRequest(context, 'Invalid ai-code window', parsed.error.issues);
    return context.json(await portfolioAiCode(options, parsed.data.days));
  });

  return app;
}
