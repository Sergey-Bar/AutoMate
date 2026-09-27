/**
 * drizzle-stores.ts — the dashboard's Postgres-backed stores.
 *
 * Three defects lived here, and all three were the same mistake: a field written
 * into, and read back out of, a column that meant something else.
 *
 * 1. `add()` stored a quality gate's **display name** in `workspace_id`, and
 *    `list()`/`get()` read the name back out of it. Every gate was therefore scoped
 *    to a workspace that does not exist, and the column that decides visibility
 *    carried a free-text label. Migration 0012 added a real `name` column and
 *    recovered the names it had swallowed.
 * 2. `list()` filtered the `global` row out with `ne(id, 'global')`. On a fresh
 *    install the default gate config is the *only* row, so the dashboard reported
 *    no gates at all. Hiding the row a threshold falls back to is how a configured
 *    threshold becomes an invisible one, so the row is listed.
 * 3. A quarantine entry had no way to change state. It entered `pending` (the
 *    fail-closed default, so a fresh quarantine does not hide a test from the pass
 *    rate before a human decides) and stayed there forever — the only reachable
 *    state was the one that excludes nothing. `resolve()` adds the transition, with
 *    the rule stated once in `schemas.ts` and an audit row for the decision.
 */

import { auditEvents, qualityGateConfig, quarantine } from '@automate/db';
import { and, asc, eq } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { PgliteQueryResultHKT } from 'drizzle-orm/pglite';
import { randomUUID } from 'node:crypto';
import type { QualityGate, QualityGateStore } from './quality-gates.js';
import type { QuarantineEntry, QuarantineStore } from './quarantine.js';
import {
  canTransitionQuarantine,
  type QuarantineStatus,
  type ResolveQuarantineBody,
} from './schemas.js';
import { auditRow, type WriteContext } from './audit-sink.js';

type AnyPgDb =
  | PgDatabase<PgQueryResultHKT, Record<string, unknown>>
  | PgDatabase<PgliteQueryResultHKT, Record<string, unknown>>;

function systemContext(): Required<Pick<WriteContext, 'actorId' | 'actorType'>> {
  return { actorId: 'system', actorType: 'system' };
}

function mapGate(row: typeof qualityGateConfig.$inferSelect): QualityGate {
  return {
    id: row.id,
    // Read from `name`, which is the column that holds a name. The previous
    // `row.workspaceId ?? 'Unnamed gate'` returned a workspace identifier under the
    // heading "name" for every gate that was properly scoped, and the gate's own
    // name for every gate that was not.
    name: row.name,
    passRateThreshold: row.passRateThreshold,
    createdAt: row.updatedAt.toISOString(),
  };
}

export class DrizzleQualityGateStore implements QualityGateStore {
  constructor(private readonly db: AnyPgDb) {}

  async list(): Promise<QualityGate[]> {
    const rows = await this.db
      .select()
      .from(qualityGateConfig)
      .orderBy(asc(qualityGateConfig.updatedAt));
    // Every row, including `global`. The previous `.where(ne(id, 'global'))` made a
    // fresh install — where that row is the only one — report an empty list, so an
    // operator could not see the threshold their evaluations were actually using.
    return rows.map(mapGate);
  }

  async add(
    gate: Omit<QualityGate, 'id' | 'createdAt'>,
    context: WriteContext = systemContext(),
  ): Promise<QualityGate> {
    const id = randomUUID();
    const now = new Date();
    // The gate row and its audit row are written together. A gate nobody can account
    // for is the failure the audit table exists to prevent, so recording it
    // separately — or not at all — would be the same as not recording it.
    await this.db.transaction(async (tx) => {
      await tx.insert(qualityGateConfig).values({
        id,
        // `workspaceId` is left unset deliberately. It scopes the row; a gate the
        // dashboard created is not scoped to a workspace, and writing a name here is
        // the defect this file exists to undo.
        name: gate.name,
        passRateThreshold: gate.passRateThreshold,
        updatedAt: now,
      });
      await tx.insert(auditEvents).values(
        auditRow(
          {
            action: 'quality_gate.created',
            resourceType: 'quality_gate',
            resourceId: id,
            ...context,
            details: { name: gate.name, passRateThreshold: gate.passRateThreshold },
          },
          now,
        ),
      );
    });

    return {
      id,
      name: gate.name,
      passRateThreshold: gate.passRateThreshold,
      createdAt: now.toISOString(),
    };
  }

  async get(id: string): Promise<QualityGate | null> {
    const rows = await this.db
      .select()
      .from(qualityGateConfig)
      .where(eq(qualityGateConfig.id, id))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return mapGate(row);
  }
}

