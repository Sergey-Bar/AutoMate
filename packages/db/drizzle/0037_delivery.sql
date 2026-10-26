-- Delivery performance: where a project's delivery data comes from (delivery_sources), the
-- sync queue the worker fills and the API drains (delivery_syncs), and what the syncs and the
-- push door write: pull_requests, commits, deployments and incidents. Hard-scoped from the
-- first migration, the `0028` shape. Every observation is unique on (workspace, project,
-- source, external id), so a repeated sync or push writes one row. No token is stored here:
-- a project's GitHub token is the vault entry `git:<projectId>`.

CREATE TABLE IF NOT EXISTS "delivery_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "provider" text DEFAULT 'github' NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "cadence" text DEFAULT 'daily' NOT NULL,
  "production_environments" jsonb DEFAULT '["production"]'::jsonb NOT NULL,
  "markers" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "deploy_workflows" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "cursors" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_synced_at" timestamp with time zone,
  "last_status" text,
  "last_error" text,
  "rate_limited_until" timestamp with time zone,
  "next_sync_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "delivery_sources_provider_check" CHECK ("provider" IN ('github')),
  CONSTRAINT "delivery_sources_cadence_check" CHECK ("cadence" IN ('hourly', 'daily')),
  CONSTRAINT "delivery_sources_last_status_check"
    CHECK ("last_status" IS NULL OR "last_status" IN ('ok', 'failed', 'not_configured', 'rate_limited'))
);
--> statement-breakpoint
ALTER TABLE "delivery_sources"
  ADD CONSTRAINT "delivery_sources_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "delivery_sources"
  ADD CONSTRAINT "delivery_sources_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_sources_project_idx"
  ON "delivery_sources" ("workspace_id", "project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_sources_due_idx"
  ON "delivery_sources" ("next_sync_at")
  WHERE enabled = true;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_syncs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "source_id" uuid NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "requested_by" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "error_code" text,
  "error_message" text,
  "stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "delivery_syncs_status_check"
    CHECK ("status" IN ('queued', 'running', 'done', 'failed')),
  CONSTRAINT "delivery_syncs_requested_by_check"
    CHECK ("requested_by" IN ('schedule', 'operator', 'webhook'))
);
--> statement-breakpoint
ALTER TABLE "delivery_syncs"
  ADD CONSTRAINT "delivery_syncs_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "delivery_syncs"
  ADD CONSTRAINT "delivery_syncs_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "delivery_syncs"
  ADD CONSTRAINT "delivery_syncs_source_id_delivery_sources_id_fk"
  FOREIGN KEY ("source_id") REFERENCES "delivery_sources"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_syncs_idempotency_idx"
  ON "delivery_syncs" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_syncs_workspace_idx"
  ON "delivery_syncs" ("workspace_id", "source_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_syncs_due_idx"
  ON "delivery_syncs" ("status", "next_attempt_at")
  WHERE status IN ('queued', 'running');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pull_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "source" text DEFAULT 'github' NOT NULL,
  "external_id" text NOT NULL,
  "number" integer NOT NULL,
  "state" text NOT NULL,
  "draft" boolean DEFAULT false NOT NULL,
  "author_login" text,
  "head_branch" text,
  "base_branch" text,
  "labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "opened_at" timestamp with time zone NOT NULL,
  "first_commit_at" timestamp with time zone,
  "first_review_at" timestamp with time zone,
  "approved_at" timestamp with time zone,
  "merged_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "merge_commit_sha" text,
  "additions" integer DEFAULT 0 NOT NULL,
  "deletions" integer DEFAULT 0 NOT NULL,
  "changed_files" integer DEFAULT 0 NOT NULL,
  "review_count" integer DEFAULT 0 NOT NULL,
  "approval_count" integer DEFAULT 0 NOT NULL,
  "comment_count" integer DEFAULT 0 NOT NULL,
  "tests_touched" boolean DEFAULT false NOT NULL,
  "last_activity_at" timestamp with time zone NOT NULL,
  "synced_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pull_requests_state_check" CHECK ("state" IN ('open', 'closed', 'merged'))
);
--> statement-breakpoint
ALTER TABLE "pull_requests"
  ADD CONSTRAINT "pull_requests_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "pull_requests"
  ADD CONSTRAINT "pull_requests_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pull_requests_external_idx"
  ON "pull_requests" ("workspace_id", "project_id", "source", "external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pull_requests_activity_idx"
  ON "pull_requests" ("workspace_id", "project_id", "last_activity_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pull_requests_merge_idx"
  ON "pull_requests" ("workspace_id", "project_id", "merge_commit_sha");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "source" text DEFAULT 'github' NOT NULL,
  "sha" text NOT NULL,
  "pr_number" integer,
  "author_login" text,
  "author_email" text,
  "author_name" text,
  "committer_login" text,
  "message" text NOT NULL,
  "committed_at" timestamp with time zone NOT NULL,
  "synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commits"
  ADD CONSTRAINT "commits_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "commits"
  ADD CONSTRAINT "commits_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commits_external_idx"
  ON "commits" ("workspace_id", "project_id", "source", "sha");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commits_recent_idx"
  ON "commits" ("workspace_id", "project_id", "committed_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deployments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "source" text NOT NULL,
  "external_id" text NOT NULL,
  "environment" text NOT NULL,
  "status" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "sha" text,
  "shas" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "rollback" boolean DEFAULT false NOT NULL,
  "hotfix" boolean DEFAULT false NOT NULL,
  "unplanned" boolean DEFAULT false NOT NULL,
  "url" text,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "deployments_source_check" CHECK ("source" IN ('github', 'push')),
  CONSTRAINT "deployments_status_check" CHECK ("status" IN ('success', 'failure'))
);
--> statement-breakpoint
ALTER TABLE "deployments"
  ADD CONSTRAINT "deployments_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "deployments"
  ADD CONSTRAINT "deployments_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deployments_external_idx"
  ON "deployments" ("workspace_id", "project_id", "source", "external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deployments_recent_idx"
  ON "deployments" ("workspace_id", "project_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incidents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "source" text NOT NULL,
  "external_id" text NOT NULL,
  "opened_at" timestamp with time zone NOT NULL,
  "resolved_at" timestamp with time zone,
  "severity" text,
  "deployment_external_id" text,
  "sha" text,
  "title" text NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "incidents_severity_check"
    CHECK ("severity" IS NULL OR "severity" IN ('critical', 'high', 'medium', 'low'))
);
--> statement-breakpoint
ALTER TABLE "incidents"
  ADD CONSTRAINT "incidents_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "incidents"
  ADD CONSTRAINT "incidents_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "incidents_external_idx"
  ON "incidents" ("workspace_id", "project_id", "source", "external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_recent_idx"
  ON "incidents" ("workspace_id", "project_id", "opened_at");
