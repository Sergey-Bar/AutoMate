import type { DecisionInput, DecisionQuery, DecisionRecord, DecisionVerdict } from '@automate/db';
import { DECISION_TIMELINE_WEEKS, DECISION_VERDICTS } from '@automate/db';
import type { DecisionTimeline } from '@automate/shared-contracts';

/**
 * The decision store: where a human's verdict about a derived finding lives.
 *
 * ## Why this is its own store and not a table on `quarantine`
 *
 * The quarantine has a verdict, and that is precisely the problem: one derived
 * finding can be decided and the other six cannot, which makes the six
 * dashboards. The unit here is (finding, cell) — the identity of the *decision* —
 * so a verdict on one test never silently covers another with the same rule.
 *
 * ## What the two implementations must agree on
 *
 * Four things, and each is a place a divergence would be invisible until it
 * mattered:
 *
 * 1. **The natural key.** `(workspaceId, projectId, findingId, cell)` is unique,
 *    and a second write for the same key *updates* rather than inserts. A store
 *    that inserted would make the loop's "what did I decide" return the first
 *    answer forever, which is the ledger's `P-20` failure in miniature.
 * 2. **The default verdict.** `open`, and not `accepted`: a record that starts
 *    accepted excludes something from reporting with nobody deciding that — the
 *    same fails-closed default migration 0024 gave `quality_gate_config`.
 * 3. **The deferral rule.** `deferred` without `defer_until` is refused in the
 *    database and refused here, so the two cannot disagree about what a
 *    deferral means.
 * 4. **The order a filtered list comes back in.** The inbox reads oldest first
 *    and the history reads newest first, and a store that returned the other
 *    order would answer a different question than the one asked — so the rule
 *    is stated on `listFiltered` and asserted as a *sequence* in the parity
 *    suite, and the timeline's bucketing is one shared function both call.
 */
export interface DecisionStore {
  /**
   * Records a verdict, creating the row if it has none.
   *
   * Returns the row as it now stands, so a caller never has to write and then
   * re-read to learn what it wrote.
   */
  record(projectId: string, input: DecisionInput, workspaceId: string): Promise<DecisionRecord>;

  /** The rows for one project, open first and then by recency. */
  listForProject(projectId: string, workspaceId: string): Promise<DecisionRecord[]>;

  /**
   * The rows matching the predicates — the inbox and the history, one method.
   *
   * **Two questions, one method, and the order is part of the answer.** With a
   * `since` the question is "what did I decide", which reads newest first.
   * Without one it is "what is waiting on me", which reads **oldest first** —
   * the row that has waited longest is the one a team should see at the top,
   * and a queue ordered by recency buries it under whatever was touched last.
   * Both stores rank the same way, and the parity suite asserts the sequence
   * rather than the set, because a list in the wrong order is a screen that
   * answers a different question than the one asked.
   */
  listFiltered(
    projectId: string,
    workspaceId: string,
    query: DecisionQuery,
  ): Promise<DecisionRecord[]>;

  /** Every open row in the workspace — the inbox, and the daily screen. */
  listOpen(workspaceId: string): Promise<DecisionRecord[]>;

  /**
   * The decision timeline: verdicts by week, by owner, and what has none.
   *
   * `window.findingIds` are the ids the **derived** engine produced for this
   * project, passed in because they are data rather than a table. `window.at` is
   * the instant the timeline is read at — threaded in, not stamped, so a test
   * can name the week it asserts on and the route can answer from one clock.
   */
  timeline(
    projectId: string,
    workspaceId: string,
    window: {
      findingIds: readonly string[];
      weeks?: number;
      at: string;
    },
  ): Promise<DecisionTimeline>;

  /** One row by its natural key, or `null` when nobody has decided. */
  find(
    projectId: string,
    findingId: string,
    cell: string | null,
    workspaceId: string,
  ): Promise<DecisionRecord | null>;

  /** The tenancy read, and the parity test's sharpest edge. */
  listForOtherWorkspace(projectId: string, otherWorkspaceId: string): Promise<DecisionRecord[]>;

  /** Deletes one row, so a decision can be un-made when the underlying finding disappears. */
  remove(id: string, workspaceId: string): Promise<boolean>;
}

