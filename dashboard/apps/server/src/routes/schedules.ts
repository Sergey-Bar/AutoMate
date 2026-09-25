/**
 * apps/server/src/routes/schedules.ts
 *
 * CRUD endpoints for scheduled runs.
 *
 * GET    /api/schedules       → list all schedules
 * POST   /api/schedules       → create schedule
 * PUT    /api/schedules/:id   → update schedule
 * DELETE /api/schedules/:id   → delete schedule
 */
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { schedules } from '../db/schema.js';
import { requireFeature } from '../services/feature-flags.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { scheduler } from '../services/scheduler.js';

export async function schedulesRoutes(app: FastifyInstance) {
  // List
  app.get('/api/schedules', { preHandler: requireFeature('scheduled-runs') }, async (_req, reply) => {
    const rows = await db.select().from(schedules);
    return reply.send(rows);
  });

  // Create — auth enforced by global onRequest hook in plugins/auth.ts
  app.post<{
    Body: { cronExpr: string; runOptions?: Record<string, unknown>; enabled?: boolean };
  }>('/api/schedules', {
    preHandler: requireFeature('scheduled-runs'),
  }, async (req, reply) => {
    const body = z.object({
      cronExpr: z.string().min(1),
      runOptions: z.record(z.unknown()).optional(),
      enabled: z.boolean().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Invalid schedule', details: body.error.flatten() });
    const { cronExpr, runOptions, enabled } = body.data;
    const id = randomUUID();
    await db.insert(schedules).values({
      id,
      cronExpr,
      runOptions: runOptions ? JSON.stringify(runOptions) : null,
      enabled: enabled ?? true,
      createdAt: new Date().toISOString(),
    });
    await scheduler.reload();
    return reply.code(201).send({ id, cronExpr, enabled: enabled ?? true });
  });

  // Update — auth enforced by global onRequest hook in plugins/auth.ts
  app.put<{
    Params: { id: string };
    Body: { cronExpr?: string; runOptions?: Record<string, unknown>; enabled?: boolean };
  }>('/api/schedules/:id', {
    preHandler: requireFeature('scheduled-runs'),
  }, async (req, reply) => {
    const body = z.object({
      cronExpr: z.string().min(1).optional(),
      runOptions: z.record(z.unknown()).optional(),
      enabled: z.boolean().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'Invalid schedule', details: body.error.flatten() });
    const updates: Record<string, unknown> = {};
    if (body.data.cronExpr !== undefined) updates.cronExpr = body.data.cronExpr;
    if (body.data.runOptions !== undefined) updates.runOptions = JSON.stringify(body.data.runOptions);
    if (body.data.enabled !== undefined) updates.enabled = body.data.enabled;
    await db.update(schedules).set(updates).where(eq(schedules.id, req.params.id));
    await scheduler.reload();
    return reply.send({ ok: true });
  });

  // Delete — auth enforced by global onRequest hook in plugins/auth.ts
  app.delete<{ Params: { id: string } }>(
    '/api/schedules/:id',
    {
      preHandler: requireFeature('scheduled-runs'),
    },
    async (req, reply) => {
      const deleted = await db
        .delete(schedules)
        .where(eq(schedules.id, req.params.id))
        .returning({ id: schedules.id });
      if (deleted.length === 0) return reply.code(404).send({ error: 'Schedule not found' });
      await scheduler.reload();
      return reply.code(204).send();
    },
  );
}
