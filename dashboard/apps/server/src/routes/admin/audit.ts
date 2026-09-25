/**
 * routes/admin/audit.ts — Audit event query endpoint.
 *
 * GET /api/admin/audit
 *   Query params: actor, action, resourceType, resourceId, from, to, limit, offset
 *   Requires: requireFeature('audit-trail') + requireRole('admin')
 */
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/client.js';
import { auditEvents } from '../../db/schema.js';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { requireFeature } from '../../services/feature-flags.js';
import { requireRole } from '../../plugins/rbac.js';

function parseIntParam(val: string | undefined, defaultVal: number, max: number): number {
  if (!val) return defaultVal;
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return defaultVal;
  return Math.min(Math.floor(n), max);
}

type AuditQuery = {
  actor?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  from?: string;   // ISO-8601 date string
  to?: string;     // ISO-8601 date string
  limit?: string;
  offset?: string;
};

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/admin/audit — Filtered audit event query
  app.get<{ Querystring: AuditQuery }>(
    '/api/admin/audit',
    {
      preHandler: [requireFeature('audit-trail'), requireRole('admin')],
    },
    async (req, reply): Promise<void> => {
      const {
        actor,
        action,
        resourceType,
        resourceId,
        from: fromDate,
        to: toDate,
      } = req.query;
      const limit = parseIntParam(req.query.limit, 50, 500);
      const offset = parseIntParam(req.query.offset, 0, 1_000_000);

      const conditions = [
        actor ? eq(auditEvents.actorId, actor) : undefined,
        action ? eq(auditEvents.action, action) : undefined,
        resourceType ? eq(auditEvents.resourceType, resourceType) : undefined,
        resourceId ? eq(auditEvents.resourceId, resourceId) : undefined,
        fromDate ? gte(auditEvents.timestamp, fromDate) : undefined,
        toDate ? lte(auditEvents.timestamp, toDate) : undefined,
      ].filter(Boolean) as Parameters<typeof and>;

      const rows = await db
        .select()
        .from(auditEvents)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(sql`${auditEvents.timestamp} DESC`)
        .limit(limit)
        .offset(offset);

      return reply.send(rows);
    },
  );
}
