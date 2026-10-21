-- MNT-15. Two constraints that disagreed with the schema.
--
-- 1. `runs.project_id` carried two foreign keys. 0003 created
--    `runs_project_id_projects_id_fk`; 0023 added `runs_project_id_fkey` on the premise
--    that the column had none, so every write to the column and every `projects` delete
--    was checked twice. Both are `ON DELETE SET NULL` to the same column, so dropping the
--    second changes no behaviour.
-- 2. 0024 named the `quality_gate_config.project_id` key by hand (`_fkey`) where the
--    schema's `.references()` produces `_projects_id_fk`. Same columns and action; the
--    rename makes a generated migration stop proposing to drop and re-add it.
ALTER TABLE "runs" DROP CONSTRAINT IF EXISTS "runs_project_id_fkey";
--> statement-breakpoint
ALTER TABLE "quality_gate_config"
  RENAME CONSTRAINT "quality_gate_config_project_id_fkey"
  TO "quality_gate_config_project_id_projects_id_fk";
