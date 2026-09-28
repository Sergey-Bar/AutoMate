import { and, asc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { outboxEvents } from '../schema/identity.js';
import type * as schema from '../schema/index.js';

export type OutboxDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;
export type OutboxEvent = typeof outboxEvents.$inferSelect;

export interface AppendOutboxEvent {
  /**
   * Required, and not nullable.
   *
   * Optional-and-nullable is what permitted a row that `readAfter` could never return:
   * the event was written, consumed a sequence number, counted toward the retention
   * floor, and was invisible to every consumer (ledger P-9). Enforced here as well as by
   * `NOT NULL` so the mistake is a compile error rather than a runtime one.
   */
  workspaceId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventVersion?: number;
  payload: Record<string, unknown>;
  dedupeKey: string;
  occurredAt?: Date;
  expiresAt?: Date | null;
}

export interface OutboxReadPage {
  workspaceId: string;
  afterSequence: number;
  limit?: number;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

function pageSize(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(limit)));
}

export class DrizzleOutboxRepository {
  constructor(private readonly db: OutboxDatabase) {}

  async append(event: AppendOutboxEvent): Promise<OutboxEvent | null> {
    const rows = await this.appendMany([event]);
    return rows[0] ?? null;
  }

  async appendMany(events: AppendOutboxEvent[]): Promise<OutboxEvent[]> {
    if (events.length === 0) return [];
    for (const event of events) {
      if (!event.workspaceId || event.workspaceId.trim() === '') {
        throw new Error('An outbox event must name the workspace it belongs to');
      }
      if (!event.dedupeKey || event.dedupeKey.length > 512) {
        throw new Error('Outbox dedupe key must be between 1 and 512 characters');
      }
      if (!event.aggregateType || !event.aggregateId || !event.eventType) {
        throw new Error('Outbox aggregate and event identifiers are required');
      }
    }
    return (
      this.db
        .insert(outboxEvents)
        .values(events.map((event) => ({ ...event, eventId: randomUUID() })))
        // Both columns, because that is what the index is on.
        //
        // `onConflictDoNothing({ target: dedupeKey })` named a single column against a
        // single-column unique index. Once the index became `(workspace_id, dedupe_key)`
        // that target no longer matched it, and the two drifting apart is precisely the
        // failure this fixes — so the target and the index are named in one place and the
        // comment says why they must move together.
        .onConflictDoNothing({ target: [outboxEvents.workspaceId, outboxEvents.dedupeKey] })
        .returning()
    );
  }

  async readAfter({ workspaceId, afterSequence, limit }: OutboxReadPage): Promise<OutboxEvent[]> {
    return this.db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.workspaceId, workspaceId),
          gt(outboxEvents.sequence, afterSequence),
          or(isNull(outboxEvents.expiresAt), gt(outboxEvents.expiresAt, new Date())),
        ),
      )
      .orderBy(asc(outboxEvents.sequence))
      .limit(pageSize(limit));
  }

  async purgeExpired(now = new Date()): Promise<number> {
    const rows = await this.db
      .delete(outboxEvents)
      .where(lt(outboxEvents.expiresAt, now))
      .returning({ sequence: outboxEvents.sequence });
    return rows.length;
  }

  async getRetentionFloor(workspaceId?: string): Promise<number | null> {
    const rows = await this.db
      .select({ sequence: outboxEvents.sequence })
      .from(outboxEvents)
      .where(
        and(
          workspaceId ? eq(outboxEvents.workspaceId, workspaceId) : undefined,
          or(isNull(outboxEvents.expiresAt), gt(outboxEvents.expiresAt, new Date())),
        ),
      )
      .orderBy(asc(outboxEvents.sequence))
      .limit(1);

    return rows[0]?.sequence ?? null;
  }
}
