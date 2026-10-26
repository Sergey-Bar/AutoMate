import { Hono } from 'hono';
import { z } from 'zod/v4';
import { invalidRequest } from '../http/invalid-request.js';
import { requireRole, type CallerResolver } from '../http/roles.js';
import {
  portfolioHeatmap,
  supplyChainScorecardFor,
  testEffectivenessScorecardFor,
  type ScorecardOptions,
} from '../services/scorecard-service.js';

/**
 * The two scorecards that had no endpoint — supply chain and test effectiveness — and the
 * portfolio heatmap that puts every dimension and every scorecard of every project on one
 * grid. Read-only, for any viewer. Every read is scoped to `options.workspaceId`.
 */
export interface ScorecardRouteOptions extends ScorecardOptions {
  access: CallerResolver;
}

const BranchQuerySchema = z.object({ branch: z.string().trim().min(1).max(255).optional() });

export function createScorecardRoutes(options: ScorecardRouteOptions): Hono {
  const app = new Hono();
  const viewer = requireRole('viewer', options.access);

  app.get('/api/v1/projects/:id/supply-chain/scorecard', viewer, async (context) => {
    const parsed = BranchQuerySchema.safeParse(context.req.query());
    if (!parsed.success) return invalidRequest(context, 'Invalid branch', parsed.error.issues);
    return context.json(
      await supplyChainScorecardFor(options, context.req.param('id'), parsed.data.branch),
    );
  });

  app.get('/api/v1/projects/:id/test-effectiveness/scorecard', viewer, async (context) => {
    const parsed = BranchQuerySchema.safeParse(context.req.query());
    if (!parsed.success) return invalidRequest(context, 'Invalid branch', parsed.error.issues);
    return context.json(
      await testEffectivenessScorecardFor(options, context.req.param('id'), parsed.data.branch),
    );
  });

  app.get('/api/v1/portfolio/heatmap', viewer, async (context) =>
    context.json(await portfolioHeatmap(options)),
  );

  return app;
}
