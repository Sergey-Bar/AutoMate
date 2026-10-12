import { sql } from 'drizzle-orm';
import { projects } from './dashboard.js';
import {
  doublePrecision,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * `derived_score_points` — the score's photographs, one per window read.
 *
 * ## A photograph, never a re-derivation
 *
 * The score is a pure function of one window and stays that way: nothing reads
 * `total` to answer "what is the score", and deleting every row here changes no
 * verdict, no gate and no total. What the rows buy is a series long enough to
 * chart — the trend `GET /qa/score` publishes was two points long because a
 * longer one meant re-reading every earlier window on every page load, and a
 * chart with two points is a number with a second number beside it rather than
 * a direction.
 *
 * ## The point's identity is the window, so an unchanged window is one point
 *
 * `(workspace_id, project_id, at)` is unique and the write upserts, which is
 * what makes two reads of an unchanged window produce **identical** points
 * instead of two rows an inch apart. A `written_at`-keyed table would grow one
 * row per page load and the trend would show a window read twice as though the
 * score had moved between two identical readings.
 *
 * Migration 0027 carries the full statement of this, including why `labels` is
 * jsonb rather than fifteen columns.
 */
export const derivedScorePoints = pgTable(
  'derived_score_points',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /**
     * The tenancy boundary, and it is **`text`, like every other tenant key in
     * this schema** — `projects.workspace_id`, `runs.workspace_id`,
     * `decision_records.workspace_id`.
     *
     * A uuid here looks right (every *id* in the schema is one) and is wrong: the
     * tenant key is a **name**, `DEFAULT_WORKSPACE_ID` is `'default-workspace'`,
     * and a uuid column fails with `22P02 invalid input syntax for type uuid` on
     * the default install — which is exactly how `decision_records` shipped
     * broken for one wave. No `references()`: a workspace id this install has not
     * resolved is a row nobody can read, not a row that may not exist.
     */
    workspaceId: text('workspace_id').notNull(),
    /**
     * `ON DELETE CASCADE`, deliberately the same choice `decision_records`
     * made: a deleted project leaves behind nothing describing a repository
     * that no longer exists.
     */
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** The instant the window was read at — the point's identity, not its write time. */
    at: timestamp('at', { withTimezone: true }).notNull(),
    /** The total that reading produced, `0`–`100`. */
    total: doublePrecision('total').notNull(),
    /**
     * The cell totals that produced it, frozen as the score published them:
     * `{ "unit:api": 0.83, … }`. jsonb rather than fifteen columns because the
     * keys belong to the score's own schema and a rename there should not need
     * a migration here — the photograph's job is to say *why*, and it says it in
     * the shape it was read in.
     */
    labels: jsonb('labels').$type<Record<string, number>>().notNull(),
    writtenAt: timestamp('written_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The natural key, and it doubles as the read index: "the newest N points
    // for this project" is a backward scan of the same three columns in the
    // same order. No `coalesce` is needed here — that trick was
    // `decision_records`'s answer to a nullable column, and there is none in
    // this key.
    uniqueIndex('derived_score_points_project_at_key').on(
      table.workspaceId,
      table.projectId,
      table.at,
    ),
  ],
);

/** One photograph, as the API reads it back. */
export interface ScorePointRow {
  id: string;
  projectId: string;
  workspaceId: string;
  at: string;
  total: number;
  labels: Record<string, number>;
  writtenAt: string;
  updatedAt: string;
}
