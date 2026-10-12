import type { DecisionInput, DecisionQuery, DecisionRecord, DecisionVerdict } from '@automate/db';
import type { DecisionTimeline } from '@automate/shared-contracts';
import { bucketTimeline, validateDecisionInput } from './decision-store.js';
import type { DecisionStore } from './decision-store.js';

/**
 * The row as this store keeps it: the decision, plus the two things a wire
 * response must not carry — the tenancy column and the insertion order.
 *
 * Both are stripped together in one place, because a screen that learned either
 * of them would start filtering on it, which is the second authority in the
 * place it is hardest to find.
 */
type DecisionRow = DecisionRecord & { workspaceId: string; sequence: number };

/**
 * The in-memory implementation — the store a test runs, and the one the API uses
 * before a database is configured.
 *
 * **The two stores are two implementations of one rule, and the parity suite is
 * what proves it.** Every behaviour below is expressed as the rule rather than as
 * a convenience: the natural key is unique, the default verdict is `open`, a
 * deferral with no date is refused, and a workspace mismatch is invisible. The
 * Drizzle store enforces the same four in SQL. Where they could differ — the
 * refusal, the default, the key — they call the same `validateDecisionInput`, so
 * the vocabulary lives in exactly one place.
 *
 * `Map` keyed on the natural key, and the key is *composed* rather than hashed
 * from an object: `findingId \u0000 cell` is stable across a process where
 * `JSON.stringify` of the same row would not be (key order), which is how "the
 * same finding" silently becomes "a second row" in a store that two processes
 * share.
 */
export class InMemoryDecisionStore implements DecisionStore {
  private readonly rows = new Map<string, DecisionRow>();
  private counter = 0;

  /** The natural key, composed so two rows of the same decision are one row. */
  private static key(
    workspaceId: string,
    projectId: string,
    findingId: string,
    cell: string | null,
  ): string {
    return [workspaceId, projectId, findingId, cell ?? '\u0000'].join('\u0000');
  }

  /** The rows this workspace can see about one project, in insertion order. */
  private mine(projectId: string, workspaceId: string): DecisionRow[] {
    return [...this.rows.values()].filter(
      (row) => row.workspaceId === workspaceId && row.projectId === projectId,
    );
  }

  async record(
    projectId: string,
    input: DecisionInput,
    workspaceId: string,
  ): Promise<DecisionRecord> {
    validateDecisionInput(input);
    const verdict: DecisionVerdict = input.verdict ?? 'open';
    const key = InMemoryDecisionStore.key(workspaceId, projectId, input.findingId, input.cell);
    const existing = this.rows.get(key);
    const now = new Date().toISOString();

    if (existing !== undefined) {
      // **The verdict replaces, and the fields the caller omitted are kept.** A
      // patch that said only "accepted" must not wipe the note somebody wrote
      // three days ago; the in-memory store and the SQL store both read the
      // previous row and keep what was not named, which is the same rule the
      // profile merge follows.
      const updated: DecisionRow = {
        ...existing,
        verdict,
        ownerId: input.ownerId ?? existing.ownerId,
        note: input.note ?? existing.note,
        deferUntil: input.deferUntil ?? existing.deferUntil,
        // **An `open` row has no decision time, whichever way it got there.**
        // `accepted → open` used to stamp `now`, because the condition tested
        // only *whether* the verdict changed — so a row re-recorded back to
        // `open` (which is what a body with no `verdict` does) came back with a
        // decision time nobody decided in, and `listFiltered({ since })` then
        // listed it as a verdict. The SQL store has written `null` for the open
        // case all along, at `drizzle-decision-store.ts:97`.
        decidedAt:
          verdict === 'open' ? null : verdict === existing.verdict ? existing.decidedAt : now,
        updatedAt: now,
      };
      this.rows.set(key, updated);
      return strip(updated);
    }

    this.counter += 1;
    const row: DecisionRow = {
      id: `decision-${String(this.counter)}`,
      projectId,
      findingId: input.findingId,
      cell: input.cell,
      verdict,
      ownerId: input.ownerId ?? null,
      // An `open` row has no decision time: nobody has decided it yet. Writing
      // the record time as the decision time is how "seen" becomes "decided",
      // which is the queue lying about its own contents.
      decidedAt: verdict === 'open' ? null : now,
      note: input.note ?? null,
      deferUntil: input.deferUntil ?? null,
      createdAt: now,
      updatedAt: now,
      workspaceId,
      // The insertion order, kept so a sort has a tie-break the SQL store gets
      // for free. `toISOString()` is millisecond-precision, so two verdicts
      // recorded in the same millisecond would otherwise tie — and a tie broken
      // by map order is an order that changes when an unrelated row is written
      // first. The Drizzle store's `timestamptz` column stores microseconds, so
      // its own clock separates them; this is the in-memory equivalent, and it
      // is what lets the parity suite assert an exact sequence.
      sequence: this.counter,
    };
    this.rows.set(key, row);
    return strip(row);
  }

