/**
 * audit.ts — Fire-and-forget audit event persistence.
 *
 * logAuditEvent() inserts a row into audit_events and returns immediately.
 * Errors are logged but never thrown — audit writes MUST NOT block requests.
 *
 * Feature flag 'audit-trail' gates the data collection. When OFF, logAuditEvent
 * is a no-op (so it is safe to call unconditionally from instrumented paths).
 */
import { randomUUID } from 'node:crypto';
import { db } from '../db/client.js';
import { auditEvents } from '../db/schema.js';
import { isEnabled } from './feature-flags.js';

export interface AuditEventInput {
  actorId: string;
  actorType?: 'user' | 'system' | 'service';
  action: string;
  resourceType?: string;
  resourceId?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  details?: Record<string, unknown>;
  tenantId?: string;
}

/**
 * Persist an audit event asynchronously.
 * Always fire-and-forget — the returned Promise is intentionally not awaited
 * by callers. Errors are caught and logged; the calling request is unaffected.
 */
export function logAuditEvent(input: AuditEventInput): void {
  if (!isEnabled('audit-trail')) return;

  const now = new Date().toISOString();

  // Intentionally not awaited — this is a fire-and-forget write.
  db.insert(auditEvents)
    .values({
      id: randomUUID(),
      timestamp: now,
      actorId: input.actorId,
      actorType: input.actorType ?? 'user',
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      requestId: input.requestId ?? null,
      details: input.details ? JSON.stringify(input.details) : null,
      tenantId: input.tenantId ?? null,
      createdAt: now,
    })
    .then(() => { /* success — no-op */ })
    .catch((err: unknown) => {
      // Log error but do NOT propagate — audit must never break the request
      console.error('[audit] Failed to write audit event:', (err as Error).message ?? String(err));
    });
}
