/**
 * workspaces.ts — CRUD server routes for multi-repo workspace management
 *
 * GET    /api/workspaces                    — list all workspaces
 * POST   /api/workspaces                    — create workspace
 * PUT    /api/workspaces/:id                — update workspace
 * DELETE /api/workspaces/:id               — delete workspace
 * GET    /api/workspaces/:id/gate-config    — get workspace-specific gate config (viewer+)
 * PUT    /api/workspaces/:id/gate-config    — upsert workspace gate config (editor+)
 */
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { workspaces, qualityGateConfig } from '../db/schema.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { requireFeature } from '../services/feature-flags.js';
import { requireRole } from '../plugins/rbac.js';

export async function workspacesRoutes(app: FastifyInstance) {
  // GET /api/workspaces
  app.get('/api/workspaces', async (_req, reply) => {
    const rows = await db.select().from(workspaces);
    return reply.send(rows);
  });

  // POST /api/workspaces
  app.post('/api/workspaces', async (req, reply) => {
    const body = z
      .object({
        name: z.string().min(1),
        configPath: z.string().min(1),
        testResultsDir: z.string().optional(),
      })
      .safeParse(req.body);

    if (!body.success) return reply.status(400).send({ error: 'Invalid body', details: body.error.flatten() });

    const id = randomUUID();
    await db.insert(workspaces)
      .values({
        id,
        name: body.data.name,
        configPath: body.data.configPath,
        testResultsDir: body.data.testResultsDir ?? null,
        createdAt: new Date().toISOString(),
      });

    return reply.status(201).send({ id, ...body.data });
  });

  // PUT /api/workspaces/:id
  app.put<{ Params: { id: string } }>('/api/workspaces/:id', async (req, reply) => {
    const body = z
      .object({
        name: z.string().min(1).optional(),
        configPath: z.string().min(1).optional(),
        testResultsDir: z.string().optional(),
      })
      .safeParse(req.body);

    if (!body.success) return reply.status(400).send({ error: 'Invalid body' });

    const updates: Record<string, string> = {};
    if (body.data.name) updates.name = body.data.name;
    if (body.data.configPath) updates.configPath = body.data.configPath;
    if (body.data.testResultsDir !== undefined) updates.testResultsDir = body.data.testResultsDir;

    await db.update(workspaces).set(updates).where(eq(workspaces.id, req.params.id));
    return reply.send({ updated: true });
  });

  // DELETE /api/workspaces/:id
  app.delete<{ Params: { id: string } }>('/api/workspaces/:id', async (req, reply) => {
    const deleted = await db
      .delete(workspaces)
      .where(eq(workspaces.id, req.params.id))
      .returning({ id: workspaces.id });
    if (deleted.length === 0) return reply.status(404).send({ error: 'Workspace not found' });
    return reply.send({ deleted: true });
  });

  // ── Quality gate config endpoints ──────────────────────────────────────────

  // GET /api/workspaces/:id/gate-config — returns workspace-specific config or global fallback
  app.get<{ Params: { id: string } }>(
    '/api/workspaces/:id/gate-config',
    { preHandler: requireFeature('per-workspace-gates') },
    async (req, reply) => {
      // Try workspace-specific first
      const wsCfgs = await db.select().from(qualityGateConfig)
        .where(eq(qualityGateConfig.workspaceId, req.params.id));
      if (wsCfgs.length > 0) return reply.send(wsCfgs[0]);

      // Fall back to global config
      const globalCfgs = await db.select().from(qualityGateConfig)
        .where(eq(qualityGateConfig.id, 'global'));
      if (globalCfgs.length > 0) return reply.send({ ...globalCfgs[0], isGlobalFallback: true });

      // No config at all — return defaults
      return reply.send({
        passRateThreshold: 100,
        maxDurationMs: null,
        maxFlakyCount: null,
        maxQuarantinePercent: null,
        isGlobalFallback: true,
      });
    },
  );

  // PUT /api/workspaces/:id/gate-config — upsert workspace-specific gate config
  app.put<{ Params: { id: string } }>(
    '/api/workspaces/:id/gate-config',
    { preHandler: [requireFeature('per-workspace-gates'), requireRole('admin', 'editor')] },
    async (req, reply) => {
      const body = z
        .object({
          passRateThreshold: z.number().min(0).max(100).optional(),
          maxDurationMs: z.number().int().positive().nullable().optional(),
          maxFlakyCount: z.number().int().min(0).nullable().optional(),
          maxQuarantinePercent: z.number().min(0).max(100).nullable().optional(),
        })
        .safeParse(req.body);

      if (!body.success) {
        return reply.status(400).send({ error: 'Invalid body', details: body.error.flatten() });
      }

      const wsId = req.params.id;
      const now = new Date().toISOString();

      // Check if workspace-specific config already exists
      const existing = await db.select().from(qualityGateConfig)
        .where(eq(qualityGateConfig.workspaceId, wsId));

      if (existing.length > 0) {
        // Update existing workspace config
        const updates: Partial<typeof qualityGateConfig.$inferInsert> = { updatedAt: now };
        if (body.data.passRateThreshold !== undefined) updates.passRateThreshold = body.data.passRateThreshold;
        if (body.data.maxDurationMs !== undefined) updates.maxDurationMs = body.data.maxDurationMs;
        if (body.data.maxFlakyCount !== undefined) updates.maxFlakyCount = body.data.maxFlakyCount;
        if (body.data.maxQuarantinePercent !== undefined) updates.maxQuarantinePercent = body.data.maxQuarantinePercent;
        await db.update(qualityGateConfig).set(updates).where(eq(qualityGateConfig.workspaceId, wsId));
      } else {
        // Insert new workspace-specific config (id = wsId for unique identification)
        await db.insert(qualityGateConfig).values({
          id: wsId,
          workspaceId: wsId,
          passRateThreshold: body.data.passRateThreshold ?? 100,
          maxDurationMs: body.data.maxDurationMs ?? null,
          maxFlakyCount: body.data.maxFlakyCount ?? null,
          maxQuarantinePercent: body.data.maxQuarantinePercent ?? null,
          updatedAt: now,
        });
      }

      const [updated] = await db.select().from(qualityGateConfig)
        .where(eq(qualityGateConfig.workspaceId, wsId));
      return reply.send(updated);
    },
  );
}
