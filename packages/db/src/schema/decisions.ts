import { sql } from 'drizzle-orm';
import { projects } from './dashboard.js';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * `decision_records` — the loop's spine, and the only table in this schema whose
 * rows are decisions rather than measurements.
 *
 * ## Why a table and not a column on `quarantine`
 *
 * The quarantine already has a verdict, and that is the whole problem: a product
 * where one derived finding can be decided and the other six cannot is a product
 * where the six are dashboards. The natural unit is (finding, cell), not
 * (quarantine row), because "the e2e cell on frontend is a flake" and "the e2e
 * cell on backend is a flake" are two decisions about two different tests — and
 * one row for both would make a verdict on one silently cover the other.
 *
 * ## The vocabulary is closed in the database, not in the client
 *
 * `verdict` is an enum rather than free text, because a typo in a form is a state
 * the screen cannot render and the query cannot filter. `deferred` additionally
 * requires `defer_until` — the same rule `AGENTS.md` enforces on a ledger debt
 * row, and for the same reason: a deferral with no date is "in the future",
 * which is how a flake becomes permanent.
 */

/** The five verdicts, and the one thing each of them means to the reader. */
export const DECISION_VERDICTS = ['open', 'accepted', 'fixed', 'excluded', 'deferred'] as const;

export type DecisionVerdict = (typeof DECISION_VERDICTS)[number];

export const decisionRecords = pgTable(
  'decision_records',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /**
     * The tenancy boundary, and it is **`text`, like every other tenant key in
     * this schema**.
     *
     * ## Why not `uuid`, which is what this column was for one wave
     *
     * A uuid looks right because every *id* in the schema is one. The tenant key
     * is not an id. `DEFAULT_WORKSPACE_ID` in the composition root is
     * `'default-workspace'` — a name, not a uuid — so every read and every write
     * against a uuid column failed with `22P02 invalid input syntax for type
     * uuid` on the one install the product ships as default, and the decision
     * loop — the centre of the plan this table belongs to — did not work at all.
     *
     * `projects.workspace_id`, `runs.workspace_id` and
     * `canonical_run_results.workspace_id` are all `text` for the same reason:
     * resolving a workspace *name* is the registry's business, and a column type
     * is not the place to assert the name happens to look like a uuid. There is
     * no `references()` — a workspace id this install has not resolved is a row
     * nobody can read, not a row that may not exist.
     *
     * Still `NOT NULL`: a decision must name its tenant, and the register records
     * the boundary as hard rather than conventional.
     */
    workspaceId: text('workspace_id').notNull(),
    /**
     * `ON DELETE CASCADE`, deliberately, and it is the opposite of the
     * `runs.project_id` choice in migration 0023: a **run** is evidence and
     * outlives the registry entry; a **decision** is about a project, so a
     * deleted project leaves behind a row describing a repository that no longer
     * exists.
     */
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /**
     * The derived finding's id, e.g. `flaky-decision`. **Not a foreign key**: the
     * ids come from the pure engine in `lib/findings.ts`, which is data rather
     * than a table, and a migration referencing it would break the day a rule was
     * renamed.
     */
    findingId: text('finding_id').notNull(),
    /** Which cell the finding is about, when it is about one. */
    cell: text('cell'),
    verdict: text('verdict', { enum: DECISION_VERDICTS }).notNull().default('open'),
    /** Who made the call. Text, not a uuid — an owner is a name the product resolves. */
    ownerId: text('owner_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    note: text('note'),
    /** Required exactly when `verdict = 'deferred'`; see the check below. */
    deferUntil: timestamp('defer_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
  },
  (table) => [
    // The closed vocabulary, where a typo would otherwise become a state nobody
    // renders.
    check(
      'decision_records_verdict_check',
      sql`${table.verdict} IN ('open', 'accepted', 'fixed', 'excluded', 'deferred')`,
    ),
    // A deferral without a date is "in the future", which is not a removal
    // condition. Everything else may have no date.
    check(
      'decision_records_deferred_needs_date_check',
      sql`${table.verdict} <> 'deferred' OR ${table.deferUntil} IS NOT NULL`,
    ),
    // The natural key, and the `coalesce` is the whole of it. **A plain unique
    // index would not have worked for the install-wide findings**: SQL treats two
    // NULLs as *distinct*, so `(finding_id, cell = NULL)` would never conflict and
    // the second write would insert a second row — the loop's central failure,
    // where "what did I decide about the pass rate" returns the first answer
    // forever. `coalesce` folds the NULL case into the same key space. The
    // parity suite proved it.
    // Written against the callback's own `table` rather than the constant being
    // defined, because referencing the constant inside its own initialiser is a
    // circular type the compiler refuses.
    uniqueIndex('decision_records_finding_cell_key')
      .on(
        sql`(${table.workspaceId}, ${table.projectId}, ${table.findingId}, coalesce(${table.cell}, ''))`,
      )
      .where(sql`${table.verdict} <> 'deleted'`),
    // The daily screen asks "what is open, oldest first" — workspace, verdict,
    // and the timestamp the reader sorts on.
    index('decision_records_workspace_verdict_idx').on(
      table.workspaceId,
      table.verdict,
      table.decidedAt,
    ),
    // The inbox asks "what is waiting on me", which is the owner filter.
    index('decision_records_workspace_owner_idx')
      .on(table.workspaceId, table.ownerId, table.verdict)
      .where(sql`${table.verdict} = 'open'`),
  ],
);

/**
 * A decision as the API hands it to a screen.
 *
 * The row minus the tenancy column: a screen renders a verdict about a finding,
 * and the workspace is what scoped the query, not part of the answer.
 */
export interface DecisionRecord {
  id: string;
  projectId: string;
  findingId: string;
  cell: string | null;
  verdict: DecisionVerdict;
  ownerId: string | null;
  decidedAt: string | null;
  note: string | null;
  deferUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The write a caller makes, and the only shape a decision may be created in.
 *
 * **`verdict` defaults to `open`** — the same fails-closed default
 * `quality_gate_config` got in migration 0024, and for the same reason: a record
 * that starts `accepted` would exclude something from reporting with nobody
 * deciding that. An `open` row is a finding the console has *seen* and nobody has
 * yet called, which is the state the screen shows as an item of work.
 */
export interface DecisionInput {
  findingId: string;
  cell: string | null;
  verdict?: DecisionVerdict;
  ownerId?: string | null;
  note?: string | null;
  deferUntil?: string | null;
}

/**
 * The predicates a read may carry, and the two questions they answer.
 *
 * **Three fields, and each one is a column the index already leads with.**
 * `decision_records_workspace_owner_idx` is `(workspace_id, owner_id,
 * verdict)` filtered to open rows — which is the inbox question ("what is
 * waiting on me") in index order. `decision_records_workspace_verdict_idx` is
 * `(workspace_id, verdict, decided_at)` — which is the history question ("what
 * did I decide, and when") in index order. A fourth predicate would be a
 * fourth index, and a predicate with no index behind it is a scan the loop runs
 * on every page load.
 */
export interface DecisionQuery {
  /** The verdict to filter on. `open` is the inbox's. */
  verdict?: DecisionVerdict;
  /** Whose row it is. Combined with `verdict: 'open'` this is "waiting on me". */
  ownerId?: string;
  /**
   * An ISO instant: rows decided at or after it. Combined with `ownerId` this
   * is "what I decided" — and it is what flips the order to newest first,
   * because the question changes from *what is waiting* to *what I did*.
   */
  since?: string;
}

/** How many weeks the timeline covers, and the reason it is eight. */
export const DECISION_TIMELINE_WEEKS = 8;
