-- AI test proposals: a unified diff for a new test file, proposed by the configured model from
-- a surviving mutant or a diff's uncovered lines. Never applied, committed or pushed: the
-- product stores the proposal and a person decides. Hard-scoped from its first migration, the
-- `0028` shape. Bounded per project by the API, which prunes on every write.

CREATE TABLE IF NOT EXISTS "test_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "finding_id" uuid,
  "commit_sha" text,
  "path" text NOT NULL,
  "test_framework" text NOT NULL,
  "suggested_path" text NOT NULL,
  "patch" text NOT NULL,
  "rationale" text NOT NULL,
  "model" text NOT NULL,
  "provider" text NOT NULL,
  "input_tokens" integer,
  "output_tokens" integer,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "test_proposals_kind_check" CHECK ("kind" IN ('surviving-mutant', 'uncovered-lines')),
  CONSTRAINT "test_proposals_patch_check" CHECK (length("patch") <= 65536)
);
--> statement-breakpoint
ALTER TABLE "test_proposals"
  ADD CONSTRAINT "test_proposals_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "test_proposals"
  ADD CONSTRAINT "test_proposals_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "test_proposals"
  ADD CONSTRAINT "test_proposals_finding_id_health_findings_id_fk"
  FOREIGN KEY ("finding_id") REFERENCES "health_findings"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "test_proposals_project_idx"
  ON "test_proposals" ("workspace_id", "project_id", "created_at");
