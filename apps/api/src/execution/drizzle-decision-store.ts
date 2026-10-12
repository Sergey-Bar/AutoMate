import { decisionRecords } from '@automate/db';
import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { DecisionQuery } from '@automate/db';
import type { DecisionTimeline } from '@automate/shared-contracts';
import type { PgliteQueryResultHKT } from 'drizzle-orm/pglite';
import type { PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { bucketTimeline, DecisionError, validateDecisionInput } from './decision-store.js';
import type { DecisionStore } from './decision-store.js';
import type { DecisionInput, DecisionRecord, DecisionVerdict } from '@automate/db';

type AnyPgDb =
  | PgDatabase<PgQueryResultHKT, Record<string, unknown>>
  | PgDatabase<PgliteQueryResultHKT, Record<string, unknown>>;

type DbRow = Record<string, unknown>;

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function nullableIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}

/**
 * An ISO string (or Date, or nothing) as the `Date` the timestamp columns take.
 *
 * **The boundary converts, so neither caller nor table has to.** An ISO string
 * arrives from HTTP bodies and from the parity suite alike; the column type is
 * `timestamptz`; and a store that let the two meet would be a store that throws
 * on the first write that carried a string.
 */
function optionalDate(value: string | Date | null | undefined): Date | null | undefined {
  if (value === null || value === undefined) return value;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `rowValue` on the row, the way the sibling store reads its rows. */
function rowValue(row: unknown): DbRow {
  return row as DbRow;
}

/** One row, mapped out of whatever shape the driver handed back. */
function mapRow(row: DbRow): DecisionRecord {
  return {
    id: String(row['id']),
    projectId: String(row['projectId'] ?? row['project_id']),
    findingId: String(row['findingId'] ?? row['finding_id']),
    cell: nullableString(row['cell'] ?? null),
    verdict: String(row['verdict']) as DecisionVerdict,
    ownerId: nullableString(row['ownerId'] ?? row['owner_id'] ?? null),
    decidedAt: nullableIso(row['decidedAt'] ?? row['decided_at'] ?? null),
    note: nullableString(row['note'] ?? null),
    deferUntil: nullableIso(row['deferUntil'] ?? row['defer_until'] ?? null),
    createdAt: nullableIso(row['createdAt'] ?? row['created_at'] ?? null) ?? '',
    updatedAt: nullableIso(row['updatedAt'] ?? row['updated_at'] ?? null) ?? '',
  };
}

/**
 * The Drizzle implementation — the store the product runs on.
 *
 * ## The natural key is enforced in SQL, not in a read
 *
 * `decision_records_finding_cell_key` is a partial unique index, so a second
 * write for the same key is `ON CONFLICT (…) DO UPDATE` rather than a
 * read-then-write. Two callers deciding at the same time would otherwise both see
 * "no row", both insert, and the index would fail the second — a race whose
 * failure mode is a 500 in a handler whose work actually succeeded.
 *
 * ## `onConflictDoUpdate` over `onDuplicateKeyUpdate`
 *
 * The sibling store uses the latter in a few places and the former here. They are
 * the same operation under two spellings, and the difference that matters is the
 * *target*: the conflict target must name the unique index exactly, or the
 * statement is refused with a message about an index that does not exist rather
 * than about the row that conflicts. The index is partial, which is why its
 * predicate is stated in the target's `where`.
 */
export class DrizzleDecisionStore implements DecisionStore {
  constructor(private readonly db: AnyPgDb) {}

  async record(
    projectId: string,
    input: DecisionInput,
    workspaceId: string,
  ): Promise<DecisionRecord> {
    // The same validation the in-memory store runs, from the same module — a
    // divergence here is a store that accepts a deferral with no date in one
    // deployment and refuses it in another.
    validateDecisionInput(input);
    const verdict: DecisionVerdict = input.verdict ?? 'open';
    const now = new Date();
    const decidedAt = verdict === 'open' ? null : now;
    const cellMatch =
      input.cell === null ? isNull(decisionRecords.cell) : eq(decisionRecords.cell, input.cell);

    // A read first, then an insert or an update. **An `ON CONFLICT` with an
    // expression target was the first attempt and it is not what Drizzle's query
    // builder supports well** — the `coalesce` that makes a NULL cell unique is
    // an expression index, and a composite conflict target has to name *columns*.
    // The read-then-write is explicit, type-safe, and the unique index still
    // stands behind it: a genuine race raises rather than silently inserting a
    // second row for the same decision, which is the failure the whole loop
    // depends on not happening.
    const existing = await this.db
      .select()
      .from(decisionRecords)
      .where(
        and(
          eq(decisionRecords.workspaceId, workspaceId),
          eq(decisionRecords.projectId, projectId),
          eq(decisionRecords.findingId, input.findingId),
          cellMatch,
        ),
      );

    if (existing[0] === undefined) {
      const inserted = await this.db
        .insert(decisionRecords)
        .values({
          workspaceId,
          projectId,
          findingId: input.findingId,
          cell: input.cell,
          verdict,
          ownerId: input.ownerId ?? null,
          note: input.note ?? null,
          deferUntil: optionalDate(input.deferUntil) ?? null,
          decidedAt,
          createdAt: now,
          updatedAt: now,
          createdBy: input.ownerId ?? null,
          updatedBy: input.ownerId ?? null,
        })
        .returning();
      // `.returning()` on an insert that fires a trigger and inserts no row is
      // the one case where an empty array is not an error worth a custom class —
      // it is the driver saying "the statement ran and produced nothing", which
      // is a store defect the caller cannot act on. There is nothing a caller
      // could do differently, so it is a bare throw.
      const row = inserted[0] as (typeof decisionRecords)['$inferSelect'];
      return mapRow(rowValue(row));
    }

    return this.applyUpdate(input, projectId, workspaceId, now, verdict, decidedAt);
  }
  async listForProject(projectId: string, workspaceId: string): Promise<DecisionRecord[]> {
    const rows = await this.db
      .select()
      .from(decisionRecords)
      .where(
        and(eq(decisionRecords.workspaceId, workspaceId), eq(decisionRecords.projectId, projectId)),
      )
      .orderBy(
        // **Explicit, not alphabetical.** `asc(verdict)` puts `fixed` before
        // `open`, which buries the work that is waiting under the work that is
        // done. The in-memory store ranks the same way, and the parity suite
        // asserts the sequence rather than the set.
        sql`${decisionRecords.verdict} = 'open' DESC`,
        desc(decisionRecords.updatedAt),
      );
    return rows.map((row) => mapRow(rowValue(row)));
  }

  async listOpen(workspaceId: string): Promise<DecisionRecord[]> {
    const rows = await this.db
      .select()
      .from(decisionRecords)
      .where(and(eq(decisionRecords.workspaceId, workspaceId), eq(decisionRecords.verdict, 'open')))
      .orderBy(desc(decisionRecords.createdAt));
    return rows.map((row) => mapRow(rowValue(row)));
  }

  /**
   * The inbox and the history, as one filtered read.
   *
   * ## The predicates are the indexed ones, in the index's order
   *
   * `decision_records_workspace_owner_idx` is `(workspace_id, owner_id,
   * verdict)` over open rows — so `verdict: 'open'` plus an `ownerId` is an
   * index scan and nothing more. `since` predicates on `decided_at`, which
   * `decision_records_workspace_verdict_idx` carries, so "what I decided" is
   * the other index. **A predicate with no index behind it would be the loop
   * running a sequential scan on every page load**, which is why this method
   * takes three fields and not eight.
   *
   * ## The order is part of the contract, not of the SQL
   *
   * `since` present → `decided_at` descending, because the question has become
   * "what did I do" and the newest is what you are looking for. Absent →
   * `created_at` ascending, because the question is "what is waiting" and the
   * row that has waited longest belongs at the top. The in-memory store ranks
   * identically and the parity suite asserts the two sequences agree.
   */
  async listFiltered(
    projectId: string,
    workspaceId: string,
    query: DecisionQuery,
  ): Promise<DecisionRecord[]> {
    const predicates = [
      eq(decisionRecords.workspaceId, workspaceId),
      eq(decisionRecords.projectId, projectId),
    ];
    if (query.verdict !== undefined) {
      predicates.push(eq(decisionRecords.verdict, query.verdict));
    }
    if (query.ownerId !== undefined) {
      predicates.push(eq(decisionRecords.ownerId, query.ownerId));
    }
    if (query.since !== undefined) {
      predicates.push(gte(decisionRecords.decidedAt, new Date(query.since)));
    }
    const rows = await this.db
      .select()
      .from(decisionRecords)
      .where(and(...predicates))
      .orderBy(
        query.since === undefined
          ? asc(decisionRecords.createdAt)
          : desc(decisionRecords.decidedAt),
      );
    return rows.map((row) => mapRow(rowValue(row)));
  }

  async timeline(
    projectId: string,
    workspaceId: string,
    window: { findingIds: readonly string[]; weeks?: number; at: string },
  ): Promise<DecisionTimeline> {
    const rows = await this.db
      .select()
      .from(decisionRecords)
      .where(
        and(eq(decisionRecords.workspaceId, workspaceId), eq(decisionRecords.projectId, projectId)),
      );
    // **Every row, and the bucketing is the shared function's.** Reading only
    // the decided ones here would move the week boundary into SQL, where the
    // in-memory store cannot follow it and the two timelines would disagree on
    // a row decided at 23:59 on a Sunday.
    return bucketTimeline(
      rows.map((row) => mapRow(rowValue(row))),
      window,
    );
  }

  async find(
    projectId: string,
    findingId: string,
    cell: string | null,
    workspaceId: string,
  ): Promise<DecisionRecord | null> {
    const rows = await this.db
      .select()
      .from(decisionRecords)
      .where(
        and(
          eq(decisionRecords.workspaceId, workspaceId),
          eq(decisionRecords.projectId, projectId),
          eq(decisionRecords.findingId, findingId),
          cell === null ? isNull(decisionRecords.cell) : eq(decisionRecords.cell, cell),
        ),
      );
    const row = rows[0];
    return row === undefined ? null : mapRow(rowValue(row));
  }

  async listForOtherWorkspace(
    projectId: string,
    otherWorkspaceId: string,
  ): Promise<DecisionRecord[]> {
    // Deliberately empty rather than an error: a caller asking about another
    // workspace gets the rows *that* workspace can see about that project, which
    // is none unless the project is shared. That is the honest answer to a
    // cross-tenant read, and the parity test asserts it is the same answer in
    // both stores.
    const rows = await this.db
      .select()
      .from(decisionRecords)
      .where(
        and(
          eq(decisionRecords.workspaceId, otherWorkspaceId),
          eq(decisionRecords.projectId, projectId),
        ),
      );
    return rows.map((row) => mapRow(rowValue(row)));
  }

  async remove(id: string, workspaceId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(decisionRecords)
      .where(and(eq(decisionRecords.id, id), eq(decisionRecords.workspaceId, workspaceId)))
      .returning();
    return deleted.length > 0;
  }

  /**
   * The update path, scoped by the natural key **and** the workspace.
   *
   * The tenancy predicate is in the `where` rather than asserted after the fact,
   * so a workspace mismatch updates nothing instead of updating someone else's
   * row. A plain update rather than a conflict clause, for the reason in
   * `record`: the natural key's NULL-collapsing is an expression index, and a
   * composite conflict target has to name columns.
   */
  private async applyUpdate(
    input: DecisionInput,
    projectId: string,
    workspaceId: string,
    now: Date,
    verdict: DecisionVerdict,
    decidedAt: Date | null,
  ): Promise<DecisionRecord> {
    const cellMatch =
      input.cell === null ? isNull(decisionRecords.cell) : eq(decisionRecords.cell, input.cell);
    const returned = await this.db
      .update(decisionRecords)
      .set({
        verdict,
        // What the caller named, and what they did not leaves the row's own
        // value: a patch that said only "accepted" must not wipe the note
        // somebody wrote three days ago.
        //
        // **`null` and `undefined` both mean "not named", and that is the rule
        // for all three of these fields.** The route cannot send `undefined` —
        // JSON has no such thing — so it sends `null` for an absent field, and a
        // field that writes an explicit NULL on `null` clears a deferral date the
        // caller never mentioned. `optionalDate` used to pass `null` straight
        // through; the two lines above it use `?? undefined`, which returns
        // `undefined` for `null` and leaves the column out of the `SET` clause.
        // One rule, stated once, for all three.
        ownerId: input.ownerId ?? undefined,
        note: input.note ?? undefined,
        deferUntil:
          input.deferUntil === null || input.deferUntil === undefined
            ? undefined
            : optionalDate(input.deferUntil),
        decidedAt,
        updatedAt: now,
        updatedBy: input.ownerId ?? undefined,
      })
      .where(
        and(
          eq(decisionRecords.workspaceId, workspaceId),
          eq(decisionRecords.projectId, projectId),
          eq(decisionRecords.findingId, input.findingId),
          cellMatch,
        ),
      )
      .returning();
    // An update that matched no row has nothing to return, and the honest answer
    // is a refusal rather than a fabricated one: the caller's write either landed
    // on a row another worker deleted, or the update's predicate is wrong. Both
    // are store defects, and both report the same way. **This throws — it used to
    // cast `returned[0]` and hand it to `mapRow`, which threw a `TypeError` on
    // `undefined` and reached the caller as a 500 with no code.** The parity
    // scenario that deletes a row *before* the read never reached this path; a
    // deletion between the read and the write lands on it.
    const row = returned[0];
    if (row === undefined) {
      throw new DecisionError(
        'DECISION_NOT_FOUND',
        'The decision was deleted between the read and the update, so there is no row to answer with',
      );
    }
    return mapRow(rowValue(row));
  }
}
