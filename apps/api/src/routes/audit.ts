import { Hono } from 'hono';
import { and, asc, desc, eq, gt, isNotNull, lt, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod/v4';
import { auditEvents } from '@automate/db';
import { callerOf, requireRole, type CallerResolver } from '../http/roles.js';
import { audit } from '../services/access-service.js';
import type { ProjectRegistryServiceOptions } from '../services/project-registry-service.js';

/**
 * The audit trail an auditor reads (ADR-014, enterprise). Admin only, and scoped to the
 * workspace on every query.
 *
 * - `GET /api/v1/audit` — newest first, `limit` (1–200) with a `before` cursor on the chain
 *   position, filtered by `action` or `actor`.
 * - `GET /api/v1/audit/export` — every row oldest first, as NDJSON ending with the `head` (the
 *   last row the file holds), or as CSV, which has no head; read a page at a time as the client
 *   takes it, so a long trail is not held in memory. Recording the head somewhere else is what
 *   makes a rewrite of the whole tail visible later.
 * - `GET /api/v1/audit/verify` — `audit_chain_breaks` (`0050_audit_chain.sql`, replaced in
 *   `0052_audit_append_only.sql` to read a chain's first row too): every row edited, missing,
 *   or relinked, and the head.
 */
export interface AuditRouteOptions extends Pick<
  ProjectRegistryServiceOptions,
  'db' | 'workspaceId'
> {
  access: CallerResolver;
}

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().positive().optional(),
  action: z.string().min(1).max(200).optional(),
  actor: z.string().min(1).max(200).optional(),
});

const PAGE = 500;

type Row = typeof auditEvents.$inferSelect;

function view(row: Row) {
  return {
    seq: row.chainSeq,
    timestamp: row.timestamp.toISOString(),
    actorId: row.actorId,
    actorType: row.actorType,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    ip: row.ip,
    userAgent: row.userAgent,
    requestId: row.requestId,
    details: row.details,
    prevHash: row.prevHash,
    hash: row.hash,
  };
}

const CSV_COLUMNS = [
  'seq',
  'timestamp',
  'actor_id',
  'actor_type',
  'action',
  'resource_type',
  'resource_id',
  'ip',
  'user_agent',
  'request_id',
  'details',
  'prev_hash',
  'hash',
] as const;

/** RFC 4180: quote a field holding a comma, a quote or a line break, and double the quotes. */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  // A leading formula character is neutralised so a spreadsheet does not execute a field.
  const safe = /^[=+\-@]/u.test(text) ? `'${text}` : text;
  return /[",\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function csvLine(row: Row): string {
  const v = view(row);
  return [
    v.seq,
    v.timestamp,
    v.actorId,
    v.actorType,
    v.action,
    v.resourceType,
    v.resourceId,
    v.ip,
    v.userAgent,
    v.requestId,
    v.details,
    v.prevHash,
    v.hash,
  ]
    .map(csvField)
    .join(',');
}

/** A chain position and its hash as a head, or `null` when there is no chained row. */
function headOf(
  row: { seq: number | null; hash: string | null } | undefined,
): { seq: number; hash: string } | null {
  if (row === undefined) return null;
  // Destructured: the chain's own hash compared with `null` is not a secret comparison,
  // and the timing rule reads `x.hash === …` as one.
  const { seq, hash } = row;
  return seq === null || hash === null ? null : { seq, hash };
}

export function createAuditRoutes(options: AuditRouteOptions): Hono {
  const app = new Hono();
  const admin = requireRole('admin', options.access);
  const inWorkspace = eq(auditEvents.workspaceId, options.workspaceId);

  const head = async (): Promise<{ seq: number; hash: string } | null> => {
    const [last] = await options.db
      .select({ seq: auditEvents.chainSeq, hash: auditEvents.hash })
      .from(auditEvents)
      .where(and(inWorkspace, isNotNull(auditEvents.chainSeq)))
      .orderBy(desc(auditEvents.chainSeq))
      .limit(1);
    return headOf(last);
  };

  app.get('/api/v1/audit', admin, async (context) => {
    const query = ListQuerySchema.parse(context.req.query());
    const filters: SQL[] = [inWorkspace, isNotNull(auditEvents.chainSeq)];
    if (query.before !== undefined) filters.push(lt(auditEvents.chainSeq, query.before));
    if (query.action !== undefined) filters.push(eq(auditEvents.action, query.action));
    if (query.actor !== undefined) filters.push(eq(auditEvents.actorId, query.actor));
    const rows = await options.db
      .select()
      .from(auditEvents)
      .where(and(...filters))
      .orderBy(desc(auditEvents.chainSeq))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const more = rows.length > query.limit;
    return context.json({
      events: page.map(view),
      next: more ? (page.at(-1)?.chainSeq ?? null) : null,
    });
  });

  app.get('/api/v1/audit/export', admin, async (context) => {
    const format = context.req.query('format') === 'csv' ? 'csv' : 'ndjson';
    // Recorded before the read, so the export names itself: an auditor sees who took a copy.
    await audit(options, {
      actor: (await callerOf(context, options.access)).actor,
      action: 'audit.export',
      resourceType: 'audit_trail',
      resourceId: options.workspaceId,
      details: { format },
    });
    const encoder = new TextEncoder();
    const db = options.db;
    const line = (row: Row) => `${format === 'csv' ? csvLine(row) : JSON.stringify(view(row))}\n`;
    // The position the next page starts after, and the last row streamed. The head the file
    // ends with is that row, so it can only name a row the file holds: a separate read of the
    // head after the last page could name a row written since, which the file does not have.
    let after = 0;
    let last: Row | undefined;
    const stream = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          if (format === 'csv') controller.enqueue(encoder.encode(`${CSV_COLUMNS.join(',')}\n`));
        },
        // One page per pull. The stream asks for the next page only once the reader has taken
        // the one it holds, so a slow client slows the reads rather than the API holding the
        // trail for it.
        async pull(controller) {
          const rows = await db
            .select()
            .from(auditEvents)
            .where(and(inWorkspace, gt(auditEvents.chainSeq, after)))
            .orderBy(asc(auditEvents.chainSeq))
            .limit(PAGE);
          if (rows.length > 0) controller.enqueue(encoder.encode(rows.map(line).join('')));
          last = rows.at(-1) ?? last;
          const position = rows.at(-1)?.chainSeq;
          if (rows.length === PAGE && position != null) {
            after = position;
            return;
          }
          if (format === 'ndjson') {
            const tail = last === undefined ? undefined : { seq: last.chainSeq, hash: last.hash };
            controller.enqueue(encoder.encode(`${JSON.stringify({ head: headOf(tail) })}\n`));
          }
          controller.close();
        },
      },
      // One page ready ahead of the reader, and no more.
      { highWaterMark: 1 },
    );
    const stamp = new Date().toISOString().replaceAll(':', '').slice(0, 15);
    return new Response(stream, {
      headers: {
        'content-type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson',
        'content-disposition': `attachment; filename="automate-audit-${stamp}.${format === 'csv' ? 'csv' : 'ndjson'}"`,
      },
    });
  });

  app.get('/api/v1/audit/verify', admin, async (context) => {
    const result = await options.db.execute(
      sql`SELECT seq::int AS seq, problem FROM audit_chain_breaks(${options.workspaceId})`,
    );
    const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as Array<{
      seq: number;
      problem: string;
    }>;
    return context.json({
      intact: rows.length === 0,
      breaks: rows.map((row) => ({ seq: Number(row.seq), problem: row.problem })),
      head: await head(),
    });
  });

  return app;
}
