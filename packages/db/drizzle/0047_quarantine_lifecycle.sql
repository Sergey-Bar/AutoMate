-- The quarantine lifecycle gets its last state, and an entry gets its project.
--
-- `released`: an approved entry stops excusing its test. Reached by a person, or by the
-- auto-quarantine policy once the test has passed cleanly enough times in a row. `approved`
-- was terminal, so the only way to stop excusing a test was to delete the entry — and the
-- record of why it had been excused went with it.
--
-- `released_at` is when that happened. `resolved_at` keeps meaning when the entry was
-- decided (approved or rejected), so a release does not overwrite the approval's time.
--
-- `project_id`: which project's test the entry is about. Nullable, and NULL keeps the
-- reading every entry had before this migration — it matches its test in any project of the
-- workspace. An entry follows its project out: a deleted project's quarantine is about tests
-- nothing runs any more.

ALTER TABLE quarantine DROP CONSTRAINT IF EXISTS quarantine_status_check;
--> statement-breakpoint
ALTER TABLE quarantine
  ADD CONSTRAINT quarantine_status_check
  CHECK (status in ('pending', 'approved', 'rejected', 'released'));
--> statement-breakpoint
ALTER TABLE quarantine ADD COLUMN IF NOT EXISTS released_at timestamp with time zone;
--> statement-breakpoint
ALTER TABLE quarantine
  ADD CONSTRAINT quarantine_released_at_check
  CHECK ((status = 'released') = (released_at IS NOT NULL));
--> statement-breakpoint
ALTER TABLE quarantine ADD COLUMN IF NOT EXISTS project_id uuid
  REFERENCES projects(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quarantine_workspace_project_idx ON quarantine (workspace_id, project_id);
