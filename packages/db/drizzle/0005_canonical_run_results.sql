CREATE TABLE IF NOT EXISTS "canonical_run_results" (
  "workspace_id" text NOT NULL,
  "run_id" text NOT NULL,
  "fingerprint" text NOT NULL,
  "result" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "canonical_run_results_workspace_run_pk" PRIMARY KEY ("workspace_id", "run_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canonical_run_results_workspace_idx" ON "canonical_run_results" ("workspace_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_events_workspace_sequence_idx" ON "outbox_events" ("workspace_id", "sequence");
