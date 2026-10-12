-- L0 — decision records: the loop's spine.
--
-- **The console derives findings and has nowhere to record what a human decided
-- about them.** Every other part of the product is a measurement; this table is
-- the first part that is a *decision*, and it is what turns the insights screen
-- from a dashboard into a work queue. `AGENTS.md` records the failure it fixes in
-- its own words: "a quarantine that never gets a verdict is a test nobody owns" —
-- and the quarantine is the only place a verdict exists, which is the same
-- defect with one survivor.
--
-- ## One row per derived finding, per cell
--
-- The natural key is `(finding_id, cell)`, not `finding_id`: "the e2e cell on
-- frontend is a flake" and "the e2e cell on backend is a flake" are two
-- decisions about two different tests, and one row for both would make a verdict
-- on one silently cover the other. `cell` is nullable for the findings that are
-- about the install rather than about a cell — the pass rate, the infra failure
-- rate — and that nullable is why the unique index below is partial rather than
-- a plain UNIQUE constraint: a plain one would treat two `NULL` cells as equal
-- under the SQL null-distinctness rule and block the second install-wide
-- record, which is the wrong answer for a row nobody meant to duplicate.
--
-- ## The verdict vocabulary is closed, and the gate is in the database
--
-- `deferred` requires `defer_until` and the constraint enforces it: a deferral
-- with no date is "in the future", which is not a removal condition. The ledger
-- already refuses it for a debt row and the same rule holds here — the sentence
-- "we will look at this later" is what a flake becomes when nobody writes a date
-- next to it.
--
-- ## Ownership is not optional
--
-- `owner_id` is the workspace member who made the call. It is nullable only
-- because a row may be created before anyone claims it, and the *pending* verdict
-- is what an unclaimed row looks like — which is a state the screen renders
-- rather than a state the schema allows to be silent.

CREATE TABLE IF NOT EXISTS "decision_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The tenancy boundary, and it is **`text` like every other tenant key in this
  -- schema**: `projects.workspace_id`, `runs.workspace_id`,
  -- `canonical_run_results.workspace_id`.
  --
  -- **`uuid` here was the defect, and the reason is worth the lines.** A uuid
  -- looks right because every *id* in the schema is one, but the tenant key is
  -- not an id: `DEFAULT_WORKSPACE_ID` is `'default-workspace'`, a name. So this
  -- column failed with `22P02 invalid input syntax for type uuid` on every read
  -- and every write of the default install — the decision loop, unreadable and
  -- unrecordable, on the only install there is. Resolving a workspace *name* is
  -- the registry's business, and a column type is not the place to assert the
  -- name happens to look like a uuid.
  --
  -- Deliberately no `references()`: a workspace id this install has not resolved
  -- is a row nobody can read, not a row that may not exist. Still `NOT NULL`,
  -- because a decision must name its tenant.
  "workspace_id" text NOT NULL,
  -- The project the finding is about. `ON DELETE CASCADE` for the same reason as
  -- `quality_gate_config` in 0024: this row is *about* a project, so a deleted
  -- project leaves behind a decision describing a repository that no longer
  -- exists. A run is evidence and gets `SET NULL`; a decision is not.
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  -- The derived finding's id, e.g. `flaky-decision`. It is not a foreign key:
  -- the ids come from the pure engine in `lib/findings.ts` and
  -- `apps/api/src/services/qa-score-service.ts`, which is data rather than a
  -- table, and a migration that referenced it would be a migration that broke
  -- when a rule was renamed.
  "finding_id" text NOT NULL,
  -- Which cell the finding is about, when it is about one.
  "cell" text,
  "verdict" text NOT NULL DEFAULT 'open',
  -- Who made the call. **Text, not a uuid**: an owner is a name the product resolves, and this schema has no users table to point at — a foreign key here would be a key to nothing.
  "owner_id" text,
  "decided_at" timestamptz,
  "note" text,
  -- Required exactly when `verdict = 'deferred'`. See the constraint below.
  "defer_until" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" text,
  "updated_by" text
);

-- The closed vocabulary, enforced where a typo would otherwise become a state
-- nobody renders.
ALTER TABLE "decision_records"
  DROP CONSTRAINT IF EXISTS "decision_records_verdict_check";
ALTER TABLE "decision_records"
  ADD CONSTRAINT "decision_records_verdict_check"
  CHECK ("verdict" IN ('open', 'accepted', 'fixed', 'excluded', 'deferred'));

-- A deferral without a date is "in the future", and "in the future" is not a
-- removal condition. Everything else may have no date.
ALTER TABLE "decision_records"
  DROP CONSTRAINT IF EXISTS "decision_records_deferred_needs_date";
ALTER TABLE "decision_records"
  ADD CONSTRAINT "decision_records_deferred_needs_date"
  CHECK ("verdict" <> 'deferred' OR "defer_until" IS NOT NULL);

-- The natural key, and the `coalesce` is the whole of it.
--
-- **A plain unique index would not have worked for the install-wide findings.**
-- SQL treats two NULLs as *distinct* in a unique index, so two rows for
-- `(finding_id, cell = NULL)` — the pass rate, the infra failure rate — would
-- never conflict and the second write would insert a second row. That is the
-- loop's central failure: "what did I decide about the pass rate" would return
-- the first answer forever.
--
-- `coalesce(cell, '')` folds the NULL case into the same key space, so an
-- install-wide finding has exactly one row in exactly the way a per-cell one
-- does. The parity suite proved it: without the coalesce, the `keeps a note`
-- and `replaces the verdict` scenarios failed against the Drizzle store alone.
CREATE UNIQUE INDEX IF NOT EXISTS "decision_records_finding_cell_key"
    ON "decision_records" ("workspace_id", "project_id", "finding_id", coalesce("cell", ''))
 WHERE "verdict" <> 'deleted';

-- The read path. The loop's daily screen asks "what is open, oldest first", and
-- the inbox asks "what is waiting on me", which is the owner filter — so the
-- composite leads with the workspace and the verdict, which is the order both
-- queries predicate on.
CREATE INDEX IF NOT EXISTS "decision_records_workspace_verdict_idx"
    ON "decision_records" ("workspace_id", "verdict", "decided_at");

CREATE INDEX IF NOT EXISTS "decision_records_workspace_owner_idx"
    ON "decision_records" ("workspace_id", "owner_id", "verdict")
 WHERE "verdict" = 'open';
