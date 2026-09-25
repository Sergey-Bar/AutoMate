import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { qualityGateConfig } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

export async function gateRoutes(app: FastifyInstance) {
  // GET /api/gate-config
  app.get('/api/gate-config', async (_req, reply) => {
    const [cfg] = await db.select().from(qualityGateConfig).where(eq(qualityGateConfig.id, 'global'));
    return reply.send(cfg ?? { id: 'global', passRateThreshold: 100, maxDurationMs: null, maxFlakyCount: null });
  });

  // PUT /api/gate-config — auth enforced by global onRequest hook in plugins/auth.ts
  const GateConfigBody = z.object({
    passRateThreshold: z.number().min(0).max(100),
    maxDurationMs: z.number().min(0).nullable().optional(),
    maxFlakyCount: z.number().min(0).nullable().optional(),
  });
  app.put('/api/gate-config', async (req, reply) => {
    const body = GateConfigBody.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });
    await db
      .insert(qualityGateConfig)
      .values({
        id: 'global',
        passRateThreshold: body.data.passRateThreshold,
        maxDurationMs: body.data.maxDurationMs ?? null,
        maxFlakyCount: body.data.maxFlakyCount ?? null,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: qualityGateConfig.id,
        set: {
          passRateThreshold: body.data.passRateThreshold,
          maxDurationMs: body.data.maxDurationMs ?? null,
          maxFlakyCount: body.data.maxFlakyCount ?? null,
          updatedAt: new Date().toISOString(),
        },
      });
    return reply.send({ ok: true });
  });
}
