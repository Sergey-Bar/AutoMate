/**
 * apps/server/src/routes/locator-suggestions.ts
 *
 * API for AI/heuristic selector suggestions (Phase 3B — Self-Healing Selectors).
 *
 * GET  /api/locator-suggestions          → list suggestions (optional ?testId=&runId=)
 * PUT  /api/locator-suggestions/:id/accept → mark accepted
 * PUT  /api/locator-suggestions/:id/reject → mark rejected
 */
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { locatorSuggestions } from '../db/schema.js';
import { requireFeature } from '../services/feature-flags.js';
import { and, eq } from 'drizzle-orm';

export async function locatorSuggestionsRoutes(app: FastifyInstance) {
  // ── GET /api/locator-suggestions ─────────────────────────────────────────
  app.get<{ Querystring: { testId?: string; runId?: string } }>(
    '/api/locator-suggestions',
    { preHandler: requireFeature('locator-intelligence') },
    async (req, reply) => {
      const { testId, runId } = req.query;

      const conditions = [];
      if (testId) conditions.push(eq(locatorSuggestions.testId, testId));
      if (runId) conditions.push(eq(locatorSuggestions.runId, runId));

      const rows =
        conditions.length > 0
          ? await db.select().from(locatorSuggestions).where(and(...conditions))
          : await db.select().from(locatorSuggestions);

      return reply.send(rows);
    },
  );

  // ── PUT /api/locator-suggestions/:id/accept ───────────────────────────────
  app.put<{ Params: { id: string } }>(
    '/api/locator-suggestions/:id/accept',
    { preHandler: requireFeature('locator-intelligence') },
    async (req, reply) => {
      const updated = await db
        .update(locatorSuggestions)
        .set({ status: 'accepted' })
        .where(eq(locatorSuggestions.id, req.params.id))
        .returning();

      if (updated.length === 0) {
        return reply.status(404).send({ error: 'Suggestion not found' });
      }

      return reply.send(updated[0]);
    },
  );

  // ── PUT /api/locator-suggestions/:id/reject ───────────────────────────────
  app.put<{ Params: { id: string } }>(
    '/api/locator-suggestions/:id/reject',
    { preHandler: requireFeature('locator-intelligence') },
    async (req, reply) => {
      const updated = await db
        .update(locatorSuggestions)
        .set({ status: 'rejected' })
        .where(eq(locatorSuggestions.id, req.params.id))
        .returning();

      if (updated.length === 0) {
        return reply.status(404).send({ error: 'Suggestion not found' });
      }

      return reply.send(updated[0]);
    },
  );
}
