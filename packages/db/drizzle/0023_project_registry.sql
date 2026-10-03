-- W0 — make `projects` a registry a run can actually be executed against, and
-- make `runs.project_id` mean something.
--
-- **The table already existed.** Migration 0003 created `projects` with a name, a
-- slug, a default branch, a repository URL and a free-text `settings` blob, and
-- created `runs.project_id` as a bare `uuid` pointing at it. Two columns and no
-- constraint, which produced three separate things nobody could do:
--
--  1. **A run named an id nothing could resolve.** There was no filesystem path
--     on the far side of `runs.project_id`, so "run the tests in this repository"
--     had nothing to run *in*. The generic run engine the plan calls for cannot
--     be built on this column.
--  2. **Any value was accepted.** With no foreign key, a run could carry any
--     uuid in `project_id` and the database recorded it as an attribution to a
--     project that does not exist. Every per-project rollup the command center
--     shows is a join on that column, so the join silently dropped those rows —
--     and a dashboard that cannot see a run is indistinguishable from a run that
--     never happened.
--  3. **Detection had nowhere to live.** A detector produces a versioned
--     proposal; `projects` had a versionless `settings` blob, so a profile
--     written by a later detector would have been read as an earlier one's shape.
--
-- So: three additive columns, and one foreign key. Nothing is dropped and no row
-- is rewritten, because nothing in the table held the values being replaced.
--
-- **`detector_version` is `NOT NULL` with a default of 1, and the default is
-- honest.** A row that has never been detected carries `profile = {}`, and `{}`
-- is detector 1's shape: an empty proposal. A row that *has* been detected
-- carries a non-empty profile and a version at or above 1, so there is no state
-- in which a real profile is read as the empty one. The alternative — a nullable
-- version — would make "never detected" and "detected by nobody we can name" the
-- same value, which is the ambiguity the plan asks this column to remove.

-- Step 1 — the pre-audit. Read-only, and it raises rather than repairing.
--
-- A foreign key cannot be added while any row violates it, and PostgreSQL will
-- refuse the whole `ALTER TABLE` with a message naming one offending row. That is
-- a confusing failure for an operator who has a run pointing at a project deleted
-- by hand years ago, so the count is taken first and explained. This migration
-- will not invent a `projects` row to satisfy an existing run: doing so would
-- fabricate a registry entry — a name, a slug, a repository — that nobody ever
-- declared, and every score and every run attribution would then be computed
-- against a fiction.
DO $$
DECLARE
  orphaned integer;
BEGIN
  SELECT count(*) INTO orphaned
    FROM runs r
   WHERE r.project_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = r.project_id);

  IF orphaned > 0 THEN
    RAISE EXCEPTION
      '% run(s) carry a project_id that names no row in `projects`. The foreign key added by this '
      'migration is what stops a run being attributed to a repository nobody registered, but it '
      'cannot be applied while these rows exist and this migration will not invent a `projects` row '
      'to satisfy them — a fabricated registry entry would give a name, a slug and a repository to a '
      'project no operator ever declared, and every score would then be computed against it. For each '
      'row: register the project it names, or set its project_id to NULL to record that the '
      'attribution was wrong.',
      orphaned;
  END IF;
END
$$;

-- Step 2 — the three columns. Additive, and each defaulted to the state a
-- pre-existing row is honestly in: no path known, no detection, detector 1.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "repo_path" text;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "profile" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "detector_version" integer DEFAULT 1 NOT NULL;

-- Step 3 — the constraint on the version, matching
-- `projects_detector_version_check` in `schema/dashboard.ts`. Named the way
-- `readMigrationStateValues` expects so the integration suite can read what
-- PostgreSQL actually enforces rather than what Drizzle declares at compile time.
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_detector_version_check" CHECK ("detector_version" >= 1);
--> statement-breakpoint

-- Step 4 — and the foreign key that makes `runs.project_id` an attribution
-- rather than a claim. `ON DELETE SET NULL` deliberately: a run is evidence and
-- must outlive the registry entry, but it must stop naming a project that is
-- gone. `NOT VALID` is not used — Step 1 has already established that the table
-- is clean, and a constraint that is not validated is a constraint nobody has
-- checked, which is the same class of defect as `coverage-exclusions.md` rows
-- with no removal condition.
ALTER TABLE "runs"
  ADD CONSTRAINT "runs_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;