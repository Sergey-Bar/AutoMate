import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { traceLinks } from '../db/schema.js';
import type { TraceLink, NewTraceLink } from '../db/schema.js';

export async function createTraceLink(
  link: Omit<NewTraceLink, 'id' | 'createdAt'>,
): Promise<TraceLink> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const row: NewTraceLink = { ...link, id, createdAt };
  await db.insert(traceLinks).values(row);
  return row as TraceLink;
}

export async function getTraceLinks(
  sourceType: string,
  sourceId: string,
): Promise<TraceLink[]> {
  return db
    .select()
    .from(traceLinks)
    .where(and(eq(traceLinks.sourceType, sourceType), eq(traceLinks.sourceId, sourceId)));
}

export async function getBacktraceLinks(
  targetType: string,
  targetId: string,
): Promise<TraceLink[]> {
  return db
    .select()
    .from(traceLinks)
    .where(and(eq(traceLinks.targetType, targetType), eq(traceLinks.targetId, targetId)));
}

export async function deleteTraceLink(id: string): Promise<void> {
  await db.delete(traceLinks).where(eq(traceLinks.id, id));
}