  async listForProject(projectId: string, workspaceId: string): Promise<DecisionRecord[]> {
    return this.mine(projectId, workspaceId)
      .sort((left, right) => {
        const rank = (verdict: string): number => (verdict === 'open' ? 0 : 1);
        if (rank(left.verdict) !== rank(right.verdict)) {
          return rank(left.verdict) - rank(right.verdict);
        }
        const byRecency = right.updatedAt.localeCompare(left.updatedAt);
        return byRecency === 0 ? right.sequence - left.sequence : byRecency;
      })
      .map(strip);
  }

  /**
   * The inbox and the history, ranked by the same rule the SQL store uses.
   *
   * **The direction is the question, and it flips on `since`.** With a `since`
   * the caller is asking "what did I decide", which reads newest first; without
   * one they are asking "what is waiting on me", which reads oldest first — the
   * row that has waited longest is the one a team should see at the top, and a
   * queue ordered by recency buries it under whatever was touched last.
   */
  async listFiltered(
    projectId: string,
    workspaceId: string,
    query: DecisionQuery,
  ): Promise<DecisionRecord[]> {
    const since = query.since === undefined ? Number.NaN : Date.parse(query.since);
    const rows = this.mine(projectId, workspaceId).filter((row) => {
      if (query.verdict !== undefined && row.verdict !== query.verdict) return false;
      if (query.ownerId !== undefined && row.ownerId !== query.ownerId) return false;
      if (query.since !== undefined) {
        if (row.decidedAt === null) return false;
        const at = Date.parse(row.decidedAt);
        if (!Number.isFinite(at) || !Number.isFinite(since) || at < since) return false;
      }
      return true;
    });
    if (query.since !== undefined) {
      rows.sort((left, right) => {
        const byDecision = (right.decidedAt ?? '').localeCompare(left.decidedAt ?? '');
        return byDecision === 0 ? right.sequence - left.sequence : byDecision;
      });
      return rows.map(strip);
    }
    rows.sort((left, right) => {
      const byAge = left.createdAt.localeCompare(right.createdAt);
      return byAge === 0 ? left.sequence - right.sequence : byAge;
    });
    return rows.map(strip);
  }

  async timeline(
    projectId: string,
    workspaceId: string,
    window: { findingIds: readonly string[]; weeks?: number; at: string },
  ): Promise<DecisionTimeline> {
    // Every row of the project, and the bucketing is the shared function's — the
    // same one the Drizzle store calls, which is what makes the two timelines
    // the same object rather than two plausible ones.
    return bucketTimeline(this.mine(projectId, workspaceId).map(strip), window);
  }

  async listOpen(workspaceId: string): Promise<DecisionRecord[]> {
    return [...this.rows.values()]
      .filter((row) => row.workspaceId === workspaceId && row.verdict === 'open')
      .sort((left, right) => {
        const byRecency = right.createdAt.localeCompare(left.createdAt);
        return byRecency === 0 ? right.sequence - left.sequence : byRecency;
      })
      .map(strip);
  }

  async find(
    projectId: string,
    findingId: string,
    cell: string | null,
    workspaceId: string,
  ): Promise<DecisionRecord | null> {
    const row = this.rows.get(InMemoryDecisionStore.key(workspaceId, projectId, findingId, cell));
    return row === undefined ? null : strip(row);
  }

  async listForOtherWorkspace(
    projectId: string,
    otherWorkspaceId: string,
  ): Promise<DecisionRecord[]> {
    // The honest answer to a cross-tenant read, and the parity test asserts the
    // Drizzle store gives the same one.
    return [...this.rows.values()]
      .filter((row) => row.workspaceId === otherWorkspaceId && row.projectId === projectId)
      .map(strip);
  }

  async remove(id: string, workspaceId: string): Promise<boolean> {
    for (const [key, row] of this.rows) {
      if (row.id === id && row.workspaceId === workspaceId) {
        this.rows.delete(key);
        return true;
      }
    }
    return false;
  }
}

/**
 * The row without its tenancy column and without its insertion order.
 *
 * A screen renders a verdict about a finding; the workspace is what scoped the
 * query, not part of the answer. Stripping here rather than in every caller is
 * what keeps a screen from learning the tenancy boundary exists and filtering on
 * it itself — the second authority, in the place it is hardest to find.
 */
function strip(row: DecisionRow): DecisionRecord {
  const { workspaceId: _workspaceId, sequence: _sequence, ...rest } = row;
  return rest;
}
