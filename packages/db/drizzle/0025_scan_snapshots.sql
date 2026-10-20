-- W-INSIGHTS — the coverage and health history behind the dashboard's trend lines.
--
-- **A history, not a stored score.** `apps/api/src/routes/projects.ts` refuses a cached
-- health score because a stored total that disagrees with the live derivation is two
-- answers to one question. Nothing reads this table to decide anything: the score, the
-- gate and the readiness verdict are computed live, and a snapshot is only ever drawn as
-- a past point on a line.
--
-- One reading per `(workspace, project, hour)`, held by the primary key rather than by the
-- writer remembering to check. A rescan within the hour overwrites that hour's reading.
--
-- Workspace-scoped with a hard `NOT NULL` boundary from the first migration, so it never
-- joins the P-20 class of tables that are tenant-owned with no column to prove it.
-- `ON DELETE CASCADE` on the project, like `quality_gate_config.project_id` in 0024: a
-- reading about a project describes nothing once the project is gone.

CREATE TABLE IF NOT EXISTS "scan_snapshots" (
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "hour" timestamp with time zone NOT NULL,
  "taken_at" timestamp with time zone DEFAULT now() NOT NULL,
  "coverage" real,
  "health_score" real,
  "maturity" real NOT NULL,
  "flaky_tests" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "scan_snapshots_workspace_id_project_id_hour_pk"
    PRIMARY KEY ("workspace_id", "project_id", "hour"),
  CONSTRAINT "scan_snapshots_range_check" CHECK (
    ("coverage" IS NULL OR "coverage" BETWEEN 0 AND 100)
    AND ("health_score" IS NULL OR "health_score" BETWEEN 0 AND 100)
    AND "maturity" BETWEEN 0 AND 100
    AND "flaky_tests" >= 0
  )
);

ALTER TABLE "scan_snapshots"
  ADD CONSTRAINT "scan_snapshots_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;

ALTER TABLE "scan_snapshots"
  ADD CONSTRAINT "scan_snapshots_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;

-- The history read is `WHERE workspace_id = $1 AND project_id = $2 AND taken_at >= $3
-- ORDER BY taken_at`, so the index is in that order and the read is a range scan.
CREATE INDEX IF NOT EXISTS "scan_snapshots_project_taken_idx"
    ON "scan_snapshots" ("workspace_id", "project_id", "taken_at");