/** The failure a caller can act on, carrying the rule that refused it. */
export class DecisionError extends Error {
  readonly code:
    | 'INVALID_DEFERRAL'
    | 'INVALID_VERDICT'
    | 'PROJECT_NOT_FOUND'
    | 'DECISION_NOT_FOUND';

  constructor(code: DecisionError['code'], message: string) {
    super(message);
    this.name = 'DecisionError';
    this.code = code;
  }
}

/**
 * The one place the write shape is validated.
 *
 * **Shared by both stores**, because a divergence here is the failure with the
 * worst shape: the Drizzle store refuses a deferral without a date, the in-memory
 * one accepts it, and the first handler to hit the difference is the one that
 * wrote the row a test cannot see.
 */
/**
 * Whether a string is an ISO 8601 instant — the one date shape the wire carries.
 *
 * ## Why the shape is checked rather than left to `Date.parse`
 *
 * `Date.parse` accepts `October 5, 2026`, `2026-10-05`, `5 Oct 2026 09:00` and
 * half a dozen more. A deferral date that parses to midnight when the caller
 * meant an instant is a date the row carries but nobody wrote, and the column is
 * a `timestamptz` while the wire's schema is `z.iso.datetime()` — so the store
 * would happily persist what the contract refuses to describe.
 *
 * ## Why this is a helper and not an inline regex twice
 *
 * The decisions route needs the same predicate for its `since` parameter, and a
 * second copy of a date shape is a second authority about what a date is.
 */
export function isIsoInstant(value: string): boolean {
  // Two tests rather than one pattern: an optional fractional-seconds group
  // inside an optional group is the nested quantifier
  // `security/detect-unsafe-regex` refuses, and the pair says the same thing —
  // a date-time head, and a `Z` or an offset at the end.
  const head = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u.test(value);
  const offset = /(?:Z|[+-]\d{2}:\d{2})$/u.test(value);
  return head && offset && Number.isFinite(Date.parse(value));
}

export function validateDecisionInput(input: DecisionInput): void {
  const verdict: DecisionVerdict = input.verdict ?? 'open';
  // **The vocabulary is the schema's, not a second list here.** This check
  // carried its own literal array of five strings for one wave — a copy that
  // would have kept refusing `wontfix` while the column enum accepted a sixth
  // verdict nobody renders. One list, declared once in `@automate/db`, and both
  // the database constraint and this refusal read it.
  if (!(DECISION_VERDICTS as readonly string[]).includes(verdict)) {
    throw new DecisionError(
      'INVALID_VERDICT',
      `"${verdict}" is not a verdict this product knows. The vocabulary is closed so a ` +
        `screen can render every state: open, accepted, fixed, excluded, deferred.`,
    );
  }
  if (verdict === 'deferred' && (input.deferUntil === null || input.deferUntil === undefined)) {
    throw new DecisionError(
      'INVALID_DEFERRAL',
      'A deferral without a date is "in the future", which is not a removal condition and ' +
        'is how a flake becomes permanent. Give it a date.',
    );
  }
  // **A date the row cannot carry is refused here, in the one place both stores
  // call.** `optionalDate` in the SQL store converts an unparseable string to
  // `null`, which trips the `deferred_needs_date` CHECK constraint as a Postgres
  // error — a 500 with no code — while the in-memory store used to keep the
  // string and hand it to a client whose schema is `z.iso.datetime()`. One
  // refusal at the seam beats two different failures downstream of it.
  if (
    input.deferUntil !== null &&
    input.deferUntil !== undefined &&
    !isIsoInstant(input.deferUntil)
  ) {
    throw new DecisionError(
      'INVALID_DEFERRAL',
      `"${String(input.deferUntil)}" is not an instant. A deferral date is read as an ISO ` +
        `8601 instant (e.g. 2026-10-20T00:00:00.000Z), because the column is a timestamptz ` +
        `and the wire's schema is the same shape.`,
    );
  }
}

/** One week, in the only unit a timeline needs. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The Monday 00:00:00Z of the week an instant falls in, as epoch milliseconds. */
function weekStartMs(instant: Date): number {
  // `getUTCDay()` is 0 for Sunday. Shifting by six makes Monday the first day
  // without a branch per day, and UTC rather than local because a week boundary
  // that moves with the server's timezone is a boundary two installs disagree on.
  const daysSinceMonday = (instant.getUTCDay() + 6) % 7;
  return Date.UTC(
    instant.getUTCFullYear(),
    instant.getUTCMonth(),
    instant.getUTCDate() - daysSinceMonday,
  );
}

