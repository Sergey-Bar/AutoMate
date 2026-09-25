/**
 * apps/server/src/routes/known-failures.ts
 *
 * CRUD for known failures — tests annotated as expected to fail, excluded from pass-rate metrics.
 *
 * GET    /api/known-failures       → list all
 * POST   /api/known-failures       → mark a test as known failure
 * DELETE /api/known-failures/:id   → remove known failure annotation
 */
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { knownFailures } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireFeature } from '../services/feature-flags.js';
import { randomUUID } from 'crypto';
import { z } from 'zod';

export async function knownFailureRoutes(app: FastifyInstance) {
  app.get('/api/known-failures', { preHandler: requireFeature('known-failure-tracking') }, async (_req, reply) => {
    const rows = await db.select().from(knownFailures);
    return reply.send(rows);
  });

  app.post<{
    Body: { testTitle: string; testFile: string; comment?: string };
  }>('/api/known-failures', { preHandler: requireFeature('known-failure-tracking') }, async (req, reply) => {
    const body = z.object({
      testTitle: z.string().min(1),
      testFile: z.string().min(1),
      comment: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Invalid body', details: body.error.flatten() });
    const { testTitle, testFile, comment } = body.data;
    const id = randomUUID();
    await db.insert(knownFailures).values({
      id,
      testTitle,
      testFile,
      comment: comment ?? null,
      createdAt: new Date().toISOString(),
    });
    return reply.code(201).send({ id, testTitle, testFile, comment });
  });

  app.delete<{ Params: { id: string } }>(
    '/api/known-failures/:id',
    { preHandler: requireFeature('known-failure-tracking') },
    async (req, reply) => {
      const deleted = await db
        .delete(knownFailures)
        .where(eq(knownFailures.id, req.params.id))
        .returning({ id: knownFailures.id });
      if (deleted.length === 0) return reply.code(404).send({ error: 'Known failure entry not found' });
      return reply.code(204).send();
    },
  );
}