function mapEntry(row: typeof quarantine.$inferSelect): QuarantineEntry {
  return {
    id: row.id,
    testTitle: row.testTitle,
    testFile: row.testFile,
    reason: row.reason ?? null,
    quarantinedAt: row.quarantinedAt.toISOString(),
    status: row.status,
  };
}

/** What a resolve attempt did, so the route can answer each case differently. */
export type ResolveQuarantineOutcome =
  | { kind: 'resolved'; entry: QuarantineEntry }
  | { kind: 'not_found' }
  | { kind: 'illegal_transition'; from: QuarantineStatus; to: QuarantineStatus };

export class DrizzleQuarantineStore implements QuarantineStore {
  constructor(private readonly db: AnyPgDb) {}

  async list(): Promise<QuarantineEntry[]> {
    const rows = await this.db.select().from(quarantine).orderBy(asc(quarantine.quarantinedAt));
    return rows.map(mapEntry);
  }

  async add(
    entry: Omit<QuarantineEntry, 'id' | 'quarantinedAt' | 'status'>,
    context: WriteContext = systemContext(),
  ): Promise<QuarantineEntry> {
    const id = randomUUID();
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.insert(quarantine).values({
        id,
        testTitle: entry.testTitle,
        testFile: entry.testFile,
        reason: entry.reason ?? null,
        quarantinedAt: now,
        // Explicit rather than relying on the column default, so the value returned
        // here is the value asked for. The default is `pending` — the fail-closed
        // state — and stating it means a change to the column default cannot quietly
        // make a fresh quarantine exclude a test.
        status: 'pending',
      });
      await tx.insert(auditEvents).values(
        auditRow(
          {
            action: 'quarantine.created',
            resourceType: 'quarantine_entry',
            resourceId: id,
            ...context,
            details: { testTitle: entry.testTitle, testFile: entry.testFile },
          },
          now,
        ),
      );
    });
    return {
      id,
      testTitle: entry.testTitle,
      testFile: entry.testFile,
      reason: entry.reason ?? null,
      quarantinedAt: now.toISOString(),
      status: 'pending',
    };
  }

  async remove(id: string, context: WriteContext = systemContext()): Promise<boolean> {
    // Delete and record together. A removed entry whose removal is unrecorded is a
    // test that silently reappears in the pass rate with nobody having decided
    // anything — the exact shape the audit table exists to rule out.
    const removed = await this.db.transaction(async (tx) => {
      const rows = await tx
        .delete(quarantine)
        .where(eq(quarantine.id, id))
        .returning({ id: quarantine.id });
      if (rows.length === 0) return false;
      const now = new Date();
      await tx.insert(auditEvents).values(
        auditRow(
          {
            action: 'quarantine.removed',
            resourceType: 'quarantine_entry',
            resourceId: id,
            ...context,
            details: null,
          },
          now,
        ),
      );
      return true;
    });
    return removed;
  }

  /**
   * Moves an entry out of `pending`, with a reason, and records the decision.
   *
   * The guard is `canTransitionQuarantine`, checked against the status **read from
   * the row** rather than against something the caller supplied: a caller-supplied
   * `from` would be a second claim about the state, and the two could disagree.
   *
   * `resolved_at` is set with the status because the database CHECK ties a
   * time-to-fix to a resolution, and a resolution with no timestamp would be the
   * same claim in the other direction. `reason` is left alone: it says why the test
   * was quarantined, which the resolution does not replace.
   */
  async resolve(
    id: string,
    body: ResolveQuarantineBody,
    context: WriteContext = systemContext(),
  ): Promise<ResolveQuarantineOutcome> {
    const existing = await this.db.select().from(quarantine).where(eq(quarantine.id, id)).limit(1);
    const row = existing[0];
    if (row === undefined) return { kind: 'not_found' };
    const from = row.status;
    if (!canTransitionQuarantine(from, body.status)) {
      return { kind: 'illegal_transition', from, to: body.status };
    }
    if (from === body.status) {
      // Idempotent: already in the requested state. Returned without a write, so a
      // retried request does not append a second audit row claiming a decision that
      // only happened once.
      return { kind: 'resolved', entry: mapEntry(row) };
    }
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(quarantine)
        .set({
          status: body.status,
          resolutionType: body.resolutionType ?? null,
          resolvedAt: now,
        })
        .where(and(eq(quarantine.id, id), eq(quarantine.status, from)));
      await tx.insert(auditEvents).values(
        auditRow(
          {
            action: `quarantine.${body.status}`,
            resourceType: 'quarantine_entry',
            resourceId: id,
            ...context,
            details: { from, to: body.status, resolution: body.resolution },
          },
          now,
        ),
      );
    });
    return { kind: 'resolved', entry: { ...mapEntry(row), status: body.status } };
  }
}
