/**
 * quarantine.ts — the quarantine store, its routes, and the decision they record.
 *
 * The write paths validate with Zod rather than hand-rolled field checks, and every
 * mutation is attributed. See `schemas.ts` for why the body handling changed, and
 * `audit-sink.ts` for why an approval leaves a record.
 */

import { Hono } from 'hono';
import { DomainError } from '../../errors/domain-error.js';
import { randomUUID } from 'node:crypto';
import type { ResolveQuarantineOutcome } from './drizzle-stores.js';
import { InMemoryAuditSink, type AuditEntry, type WriteContext } from './audit-sink.js';
import {
  canTransitionQuarantine,
  QUARANTINE_STATUSES,
  type QuarantineStatus,
  type ResolveQuarantineBody,
} from './schemas.js';
import { AddQuarantineEntryBodySchema, ResolveQuarantineBodySchema } from './schemas.js';
import { currentRequestId } from '../../observability/request-context.js';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface QuarantineEntry {
  id: string;
  testTitle: string;
  testFile: string;
  reason: string | null;
  quarantinedAt: string; // ISO-8601
  /**
   * Where the entry stands.
   *
   * `pending` is the fail-closed default: a test that has been quarantined but not
   * yet decided on still counts in the pass rate, because nobody has yet claimed it
   * does not count. `approved` is the claim — it removes the test — so it is only
   * reachable through a decision that records who made it and why.
   */
  status: QuarantineStatus;
}

/** A quarantine entry as it arrives from a caller: no id, no timestamp, no status. */
export type NewQuarantineEntry = Omit<QuarantineEntry, 'id' | 'quarantinedAt' | 'status'>;

// ---------------------------------------------------------------------------
// Store interface + in-memory implementation
// ---------------------------------------------------------------------------

export interface QuarantineStore {
  list(): Promise<QuarantineEntry[]>;
  add(entry: NewQuarantineEntry, context?: WriteContext): Promise<QuarantineEntry>;
  remove(id: string, context?: WriteContext): Promise<boolean>;
  resolve(
    id: string,
    body: ResolveQuarantineBody,
    context?: WriteContext,
  ): Promise<ResolveQuarantineOutcome>;
}

/**
 * In-memory (transient) implementation of QuarantineStore.
 *
 * Enforces the same transition rule as the Postgres store and records the same
 * audit entry, so a test against this store and a test against that one cannot
 * disagree about what a valid decision is. The rule is imported from `schemas.ts`
 * rather than restated: a second copy is a second answer.
 */
export class InMemoryQuarantineStore implements QuarantineStore {
  private readonly _entries = new Map<string, QuarantineEntry>();

  constructor(private readonly audit: InMemoryAuditSink = new InMemoryAuditSink()) {}

  /** The decisions this store recorded. Read by tests to assert attribution. */
  get recorded(): readonly AuditEntry[] {
    return this.audit.entries;
  }

  async list(): Promise<QuarantineEntry[]> {
    return Array.from(this._entries.values());
  }

  async add(entry: NewQuarantineEntry, context?: WriteContext): Promise<QuarantineEntry> {
    const id = randomUUID();
    const created: QuarantineEntry = {
      ...entry,
      id,
      quarantinedAt: new Date().toISOString(),
      status: 'pending',
    };
    this._entries.set(id, created);
    await this.audit.record({
      action: 'quarantine.created',
      resourceType: 'quarantine_entry',
      resourceId: id,
      ...(context ?? { actorId: 'system', actorType: 'system' as const }),
      details: { testTitle: entry.testTitle, testFile: entry.testFile },
    });
    return created;
  }

  async remove(id: string, context?: WriteContext): Promise<boolean> {
    const removed = this._entries.delete(id);
    if (removed) {
      await this.audit.record({
        action: 'quarantine.removed',
        resourceType: 'quarantine_entry',
        resourceId: id,
        ...(context ?? { actorId: 'system', actorType: 'system' as const }),
        details: null,
      });
    }
    return removed;
  }

  async resolve(
    id: string,
    body: ResolveQuarantineBody,
    context?: WriteContext,
  ): Promise<ResolveQuarantineOutcome> {
    const row = this._entries.get(id);
    if (row === undefined) return { kind: 'not_found' };
    const from = row.status;
    if (!canTransitionQuarantine(from, body.status)) {
      return { kind: 'illegal_transition', from, to: body.status };
    }
    if (from === body.status) return { kind: 'resolved', entry: { ...row } };
    const resolved: QuarantineEntry = {
      ...row,
      status: body.status,
    };
    this._entries.set(id, resolved);
    await this.audit.record({
      action: `quarantine.${body.status}`,
      resourceType: 'quarantine_entry',
      resourceId: id,
      ...(context ?? { actorId: 'system', actorType: 'system' as const }),
      details: { from, to: body.status, resolution: body.resolution },
    });
    return { kind: 'resolved', entry: resolved };
  }
}