/** A week start, as the `YYYY-MM-DD` key the wire carries. */
function weekKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The timeline's arithmetic, in one place, shared by both stores.
 *
 * ## Why this is a function in the interface's module and not two copies
 *
 * Bucketing is where the two stores would diverge first and visibly last: one
 * counting by `createdAt` (a row's birth) and the other by `decidedAt` (a
 * verdict) produces two timelines that agree on every row and disagree on
 * every chart. So the stores read their rows and hand them here, and the
 * parity suite asserts the two implementations return **the same object** —
 * which is a stronger claim than each returning a plausible one.
 *
 * ## The rules, stated once
 *
 * 1. **A week is Monday-anchored, in UTC.** Not Sunday, not the server's
 *    locale: a boundary that moves is a boundary two installs disagree on.
 * 2. **A verdict lands in the week it was decided in**, by `decidedAt`. An
 *    `open` row has no decision time and belongs to no week — it is waiting,
 *    not history, and counting it as a verdict would inflate a week with rows
 *    nobody called.
 * 3. **Every week in the window is present, empty included.** An omitted week
 *    cannot say the loop stopped, which is the one sentence the daily screen
 *    exists to print.
 * 4. **`undecided` is exact**: the derived findings with no row at all. A row
 *    that is `open` has a verdict — the vocabulary's word for *seen and not yet
 *    called* — so it is not undecided, and it is the inbox's question rather
 *    than this one.
 */
export function bucketTimeline(
  rows: readonly DecisionRecord[],
  window: {
    findingIds: readonly string[];
    weeks?: number;
    at: string;
  },
): DecisionTimeline {
  const weeks = Math.min(Math.max(Math.trunc(window.weeks ?? DECISION_TIMELINE_WEEKS), 1), 52);
  const lastStart = weekStartMs(new Date(window.at));
  const firstStart = lastStart - WEEK_MS * (weeks - 1);
  const endExclusive = lastStart + WEEK_MS;

  const decided = rows
    .map((row) => ({ row, at: row.decidedAt === null ? Number.NaN : Date.parse(row.decidedAt) }))
    .filter(
      (entry) =>
        entry.row.verdict !== 'open' &&
        Number.isFinite(entry.at) &&
        entry.at >= firstStart &&
        entry.at < endExclusive,
    );

  const weekList: DecisionTimeline['weeks'][number][] = [];
  for (let index = 0; index < weeks; index += 1) {
    const start = firstStart + WEEK_MS * index;
    const counts: Record<string, number> = {};
    for (const verdict of DECISION_VERDICTS) counts[verdict] = 0;
    for (const entry of decided) {
      if (weekStartMs(new Date(entry.at)) === start) {
        counts[entry.row.verdict] = (counts[entry.row.verdict] ?? 0) + 1;
      }
    }
    weekList.push({
      week: weekKey(start),
      counts,
      total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    });
  }

  const byOwner = new Map<string | null, number>();
  for (const entry of decided) {
    byOwner.set(entry.row.ownerId, (byOwner.get(entry.row.ownerId) ?? 0) + 1);
  }
  const owners = [...byOwner.entries()]
    .map(([ownerId, count]) => ({ ownerId, decided: count }))
    // Most decided first, and the tie is the owner's name so the order cannot
    // depend on which row happened to be read first. Unnamed owners last: a
    // verdict recorded by nobody is the case the screen should ask about, and
    // burying it mid-list is how it stays unasked.
    .sort((left, right) =>
      right.decided === left.decided
        ? (left.ownerId ?? '\uffff').localeCompare(right.ownerId ?? '\uffff')
        : right.decided - left.decided,
    );

  const decidedFindingIds = new Set(rows.map((row) => row.findingId));
  const findingIds = [...new Set(window.findingIds)].filter(
    (findingId) => !decidedFindingIds.has(findingId),
  );

  return {
    window: { from: new Date(firstStart).toISOString(), to: window.at, weeks },
    weeks: weekList,
    owners,
    undecided: { count: findingIds.length, findingIds },
  };
}
