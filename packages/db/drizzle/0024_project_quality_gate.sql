-- W0 — per-project quality gates, as a column on the table that already exists.
--
-- **`quality_gate_config` already had a reader and a writer.** A
-- `project_thresholds` table would therefore have had neither for as long as it
-- existed, which is the dormant schema `docs/quality/capability-justification.md`
-- exists to prevent — and worse, it would have left two places that answer "what
-- is this project's pass-rate threshold", of which one is the answer nobody reads.
-- Plan task 9 asks for a column, and this is it.
--
-- `ON DELETE CASCADE`, deliberately, and it is the opposite of the
-- `runs.project_id` choice in 0023:
--
--   - a **run** is evidence. It outlives the registry entry, so deleting a
--     project must not delete what it produced — `SET NULL` there.
--   - a **threshold** is configuration *about* a project. Once the project is
--     gone the thresholds describe nothing, and keeping them would let a
--     re-created project with the same name inherit a threshold set for a
--     different repository.
--
-- A project that declares no gate of its own reads the row with
-- `project_id IS NULL`, which is why the column is nullable. Nothing is
-- backfilled: every existing row is already the workspace-wide default and says
-- so by having no project.

-- Step 1 — the column, **before** the audit.
--
-- Order matters and the obvious order is wrong. The audit queries
-- `quality_gate_config.project_id`, and on a fresh install that column does not
-- exist until this migration creates it — so auditing first fails with
-- `column q.project_id does not exist`, which says nothing about the rows the
-- audit exists to find.
--
-- `IF NOT EXISTS` is what keeps the audit worth running afterwards: on a fresh
-- install every row is `NULL` and the count is zero, but on an installation where
-- somebody applied this column by hand and wrote values into it, the audit is the
-- only thing standing between those values and a foreign key that cannot be added.
ALTER TABLE "quality_gate_config" ADD COLUMN IF NOT EXISTS "project_id" uuid;

-- Step 2 — the pre-audit. Read-only, and it raises rather than repairing.
--
-- A gate naming a project that does not exist is a threshold for a repository
-- nobody registered. Leaving the rows in place and adding the foreign key would
-- make the migration fail with a message naming one of them; counting first says
-- what the problem is.
DO $$
DECLARE
  orphaned integer;
BEGIN
  SELECT count(*) INTO orphaned
    FROM quality_gate_config q
   WHERE q.project_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = q.project_id);

  IF orphaned > 0 THEN
    RAISE EXCEPTION
      '% quality gate(s) name a project_id that names no row in `projects`. A threshold for a '
      'repository nobody registered is not a fallback for any real project, and this migration will '
      'not invent the missing `projects` row to satisfy it. Delete the gate, or point it at a project '
      'that exists.',
      orphaned;
  END IF;
END
$$;

-- Step 3 — and the foreign key.
ALTER TABLE "quality_gate_config"
  ADD CONSTRAINT "quality_gate_config_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;

-- Step 4 — the read path.
--
-- `quality_gate_config` has been read by the gate evaluation path with no
-- project predicate, so without this index a per-project lookup scans every gate
-- row in the install. The composite is `(workspace_id, project_id)` because that
-- is the order the reader filters in, and the `id` tiebreak lets the loader take
-- one row per project without a sort.
CREATE INDEX IF NOT EXISTS "quality_gate_config_workspace_project_idx"
    ON "quality_gate_config" ("workspace_id", "project_id");