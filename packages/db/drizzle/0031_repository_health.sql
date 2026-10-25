-- Repository health: the scanner reports, the findings carried across them, and the grade's
-- history.
--
-- **No grade is stored as an authority.** `grade()` in `@automate/projects` computes it live
-- from the open findings and the latest metrics; `health_snapshots` is the trend line's past
-- points and nothing reads it to decide anything — the rule `scan_snapshots` (0025) follows.
--
-- Hard-scoped from the first migration, the `0028_workspace_hard_boundaries.sql` shape:
-- `workspace_id text NOT NULL`, a `restrict` key onto `workspaces`, and an index leading with
-- it. `ON DELETE CASCADE` on the project: a finding about a project describes nothing once
-- the project is gone.

CREATE TABLE IF NOT EXISTS "health_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- Arrival order: the latest report of a kind is the highest sequence, so two uploads in one
  -- millisecond still have an order.
  "sequence" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "branch" text NOT NULL,
  "commit_sha" text,
  "source" text NOT NULL,
  "format" text NOT NULL,
  "tool_key" text NOT NULL,
  "tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "finding_count" integer DEFAULT 0 NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "health_reports_finding_count_check" CHECK ("finding_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "health_reports"
  ADD CONSTRAINT "health_reports_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "health_reports"
  ADD CONSTRAINT "health_reports_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
-- "The latest report of this kind on this branch" is the read every grade makes.
CREATE INDEX IF NOT EXISTS "health_reports_latest_idx"
  ON "health_reports" ("workspace_id", "project_id", "branch", "tool_key", "sequence");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "health_findings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "branch" text NOT NULL,
  "fingerprint" text NOT NULL,
  "tool_key" text NOT NULL,
  "tool" text NOT NULL,
  "rule_id" text NOT NULL,
  "kind" text NOT NULL,
  "severity" text NOT NULL,
  "dimension" text NOT NULL,
  "path" text,
  "line" integer,
  "message" text NOT NULL,
  "help_uri" text,
  "fix_available" boolean,
  "state" text DEFAULT 'open' NOT NULL,
  "triage_reason" text,
  "triage_expires_at" timestamp with time zone,
  "triaged_by" text,
  "owner" text,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_report_id" uuid,
  CONSTRAINT "health_findings_state_check"
    CHECK ("state" IN ('open', 'fixed', 'suppressed', 'accepted', 'false_positive')),
  CONSTRAINT "health_findings_severity_check"
    CHECK ("severity" IN ('critical', 'high', 'medium', 'low', 'info'))
);
--> statement-breakpoint
ALTER TABLE "health_findings"
  ADD CONSTRAINT "health_findings_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "health_findings"
  ADD CONSTRAINT "health_findings_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "health_findings"
  ADD CONSTRAINT "health_findings_last_report_id_health_reports_id_fk"
  FOREIGN KEY ("last_report_id") REFERENCES "health_reports"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "health_findings_identity_idx"
  ON "health_findings" ("workspace_id", "project_id", "branch", "fingerprint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "health_findings_tool_idx"
  ON "health_findings" ("workspace_id", "project_id", "branch", "tool_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "health_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "branch" text NOT NULL,
  "taken_at" timestamp with time zone DEFAULT now() NOT NULL,
  "score" real,
  "letter" text,
  "grade" jsonb NOT NULL,
  CONSTRAINT "health_snapshots_score_check" CHECK ("score" IS NULL OR "score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
ALTER TABLE "health_snapshots"
  ADD CONSTRAINT "health_snapshots_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "health_snapshots"
  ADD CONSTRAINT "health_snapshots_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "health_snapshots_project_taken_idx"
  ON "health_snapshots" ("workspace_id", "project_id", "branch", "taken_at");
