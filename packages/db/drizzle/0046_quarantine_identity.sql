-- A quarantine entry names the test it is about by the test's identity (`tests.stable_id`,
-- 0045), so an entry for the webkit project of a test does not excuse its chromium project.
--
-- Nullable: an entry recorded before identities existed has none, and keeps matching the way
-- it did when it was approved — by title and file, in every project. No row is rewritten,
-- because a backfill would have to guess which project the person who approved it meant.

ALTER TABLE quarantine ADD COLUMN IF NOT EXISTS stable_id text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quarantine_workspace_stable_id_idx ON quarantine (workspace_id, stable_id);
