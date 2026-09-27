/**
 * audit-sink.ts — the dashboard's writes leave an attributable record.
 *
 * `audit_events` had no writer anywhere in the repository: the table existed, was
 * indexed, and nothing ever inserted into it. So every write the dashboard performed
 * — approving a quarantine, creating a gate — happened with no record of who did it
 * or when, and the table could be deleted without losing a byte of history.
 *
 * A quarantine decision in particular is a *claim*: approving one removes a test
 * from the pass rate, which changes whether a release looks green. That is exactly
 * the kind of change that has to be answerable later, and "who approved this, and
 * on what grounds" is the question the table was there to answer.
 *
 * The Postgres-backed stores write their audit row inside the same transaction as
 * the domain write, because a domain change without its record is the failure this
 * exists to prevent — and a separate call would make the two independently
 * failable. The in-memory stores have no transaction to join, so they use the
 * {@link AuditSink} port below, which is also what lets a test assert the record
 * without a database. A source-text assertion would not: it would pass against a
 * store built by a helper.
 */
import { auditEvents } from '@automate/db';

/**
 * Who a write is attributed to, resolved once by the route and passed down.
 *
 * A `WriteContext` is required by every mutating store method rather than optional
 * context threaded through an options bag, so a new write path cannot forget to
 * attribute itself: the parameter is not there, and the compiler says so.
 */
export interface WriteContext {
  actorId: string;
  actorType: 'user' | 'system' | 'service';
  workspaceId?: string | null;
  requestId?: string | null;
}

export interface AuditEntry extends WriteContext {
  /** What happened, in the past tense: `quarantine.approved`. */
  action: string;
  resourceType: string;
  resourceId: string;
  /**
   * Who did it.
   *
   * `'anonymous'` is a real value, not a placeholder: it is what an unauthenticated
   * dashboard write records, and it is deliberately distinguishable from a session
   * that failed to resolve. A row claiming a user that was never identified would
   * be worse than one admitting nobody was.
   */
  details?: Record<string, unknown> | null;
}

export interface AuditSink {
  record(entry: AuditEntry): Promise<void>;
}

/** Keeps entries in memory. Used by the in-memory stores and by tests. */
export class InMemoryAuditSink implements AuditSink {
  readonly entries: AuditEntry[] = [];

  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

/**
 * The row `audit_events` wants, from an entry.
 *
 * Both `timestamp` and `createdAt` are `NOT NULL` with no database default, so both
 * are set from one `now`. Two clocks reading a few milliseconds apart would make
 * "what happened first" unanswerable from the row alone.
 */
export function auditRow(entry: AuditEntry, now: Date): typeof auditEvents.$inferInsert {
  return {
    timestamp: now,
    createdAt: now,
    actorId: entry.actorId,
    actorType: entry.actorType,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    workspaceId: entry.workspaceId ?? null,
    requestId: entry.requestId ?? null,
    details: entry.details ?? null,
  };
}
