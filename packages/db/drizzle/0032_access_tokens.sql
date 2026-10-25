-- Access tokens for the repository-health roles: viewer, operator, admin, and the CI
-- uploader pinned to one project. Only a SHA-256 of the secret is stored; the secret is shown
-- once. Hard-scoped from the first migration, the `0028_workspace_hard_boundaries.sql` shape.

CREATE TABLE IF NOT EXISTS "access_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "name" text NOT NULL,
  "role" text NOT NULL,
  "project_id" uuid,
  "token_hash" text NOT NULL,
  "display_prefix" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "access_tokens_role_check"
    CHECK ("role" IN ('viewer', 'operator', 'admin', 'uploader')),
  CONSTRAINT "access_tokens_uploader_project_check"
    CHECK ("role" <> 'uploader' OR "project_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "access_tokens"
  ADD CONSTRAINT "access_tokens_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "access_tokens"
  ADD CONSTRAINT "access_tokens_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "access_tokens_hash_idx" ON "access_tokens" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_tokens_workspace_idx"
  ON "access_tokens" ("workspace_id", "created_at");
