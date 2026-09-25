/**
 * apps/server/src/routes/quarantine.ts
 *
 * CRUD for test quarantine — marker table so the runner can --grep-invert quarantined tests.
 *
 * GET    /api/quarantine              → list approved quarantine entries (for runner consumption)
 * GET    /api/quarantine/pending      → list pending entries awaiting approval (requires quarantine-approval flag)
 * POST   /api/quarantine              → add test to quarantine (status: 'approved')
 * DELETE /api/quarantine/:id          → remove from quarantine
 * PUT    /api/quarantine/:id/approve  → approve a pending quarantine (editor role, quarantine-approval flag)
 * PUT    /api/quarantine/:id/reject   → reject a pending quarantine (editor role, quarantine-approval flag)
 */
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { quarantine } from '../db/schema.js';
import { requireFeature } from '../services/feature-flags.js';
import { requireRole } from '../plugins/rbac.js';
import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { z } from 'zod';

export async function quarantineRoutes(app: FastifyInstance) {
  // List approved entries (runner consumption — backward compatible)
  app.get('/api/quarantine', { preHandler: requireFeature('auto-quarantine') }, async (_req, reply) => {
    const rows = await db.select().from(quarantine).where(and(eq(quarantine.status, 'approved'), isNull(quarantine.resolvedAt)));
    const response = rows.map((row) => ({
      id: row.id,
      testTitle: row.testTitle,
      testFile: row.testFile,
      reason: row.reason,
      quarantinedAt: row.quarantinedAt,
      quarantinedBy: row.quarantinedBy,
      status: row.status,
      flakinessCategory: row.flakinessCategory ?? 'unknown',
      categoryConfidence: row.categoryConfidence ?? 0,
      categoryEvidence: row.categoryEvidence ? (JSON.parse(row.categoryEvidence) as string[]) : [],
    }));
    return reply.send(response);
  });

  // List pending entries awaiting approval (admin/editor review)
  app.get(
    '/api/quarantine/pending',
    { preHandler: [requireFeature('quarantine-approval'), requireRole('admin', 'editor')] },
    async (_req, reply) => {
      const rows = await db.select().from(quarantine).where(eq(quarantine.status, 'pending'));
      return reply.send(rows);
    },
  );

  // Add (manual additions are always pre-approved)
  app.post<{
    Body: { testTitle: string; testFile: string; reason?: string };
  }>('/api/quarantine', { preHandler: requireFeature('auto-quarantine') }, async (req, reply) => {
    const body = z.object({
      testTitle: z.string().min(1),
      testFile: z.string().min(1),
      reason: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Invalid body', details: body.error.flatten() });
    const { testTitle, testFile, reason } = body.data;
    const id = randomUUID();
    await db.insert(quarantine).values({
      id,
      testTitle,
      testFile,
      reason: reason ?? null,
      quarantinedAt: new Date().toISOString(),
      status: 'approved',
    });
    return reply.code(201).send({ id, testTitle, testFile, reason });
  });

  // Approve a pending quarantine entry
  app.put<{ Params: { id: string } }>(
    '/api/quarantine/:id/approve',
    { preHandler: [requireFeature('quarantine-approval'), requireRole('admin', 'editor')] },
    async (req, reply) => {
      const updated = await db
        .update(quarantine)
        .set({ status: 'approved' })
        .where(eq(quarantine.id, req.params.id))
        .returning({ id: quarantine.id, status: quarantine.status });
      if (updated.length === 0) return reply.code(404).send({ error: 'Quarantine entry not found' });
      return reply.code(200).send(updated[0]);
    },
  );

  // Reject a pending quarantine entry
  app.put<{ Params: { id: string } }>(
    '/api/quarantine/:id/reject',
    { preHandler: [requireFeature('quarantine-approval'), requireRole('admin', 'editor')] },
    async (req, reply) => {
      const updated = await db
        .update(quarantine)
        .set({ status: 'rejected' })
        .where(eq(quarantine.id, req.params.id))
        .returning({ id: quarantine.id, status: quarantine.status });
      if (updated.length === 0) return reply.code(404).send({ error: 'Quarantine entry not found' });
      return reply.code(200).send(updated[0]);
    },
  );

  // Remove
  app.delete<{ Params: { id: string } }>(
    '/api/quarantine/:id',
    { preHandler: requireFeature('auto-quarantine') },
    async (req, reply) => {
      const deleted = await db
        .delete(quarantine)
        .where(eq(quarantine.id, req.params.id))
        .returning({ id: quarantine.id });
      if (deleted.length === 0) return reply.code(404).send({ error: 'Quarantine entry not found' });
      return reply.code(204).send();
    },
  );
}
