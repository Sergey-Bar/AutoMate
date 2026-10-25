-- Scheduled reports: where they go (notification_channels), when (report_subscriptions), and
-- each attempt (report_deliveries). Hard-scoped from the first migration, the `0028` shape. No
-- secret is stored here: a channel's credential is a vault_entries row named `channel:<id>`.

CREATE TABLE IF NOT EXISTS "notification_channels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_channels_kind_check"
    CHECK ("kind" IN ('inbox', 'slack', 'teams', 'telegram', 'whatsapp', 'signal'))
);
--> statement-breakpoint
ALTER TABLE "notification_channels"
  ADD CONSTRAINT "notification_channels_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_channels_workspace_idx"
  ON "notification_channels" ("workspace_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "channel_id" uuid NOT NULL,
  "name" text NOT NULL,
  "cadence" text NOT NULL,
  "cron_expr" text NOT NULL,
  "timezone" text NOT NULL,
  "project_scope" jsonb,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "report_subscriptions_cadence_check"
    CHECK ("cadence" IN ('daily', 'weekly', 'custom'))
);
--> statement-breakpoint
ALTER TABLE "report_subscriptions"
  ADD CONSTRAINT "report_subscriptions_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "report_subscriptions"
  ADD CONSTRAINT "report_subscriptions_channel_id_notification_channels_id_fk"
  FOREIGN KEY ("channel_id") REFERENCES "notification_channels"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_subscriptions_workspace_idx"
  ON "report_subscriptions" ("workspace_id", "channel_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" text NOT NULL,
  "subscription_id" uuid,
  "channel_id" uuid,
  "idempotency_key" text NOT NULL,
  "scheduled_for" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "error_code" text,
  "rendered" text,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "report_deliveries_status_check"
    CHECK ("status" IN ('pending', 'sending', 'sent', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "report_deliveries"
  ADD CONSTRAINT "report_deliveries_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "report_deliveries"
  ADD CONSTRAINT "report_deliveries_subscription_id_report_subscriptions_id_fk"
  FOREIGN KEY ("subscription_id") REFERENCES "report_subscriptions"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "report_deliveries"
  ADD CONSTRAINT "report_deliveries_channel_id_notification_channels_id_fk"
  FOREIGN KEY ("channel_id") REFERENCES "notification_channels"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "report_deliveries_idempotency_idx"
  ON "report_deliveries" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_deliveries_workspace_idx"
  ON "report_deliveries" ("workspace_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_deliveries_due_idx"
  ON "report_deliveries" ("status", "next_attempt_at")
  WHERE status IN ('pending', 'sending');
