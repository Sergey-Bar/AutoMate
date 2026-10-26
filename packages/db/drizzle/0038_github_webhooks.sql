-- GitHub webhook replay protection: the delivery ids (`X-GitHub-Delivery`) the receiver has
-- accepted, unique per workspace, so a captured request replayed later is refused. Written only
-- after the signature verified, so an unauthenticated caller cannot fill it, and bounded by the
-- receiver to seven days and 10 000 rows per workspace. Hard-scoped from the first migration.

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "provider" text DEFAULT 'github' NOT NULL,
  "delivery_id" text NOT NULL,
  "event" text NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries"
  ADD CONSTRAINT "webhook_deliveries_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_deliveries_delivery_idx"
  ON "webhook_deliveries" ("workspace_id", "provider", "delivery_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_recent_idx"
  ON "webhook_deliveries" ("workspace_id", "received_at");