// ---------------------------------------------------------------------------
// Options + route factory
// ---------------------------------------------------------------------------

export interface DashboardQuarantineOptions {
  store: QuarantineStore;
  /**
   * Who to attribute writes to.
   *
   * Defaults to `'anonymous'`, which is what an unauthenticated dashboard write
   * *is*. It is a recorded value rather than an omission: a decision nobody is
   * credited for is answerable ("nobody"), whereas a row naming a session that
   * never existed is not.
   */
  contextFor?: (c: { req: { header(name: string): string | undefined } }) => WriteContext;
}

/**
 * The audit context for a write with no authenticated principal.
 *
 * The request is not an input: the id comes from the request context, so there is
 * nothing here for a caller to supply and nothing that can disagree (ledger O-1b).
 * Outside a request — a test, a background job — the id is absent rather than
 * invented, because a fabricated correlatable-looking id in an audit row is worse than
 * a missing one.
 */
function defaultContext(): WriteContext {
  return {
    actorId: 'anonymous',
    actorType: 'user',
    requestId: currentRequestId() ?? null,
  };
}

/**
 * Reads a body that may be absent, and reports why it was rejected.
 *
 * `c.req.json()` **throws** on an empty or malformed body, and the throw used to
 * escape the handler — so `POST` with no body produced an unhandled rejection that
 * the error boundary rendered as a 500, identical to a genuine fault, and the
 * validation below never ran. `.catch(() => null)` turns that into the ordinary
 * "invalid body" answer, and a `null` body is a body that failed to parse rather
 * than a body that happened to be absent.
 */
async function readBody(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  return c.req.json().catch(() => null);
}

export function createDashboardQuarantineRoutes(options: DashboardQuarantineOptions): Hono {
  const app = new Hono();
  const contextFor = options.contextFor ?? defaultContext;

  // ── GET /api/v1/dashboard/quarantine ─────────────────────────────────────
  app.get('/api/v1/dashboard/quarantine', async (c) => {
    const entries = await options.store.list();
    return c.json(entries);
  });

  // ── POST /api/v1/dashboard/quarantine ────────────────────────────────────
  app.post('/api/v1/dashboard/quarantine', async (c) => {
    const parsed = AddQuarantineEntryBodySchema.safeParse(await readBody(c));
    if (!parsed.success) {
      throw new DomainError('INVALID_QUARANTINE_ENTRY', 'Invalid quarantine entry', {
        details: { issues: parsed.error.issues },
      });
    }

    const entry = await options.store.add(
      {
        testTitle: parsed.data.testTitle,
        testFile: parsed.data.testFile,
        reason: parsed.data.reason ?? null,
      },
      contextFor(c),
    );

    return c.json(entry, 201);
  });

  // ── PATCH /api/v1/dashboard/quarantine/:id ───────────────────────────────
  app.patch('/api/v1/dashboard/quarantine/:id', async (c) => {
    const id = c.req.param('id');
    const parsed = ResolveQuarantineBodySchema.safeParse(await readBody(c));
    if (!parsed.success) {
      throw new DomainError('INVALID_QUARANTINE_DECISION', 'Invalid quarantine decision', {
        details: { issues: parsed.error.issues },
      });
    }
    const outcome = await options.store.resolve(id, parsed.data, contextFor(c));
    if (outcome.kind === 'not_found') {
      throw new DomainError('QUARANTINE_ENTRY_NOT_FOUND', 'Quarantine entry not found');
    }
    if (outcome.kind === 'illegal_transition') {
      // 409, not 400: the request was well formed and the resource exists, but its
      // current state forbids the move. A client can retry this against a different
      // state; it cannot fix it by resending the same body.
      throw new DomainError('INVALID_STATE_TRANSITION', 'Invalid quarantine transition', {
        // `allowed` is the part a client actually needs: the message used to build the
        // two states into a sentence, and a dashboard that wanted to offer the legal
        // moves had to parse it.
        details: {
          from: outcome.from,
          to: outcome.to,
          allowed: QUARANTINE_STATUSES.filter((status) =>
            canTransitionQuarantine(outcome.from, status),
          ),
        },
      });
    }
    return c.json(outcome.entry);
  });

  // ── DELETE /api/v1/dashboard/quarantine/:id ─────────────────────────────
  app.delete('/api/v1/dashboard/quarantine/:id', async (c) => {
    const id = c.req.param('id');
    const removed = await options.store.remove(id, contextFor(c));
    if (!removed) {
      throw new DomainError('QUARANTINE_ENTRY_NOT_FOUND', 'Quarantine entry not found');
    }
    return c.json({ removed: true });
  });

  return app;
}
