-- AI-code governance. `pull_requests` gains what attribution and the per-change outcomes need
-- and the Wave-3 sync did not keep: the head sha (for the diff coverage the pull request was
-- gated on), the first 300 changed paths (for follow-up-fix matching), approvals by humans other
-- than the author, and the attribution result with the signature-table version it was made
-- against, so a re-classification after the table changes is detectable. Nothing was released
-- with 0037, so the columns are added to it rather than to a side table.
--
-- `pull_request_gate_findings` records, per pull request, the high and critical findings the
-- gate found new on its branch. One row per (workspace, project, pull request), upserted by the
-- gate report and bounded by the writer to 5000 per project. Hard-scoped from its first
-- migration, the `0028` shape.

ALTER TABLE "pull_requests" ADD COLUMN IF NOT EXISTS "head_sha" text;
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN IF NOT EXISTS "changed_paths" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN IF NOT EXISTS "human_approval_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN IF NOT EXISTS "attribution" text DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN IF NOT EXISTS "ai_agent" text;
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN IF NOT EXISTS "attribution_confidence" real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN IF NOT EXISTS "attribution_signals" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN IF NOT EXISTS "attribution_version" text;
--> statement-breakpoint
ALTER TABLE "pull_requests"
  ADD CONSTRAINT "pull_requests_attribution_check"
  CHECK ("attribution" IN ('agent-authored', 'ai-assisted', 'human', 'unknown'));
--> statement-breakpoint
ALTER TABLE "pull_requests"
  ADD CONSTRAINT "pull_requests_attribution_confidence_check"
  CHECK ("attribution_confidence" >= 0 AND "attribution_confidence" <= 1);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pull_requests_number_idx"
  ON "pull_requests" ("workspace_id", "project_id", "number");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pull_request_gate_findings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "pr_number" integer NOT NULL,
  "commit_sha" text NOT NULL,
  "new_high" integer DEFAULT 0 NOT NULL,
  "new_critical" integer DEFAULT 0 NOT NULL,
  "reported_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pull_request_gate_findings_counts_check"
    CHECK ("pr_number" >= 1 AND "new_high" >= 0 AND "new_critical" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pull_request_gate_findings"
  ADD CONSTRAINT "pull_request_gate_findings_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "pull_request_gate_findings"
  ADD CONSTRAINT "pull_request_gate_findings_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pull_request_gate_findings_pr_idx"
  ON "pull_request_gate_findings" ("workspace_id", "project_id", "pr_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pull_request_gate_findings_recent_idx"
  ON "pull_request_gate_findings" ("workspace_id", "project_id", "reported_at");
