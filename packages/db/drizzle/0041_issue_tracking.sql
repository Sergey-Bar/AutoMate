-- Issue tracking. Two tables, each hard-scoped from its first migration, the `0028` shape:
-- `workspace_id` NOT NULL, a `restrict` key onto `workspaces`, and every index leading with it.
--
-- `issue_trackers`: one project's tracker (Jira today): base URL, project key, issue type. No
-- credential: the token is the vault entry `tracker:<projectId>:<kind>`.
-- `issue_links`: the issue created from one finding or one failure cluster in one target. The
-- unique index is the idempotency: a row is written `pending` before the tracker is called,
-- and `created` with the key and URL after, so a second call returns the first one's issue.

CREATE TABLE IF NOT EXISTS "issue_trackers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "base_url" text NOT NULL,
  "project_key" text NOT NULL,
  "issue_type" text NOT NULL,
  "updated_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "issue_trackers_kind_check" CHECK ("kind" IN ('jira')),
  CONSTRAINT "issue_trackers_base_url_check" CHECK ("base_url" LIKE 'https://%')
);
--> statement-breakpoint
ALTER TABLE "issue_trackers"
  ADD CONSTRAINT "issue_trackers_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "issue_trackers"
  ADD CONSTRAINT "issue_trackers_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "issue_trackers_project_kind_idx"
  ON "issue_trackers" ("workspace_id", "project_id", "kind");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issue_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "source_kind" text NOT NULL,
  "source_key" text NOT NULL,
  "target" text NOT NULL,
  "state" text DEFAULT 'pending' NOT NULL,
  "issue_key" text,
  "issue_url" text,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "issue_links_source_kind_check" CHECK ("source_kind" IN ('finding', 'cluster')),
  CONSTRAINT "issue_links_target_check" CHECK ("target" IN ('jira', 'github')),
  CONSTRAINT "issue_links_state_check" CHECK ("state" IN ('pending', 'created')),
  CONSTRAINT "issue_links_created_check"
    CHECK ("state" <> 'created' OR ("issue_key" IS NOT NULL AND "issue_url" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "issue_links"
  ADD CONSTRAINT "issue_links_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "issue_links"
  ADD CONSTRAINT "issue_links_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "issue_links_source_idx"
  ON "issue_links" ("workspace_id", "project_id", "source_kind", "source_key", "target");
