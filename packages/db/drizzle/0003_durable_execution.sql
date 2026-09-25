CREATE TABLE "runners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"protocol_version" text DEFAULT '1' NOT NULL,
	"os" text NOT NULL,
	"arch" text NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"slots" integer DEFAULT 1 NOT NULL,
	"health" text DEFAULT 'offline' NOT NULL,
	"token_hash" text NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"token_revoked_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runners_slots_check" CHECK ("runners"."slots" > 0),
	CONSTRAINT "runners_health_check" CHECK ("runners"."health" in ('healthy', 'degraded', 'draining', 'offline', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_attachment_id" text,
	"run_id" uuid NOT NULL,
	"job_id" uuid,
	"test_id" text,
	"result_id" text,
	"attempt" integer,
	"kind" text DEFAULT 'other' NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"storage_key" text NOT NULL,
	"checksum_algorithm" text DEFAULT 'sha256' NOT NULL,
	"checksum" text,
	"size_bytes" bigint,
	"expires_at" timestamp with time zone,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifacts_kind_check" CHECK ("artifacts"."kind" in ('report', 'junit', 'json', 'log', 'stdout', 'stderr', 'screenshot', 'video', 'trace', 'html', 'attachment', 'other')),
	CONSTRAINT "artifacts_attempt_check" CHECK ("artifacts"."attempt" is null or "artifacts"."attempt" > 0),
	CONSTRAINT "artifacts_size_check" CHECK ("artifacts"."size_bytes" is null or "artifacts"."size_bytes" >= 0),
	CONSTRAINT "artifacts_evidence_check" CHECK ("artifacts"."legacy_attachment_id" is not null or ("artifacts"."checksum_algorithm" = 'sha256' and "artifacts"."checksum" is not null and "artifacts"."checksum" ~ '^[0-9a-f]{64}$' and "artifacts"."size_bytes" is not null))
);
--> statement-breakpoint
INSERT INTO "artifacts" (
	"legacy_attachment_id",
	"run_id",
	"test_id",
	"result_id",
	"kind",
	"name",
	"content_type",
	"storage_key",
	"checksum_algorithm",
	"size_bytes",
	"legal_hold",
	"metadata"
)
SELECT
	"attachments"."id",
	"results"."run_id",
	"results"."test_id",
	"attachments"."result_id",
	'other',
	"attachments"."name",
	"attachments"."content_type",
	"attachments"."path",
	'legacy',
	"attachments"."size_bytes",
	COALESCE("attachments"."is_screenshot_diff", false),
	jsonb_build_object(
		'legacyAttachmentId', "attachments"."id",
		'legacyThumbnailPath', "attachments"."thumbnail_path",
		'legacyScreenshotDiff', "attachments"."is_screenshot_diff",
		'checksumStatus', 'unknown'
	)
FROM "attachments"
INNER JOIN "results" ON "results"."id" = "attachments"."result_id";
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text DEFAULT 'browser' NOT NULL,
	"base_url" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"timeout_ms" integer NOT NULL,
	"required_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lease_id" text,
	"lease_owner" uuid,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"fencing_token" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_jobs_attempt_check" CHECK ("execution_jobs"."attempt" > 0),
	CONSTRAINT "execution_jobs_timeout_check" CHECK ("execution_jobs"."timeout_ms" > 0),
	CONSTRAINT "execution_jobs_state_check" CHECK ("execution_jobs"."state" in ('queued', 'leased', 'completed', 'failed', 'cancelled', 'requeued')),
	CONSTRAINT "execution_jobs_fencing_token_check" CHECK ("execution_jobs"."fencing_token" >= 0),
	CONSTRAINT "execution_jobs_lease_check" CHECK ("execution_jobs"."state" <> 'leased' or ("execution_jobs"."lease_id" is not null and "execution_jobs"."lease_owner" is not null and "execution_jobs"."lease_expires_at" is not null and "execution_jobs"."fencing_token" > 0))
);
--> statement-breakpoint
CREATE TABLE "gate_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"release_id" uuid,
	"policy_id" uuid NOT NULL,
	"policy_version" text NOT NULL,
	"policy_hash" text NOT NULL,
	"status" text NOT NULL,
	"decision" text NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"domain_statuses" jsonb NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gate_evaluations_status_check" CHECK ("gate_evaluations"."status" in ('passed', 'failed', 'warning', 'unknown', 'not_evaluated')),
	CONSTRAINT "gate_evaluations_decision_check" CHECK ("gate_evaluations"."decision" in ('ready', 'ready_with_warnings', 'blocked', 'unknown')),
	CONSTRAINT "gate_evaluations_policy_hash_check" CHECK ("gate_evaluations"."policy_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
INSERT INTO "workspaces" ("id", "name", "config_path", "created_at")
VALUES ('default-workspace', 'Default workspace', 'default-workspace', now())
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"default_branch" text,
	"repository_url" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"hash" text NOT NULL,
	"required_domains" jsonb DEFAULT '["browser"]'::jsonb NOT NULL,
	"browser_pass_rate_threshold" real DEFAULT 100 NOT NULL,
	"max_flaky_rate" real DEFAULT 0 NOT NULL,
	"max_duration_ms" integer,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quality_policies_hash_check" CHECK ("quality_policies"."hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "quality_policies_browser_pass_rate_check" CHECK ("quality_policies"."browser_pass_rate_threshold" >= 0 and "quality_policies"."browser_pass_rate_threshold" <= 100),
	CONSTRAINT "quality_policies_flaky_rate_check" CHECK ("quality_policies"."max_flaky_rate" >= 0 and "quality_policies"."max_flaky_rate" <= 100),
	CONSTRAINT "quality_policies_duration_check" CHECK ("quality_policies"."max_duration_ms" is null or "quality_policies"."max_duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"branch" text,
	"commit_sha" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"event_id" text NOT NULL,
	"version" text DEFAULT '1' NOT NULL,
	"run_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"job_id" uuid,
	"sequence" bigint NOT NULL,
	"source" text NOT NULL,
	"event_key" text NOT NULL,
	"hash" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"lease_id" text,
	"fencing_token" integer DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_events_workspace_id_event_id_pk" PRIMARY KEY("workspace_id","event_id"),
	CONSTRAINT "run_events_sequence_check" CHECK ("run_events"."sequence" > 0),
	CONSTRAINT "run_events_hash_check" CHECK ("run_events"."hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "run_events_fencing_token_check" CHECK ("run_events"."fencing_token" >= 0)
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "phase" text DEFAULT 'queued' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "blocked" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "unknown" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "source_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "commit" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "configuration" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "framework" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "adapter_version" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "test_type" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "environment_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "release_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "suite" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "selection" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "required_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "labels" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "timeout_ms" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "policy_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "retry_of_run_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "runner_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "current_job_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "event_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cancel_requested_by" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "error_details" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "raw_evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "runs" SET
	"raw_evidence_refs" = COALESCE((
		SELECT jsonb_agg("artifacts"."id"::text ORDER BY "artifacts"."created_at", "artifacts"."id")
		FROM "artifacts"
		WHERE "artifacts"."run_id" = "runs"."id" AND "artifacts"."legacy_attachment_id" IS NOT NULL
	), '[]'::jsonb)
WHERE EXISTS (
	SELECT 1
	FROM "artifacts"
	WHERE "artifacts"."run_id" = "runs"."id" AND "artifacts"."legacy_attachment_id" IS NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "queued_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "runs" SET
	"completed_at" = "finished_at",
	"queued_at" = "started_at",
	"created_at" = "started_at",
	"updated_at" = COALESCE("finished_at", "started_at"),
	"commit" = "commit_sha",
	"configuration" = COALESCE("config", '{}'::jsonb),
	"phase" = CASE "status"
		WHEN 'passed' THEN 'complete'
		WHEN 'failed' THEN 'complete'
		WHEN 'interrupted' THEN 'runner_lost'
		ELSE 'running'
	END,
	"outcome" = CASE "status"
		WHEN 'passed' THEN 'passed'
		WHEN 'failed' THEN 'failed'
		WHEN 'interrupted' THEN 'runner_lost'
		ELSE NULL
	END;
--> statement-breakpoint
ALTER TABLE "runners" ADD CONSTRAINT "runners_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_job_id_execution_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."execution_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_result_id_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."results"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_lease_owner_runners_id_fk" FOREIGN KEY ("lease_owner") REFERENCES "public"."runners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_evaluations" ADD CONSTRAINT "gate_evaluations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_evaluations" ADD CONSTRAINT "gate_evaluations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_evaluations" ADD CONSTRAINT "gate_evaluations_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_evaluations" ADD CONSTRAINT "gate_evaluations_policy_id_quality_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."quality_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_policies" ADD CONSTRAINT "quality_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_job_id_execution_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."execution_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_policy_id_quality_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."quality_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_current_job_id_execution_jobs_id_fk" FOREIGN KEY ("current_job_id") REFERENCES "public"."execution_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runners_workspace_name_unique" ON "runners" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "runners_token_hash_unique" ON "runners" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "runners_workspace_health_idx" ON "runners" USING btree ("workspace_id","health");--> statement-breakpoint
CREATE INDEX "runners_heartbeat_idx" ON "runners" USING btree ("last_heartbeat_at");--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_legacy_attachment_unique" ON "artifacts" USING btree ("legacy_attachment_id");--> statement-breakpoint
CREATE INDEX "artifacts_run_created_idx" ON "artifacts" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "artifacts_job_idx" ON "artifacts" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "artifacts_test_idx" ON "artifacts" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "artifacts_result_idx" ON "artifacts" USING btree ("result_id");--> statement-breakpoint
CREATE INDEX "artifacts_expiry_idx" ON "artifacts" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_workspace_slug_unique" ON "environments" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "environments_workspace_idx" ON "environments" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "environments_project_idx" ON "environments" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_jobs_run_attempt_unique" ON "execution_jobs" USING btree ("run_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_jobs_workspace_idempotency_unique" ON "execution_jobs" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "execution_jobs_claim_idx" ON "execution_jobs" USING btree ("state","available_at","priority");--> statement-breakpoint
CREATE INDEX "execution_jobs_lease_expiry_idx" ON "execution_jobs" USING btree ("state","lease_expires_at");--> statement-breakpoint
CREATE INDEX "execution_jobs_workspace_idx" ON "execution_jobs" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gate_evaluations_run_policy_hash_unique" ON "gate_evaluations" USING btree ("run_id","policy_id","policy_hash");--> statement-breakpoint
CREATE INDEX "gate_evaluations_workspace_evaluated_idx" ON "gate_evaluations" USING btree ("workspace_id","evaluated_at");--> statement-breakpoint
CREATE INDEX "gate_evaluations_release_evaluated_idx" ON "gate_evaluations" USING btree ("release_id","evaluated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_slug_unique" ON "projects" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "projects_workspace_idx" ON "projects" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quality_policies_workspace_name_version_unique" ON "quality_policies" USING btree ("workspace_id","name","version");--> statement-breakpoint
CREATE UNIQUE INDEX "quality_policies_workspace_default_unique" ON "quality_policies" USING btree ("workspace_id") WHERE "quality_policies"."is_default" = true;--> statement-breakpoint
CREATE INDEX "quality_policies_workspace_idx" ON "quality_policies" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "releases_workspace_project_version_unique" ON "releases" USING btree ("workspace_id","project_id","version");--> statement-breakpoint
CREATE INDEX "releases_workspace_idx" ON "releases" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "releases_project_idx" ON "releases" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_run_sequence_unique" ON "run_events" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_workspace_event_key_unique" ON "run_events" USING btree ("workspace_id","event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_run_hash_unique" ON "run_events" USING btree ("run_id","hash");--> statement-breakpoint
CREATE INDEX "run_events_run_received_idx" ON "run_events" USING btree ("run_id","received_at");--> statement-breakpoint
CREATE INDEX "run_events_workspace_received_idx" ON "run_events" USING btree ("workspace_id","received_at");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_retry_of_run_id_runs_id_fk" FOREIGN KEY ("retry_of_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_workspace_timestamp_idx" ON "audit_events" USING btree ("workspace_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_workspace_external_source_unique" ON "runs" USING btree ("workspace_id","source","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_workspace_idempotency_unique" ON "runs" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "runs_phase_outcome_idx" ON "runs" USING btree ("workspace_id","phase","outcome");--> statement-breakpoint
CREATE INDEX "runs_project_created_idx" ON "runs" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "runs_environment_created_idx" ON "runs" USING btree ("environment_id","started_at");--> statement-breakpoint
CREATE INDEX "runs_release_created_idx" ON "runs" USING btree ("release_id","started_at");--> statement-breakpoint
CREATE INDEX "runs_runner_idx" ON "runs" USING btree ("runner_id");--> statement-breakpoint
CREATE INDEX "runs_current_job_idx" ON "runs" USING btree ("current_job_id");--> statement-breakpoint
CREATE INDEX "runs_retry_of_idx" ON "runs" USING btree ("retry_of_run_id");--> statement-breakpoint
CREATE INDEX "runs_commit_idx" ON "runs" USING btree ("commit");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_phase_check" CHECK ("runs"."phase" in ('queued', 'assigned', 'preparing', 'running', 'collecting', 'normalizing', 'analyzing', 'gate_evaluation', 'complete', 'cancelled', 'timed_out', 'runner_lost', 'infra_failed', 'config_failed', 'blocked', 'partial'));--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_outcome_check" CHECK ("runs"."outcome" is null or "runs"."outcome" in ('passed', 'failed', 'unknown', 'partial', 'cancelled', 'timed_out', 'runner_lost', 'infra_failed', 'config_failed', 'blocked'));--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_phase_outcome_check" CHECK (("runs"."phase" in ('complete', 'cancelled', 'timed_out', 'runner_lost', 'infra_failed', 'config_failed', 'blocked', 'partial')) = ("runs"."outcome" is not null));--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_attempt_check" CHECK ("runs"."attempt" > 0);--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_event_sequence_check" CHECK ("runs"."event_sequence" >= 0);--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_timeout_check" CHECK ("runs"."timeout_ms" is null or "runs"."timeout_ms" > 0);--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_summary_check" CHECK ("runs"."total" >= 0 and "runs"."passed" >= 0 and "runs"."failed" >= 0 and "runs"."flaky" >= 0 and "runs"."skipped" >= 0 and "runs"."blocked" >= 0 and "runs"."unknown" >= 0);