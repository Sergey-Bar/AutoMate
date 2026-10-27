-- SCIM 2.0 provisioning (ADR-014, enterprise). Additive only.
--
-- `scim_tokens` is the credential an identity provider's provisioning connection presents: one
-- per workspace connection, stored only as a sha256 of its secret, and hard-scoped from the
-- first migration (the `0028` shape). Every SCIM read and write is scoped to the workspace of
-- the token that made it.
--
-- `users.external_id` is the identity provider's own id for a person it provisioned, which a
-- provider filters on (`externalId eq "…"`). A provisioned person has no issuer or subject until
-- their first single sign-on, which links the row by email.

CREATE TABLE IF NOT EXISTS "scim_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "name" text NOT NULL,
  "token_hash" text NOT NULL,
  "display_prefix" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "scim_tokens"
  ADD CONSTRAINT "scim_tokens_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scim_tokens_hash_idx" ON "scim_tokens" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scim_tokens_workspace_idx" ON "scim_tokens" ("workspace_id", "created_at");
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "external_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_external_id_idx" ON "users" ("external_id");
