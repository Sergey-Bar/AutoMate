-- Diff coverage: each commit's executable and covered lines (coverage_line_maps) and each
-- commit's diff with, once both halves have arrived, its diff coverage
-- (diff_coverage_results). Hard-scoped from the first migration, the `0028` shape. Both are
-- bounded by the service to the 50 most recent rows per project, so a busy repository's
-- history does not grow without limit.

CREATE TABLE IF NOT EXISTS "coverage_line_maps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "commit_sha" text NOT NULL,
  "branch" text NOT NULL,
  "files" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "report_id" uuid,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coverage_line_maps"
  ADD CONSTRAINT "coverage_line_maps_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "coverage_line_maps"
  ADD CONSTRAINT "coverage_line_maps_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "coverage_line_maps"
  ADD CONSTRAINT "coverage_line_maps_report_id_health_reports_id_fk"
  FOREIGN KEY ("report_id") REFERENCES "health_reports"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "coverage_line_maps_commit_idx"
  ON "coverage_line_maps" ("workspace_id", "project_id", "commit_sha");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coverage_line_maps_recent_idx"
  ON "coverage_line_maps" ("workspace_id", "project_id", "received_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "diff_coverage_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "branch" text NOT NULL,
  "commit_sha" text NOT NULL,
  "changed" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "covered" integer,
  "executable" integer,
  "ratio" real,
  "uncovered" jsonb,
  "unmeasured_files" jsonb,
  "computed_at" timestamp with time zone,
  "report_id" uuid,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "diff_coverage_results_ratio_check" CHECK ("ratio" IS NULL OR "ratio" BETWEEN 0 AND 1)
);
--> statement-breakpoint
ALTER TABLE "diff_coverage_results"
  ADD CONSTRAINT "diff_coverage_results_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "diff_coverage_results"
  ADD CONSTRAINT "diff_coverage_results_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "diff_coverage_results"
  ADD CONSTRAINT "diff_coverage_results_report_id_health_reports_id_fk"
  FOREIGN KEY ("report_id") REFERENCES "health_reports"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "diff_coverage_results_commit_idx"
  ON "diff_coverage_results" ("workspace_id", "project_id", "branch", "commit_sha");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "diff_coverage_results_recent_idx"
  ON "diff_coverage_results" ("workspace_id", "project_id", "received_at");
