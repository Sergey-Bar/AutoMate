-- People, and which workspaces they belong to (ADR-014, the team profile). Additive only.
--
-- `users` existed with no writer: it gains the identity a sign-in names, an issuer and a
-- subject, unique together, so one person at one identity provider is one row. Its legacy
-- `role` and `tenant_id` columns are left as they are and read by nothing; a person's role is
-- per workspace now, in `workspace_members`.
--
-- Both new tables are workspace-scoped with the hard boundary from the first migration, the
-- `0028` shape: `workspace_id` NOT NULL, a `restrict` key onto `workspaces`, and a key leading
-- with it. An invitation is stored only as a hash of its secret.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "issuer" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subject" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "disabled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_issuer_subject_idx" ON "users" ("issuer", "subject");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_members" (
  "workspace_id" text NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text NOT NULL,
  "invited_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("workspace_id", "user_id"),
  CONSTRAINT "workspace_members_role_check" CHECK ("role" IN ('viewer', 'operator', 'admin'))
);
--> statement-breakpoint
ALTER TABLE "workspace_members"
  ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "workspace_members"
  ADD CONSTRAINT "workspace_members_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_members_user_idx" ON "workspace_members" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "email" text NOT NULL,
  "role" text NOT NULL,
  "token_hash" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "accepted_by" uuid,
  CONSTRAINT "invitations_role_check" CHECK ("role" IN ('viewer', 'operator', 'admin'))
);
--> statement-breakpoint
ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_accepted_by_users_id_fk"
  FOREIGN KEY ("accepted_by") REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invitations_token_hash_idx" ON "invitations" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitations_workspace_idx"
  ON "invitations" ("workspace_id", "created_at");
--> statement-breakpoint
-- A session may belong to a person. Every session before this one is the installation's, so
-- the column is nullable and nothing is backfilled.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" ("user_id");
