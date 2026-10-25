-- One-time device pairing codes for LAN mode. An admin issues one; a device exchanges it,
-- within ten minutes and once, for a viewer or operator access token. Only an HMAC of the
-- code is stored. Hard-scoped from the first migration, the `0028` shape.

CREATE TABLE IF NOT EXISTS "pairing_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "code_hash" text NOT NULL,
  "role" text NOT NULL,
  "device_name" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "token_id" uuid,
  CONSTRAINT "pairing_codes_role_check" CHECK ("role" IN ('viewer', 'operator'))
);
--> statement-breakpoint
ALTER TABLE "pairing_codes"
  ADD CONSTRAINT "pairing_codes_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "pairing_codes"
  ADD CONSTRAINT "pairing_codes_token_id_access_tokens_id_fk"
  FOREIGN KEY ("token_id") REFERENCES "access_tokens"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- Not unique: six digits repeat over time; the service refuses to issue a value a live code holds.
CREATE INDEX IF NOT EXISTS "pairing_codes_hash_idx" ON "pairing_codes" ("code_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pairing_codes_workspace_idx"
  ON "pairing_codes" ("workspace_id", "created_at");
