CREATE TABLE "agent_conflicts" (
	"id" text PRIMARY KEY NOT NULL,
	"repository" text NOT NULL,
	"session_ids" jsonb NOT NULL,
	"overlapping_files" jsonb NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"first_detected_at" timestamp with time zone NOT NULL,
	"last_detected_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_session_files" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"file_path" text NOT NULL,
	"change_type" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_session_runs" (
	"session_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"linked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_session_runs_session_id_run_id_pk" PRIMARY KEY("session_id","run_id")
);
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"repository" text NOT NULL,
	"pr_number" integer NOT NULL,
	"pr_branch" text NOT NULL,
	"base_branch" text,
	"pr_title" text,
	"pr_author" text,
	"agent_name" text NOT NULL,
	"matched_rule" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"files_last_synced_at" timestamp with time zone,
	"file_sync_status" text
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"user_id" uuid,
	"role" text DEFAULT 'admin' NOT NULL,
	"scopes" jsonb,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"tenant_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"result_id" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"path" text NOT NULL,
	"size_bytes" integer,
	"thumbnail_path" text,
	"is_screenshot_diff" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"actor_id" text NOT NULL,
	"actor_type" text DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"ip" text,
	"user_agent" text,
	"request_id" text,
	"details" jsonb,
	"tenant_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blob_shards" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"shard_index" integer NOT NULL,
	"total_shards" integer NOT NULL,
	"file_path" text NOT NULL,
	"uploaded_at" timestamp with time zone NOT NULL,
	"merged" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "defect_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "defect_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "failure_classifications" (
	"id" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"run_id" uuid NOT NULL,
	"category" text NOT NULL,
	"confidence" real NOT NULL,
	"matched_rule_id" text,
	"rationale" text NOT NULL,
	"is_manual_override" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "failure_clusters" (
	"id" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"cluster_label" text NOT NULL,
	"first_seen_run_id" uuid,
	"last_seen_run_id" uuid,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"representative_error" text NOT NULL,
	"category" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "failure_taxonomy_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"priority" integer NOT NULL,
	"category" text NOT NULL,
	"pattern" text NOT NULL,
	"pattern_target" text NOT NULL,
	"description" text NOT NULL,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fingerprint_categories" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_test_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"run_id" uuid,
	"source_type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"original_content" text NOT NULL,
	"edited_content" text,
	"language" text,
	"framework" text,
	"model_provider" text,
	"model_name" text,
	"warnings" jsonb,
	"source_metadata" jsonb,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "known_failures" (
	"id" text PRIMARY KEY NOT NULL,
	"test_title" text NOT NULL,
	"test_file" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text DEFAULT 'manual'
);
--> statement-breakpoint
CREATE TABLE "locator_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"test_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"original_selector" text NOT NULL,
	"suggested_selector" text NOT NULL,
	"confidence" real NOT NULL,
	"rationale" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nl_query_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_query" text NOT NULL,
	"generated_sql" text NOT NULL,
	"result_count" integer,
	"user_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_gate_config" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"workspace_id" text,
	"pass_rate_threshold" real DEFAULT 100 NOT NULL,
	"max_duration_ms" integer,
	"max_flaky_count" integer,
	"max_quarantine_percent" real,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quarantine" (
	"id" text PRIMARY KEY NOT NULL,
	"test_title" text NOT NULL,
	"test_file" text NOT NULL,
	"reason" text,
	"quarantined_at" timestamp with time zone NOT NULL,
	"quarantined_by" text DEFAULT 'manual',
	"status" text DEFAULT 'approved' NOT NULL,
	"flakiness_category" text,
	"category_confidence" real,
	"category_evidence" jsonb,
	"resolved_at" timestamp with time zone,
	"resolution_type" text,
	"ttf_ms" integer
);
--> statement-breakpoint
CREATE TABLE "repair_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"run_id" uuid,
	"attempt_number" integer NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb,
	"comment_url" text,
	"comment_id" text,
	"rerun_run_id" text,
	"last_processed_sha" text,
	"error_message" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "results" (
	"id" text PRIMARY KEY NOT NULL,
	"test_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"retry" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"duration_ms" integer,
	"started_at" timestamp with time zone,
	"error_message" text,
	"error_stack" text,
	"worker_index" integer,
	"parallel_index" integer,
	"stdout" jsonb,
	"stderr" jsonb,
	"steps" jsonb,
	"attachments" jsonb,
	"fingerprint" text
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"permissions" jsonb NOT NULL,
	"tenant_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"flaky" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"branch" text,
	"commit_sha" text,
	"commit_message" text,
	"triggered_by" text DEFAULT 'manual',
	"config" jsonb,
	"raw_args" text,
	"source" text DEFAULT 'live' NOT NULL,
	"gate_status" text,
	"workspace_id" text,
	"pr_number" integer,
	"pr_branch" text,
	"base_branch" text,
	"commit_author" text
);
--> statement-breakpoint
CREATE TABLE "saml_config" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_point" text NOT NULL,
	"issuer" text NOT NULL,
	"idp_cert" text NOT NULL,
	"callback_url" text NOT NULL,
	"sp_private_key" text,
	"default_role" text DEFAULT 'viewer' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"cron_expr" text NOT NULL,
	"run_options" jsonb,
	"enabled" boolean DEFAULT true,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suites" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"parent_id" text,
	"title" text NOT NULL,
	"file" text,
	"project" text
);
--> statement-breakpoint
CREATE TABLE "test_failure_correlations" (
	"id" text PRIMARY KEY NOT NULL,
	"test_stable_id" text NOT NULL,
	"source_file_path" text NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"total_occurrences" integer DEFAULT 0 NOT NULL,
	"last_updated_run_id" uuid,
	"window_start_date" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tests" (
	"id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"suite_id" text,
	"title" text NOT NULL,
	"file" text NOT NULL,
	"line" integer,
	"column" integer,
	"stable_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"duration_ms" integer,
	"tags" jsonb,
	"annotations" jsonb,
	"retry_count" integer DEFAULT 0,
	"expected_status" text,
	"worker_index" integer,
	CONSTRAINT "tests_id_run_id_pk" PRIMARY KEY("id","run_id")
);
--> statement-breakpoint
CREATE TABLE "trends" (
	"date" text NOT NULL,
	"project" text NOT NULL,
	"branch" text DEFAULT 'main' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"flaky" integer DEFAULT 0 NOT NULL,
	"avg_duration_ms" real,
	"p95_duration_ms" real,
	CONSTRAINT "trends_date_project_branch_pk" PRIMARY KEY("date","project","branch")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"saml_subject" text,
	"tenant_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"config_path" text NOT NULL,
	"test_results_dir" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"connector_name" text NOT NULL,
	"enabled" boolean DEFAULT false,
	"credential_ref" text,
	"settings" jsonb,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "connector_configs_connector_name_unique" UNIQUE("connector_name")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text,
	"flow_template_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_log" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text,
	"tool_name" text NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"status" text NOT NULL,
	"duration_ms" integer,
	"error_message" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"system_prompt" text NOT NULL,
	"steps" jsonb,
	"category" text,
	"is_built_in" boolean DEFAULT false,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"path" text NOT NULL,
	"size_bytes" integer
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tool_call_id" text,
	"tool_name" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"provider" text DEFAULT 'ollama' NOT NULL,
	"model" text DEFAULT 'llama3.1' NOT NULL,
	"endpoint" text DEFAULT 'http://localhost:11434' NOT NULL,
	"temperature" real DEFAULT 0.7,
	"max_tokens" integer DEFAULT 4096,
	"system_prompt" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace_links" (
	"id" text PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"link_type" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "vault_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"connector_name" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"salt" text NOT NULL,
	"iterations" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "vault_entries_connector_name_unique" UNIQUE("connector_name")
);
--> statement-breakpoint
ALTER TABLE "agent_session_files" ADD CONSTRAINT "agent_session_files_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_runs" ADD CONSTRAINT "agent_session_runs_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_runs" ADD CONSTRAINT "agent_session_runs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_result_id_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blob_shards" ADD CONSTRAINT "blob_shards_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_classifications" ADD CONSTRAINT "failure_classifications_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_classifications" ADD CONSTRAINT "failure_classifications_matched_rule_id_failure_taxonomy_rules_id_fk" FOREIGN KEY ("matched_rule_id") REFERENCES "public"."failure_taxonomy_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fingerprint_categories" ADD CONSTRAINT "fingerprint_categories_category_id_defect_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."defect_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_test_suggestions" ADD CONSTRAINT "generated_test_suggestions_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_test_suggestions" ADD CONSTRAINT "generated_test_suggestions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locator_suggestions" ADD CONSTRAINT "locator_suggestions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_attempts" ADD CONSTRAINT "repair_attempts_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_attempts" ADD CONSTRAINT "repair_attempts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suites" ADD CONSTRAINT "suites_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_failure_correlations" ADD CONSTRAINT "test_failure_correlations_last_updated_run_id_runs_id_fk" FOREIGN KEY ("last_updated_run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tests" ADD CONSTRAINT "tests_suite_id_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."suites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_log" ADD CONSTRAINT "execution_log_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_conflicts_repository_idx" ON "agent_conflicts" USING btree ("repository");--> statement-breakpoint
CREATE INDEX "agent_conflicts_status_idx" ON "agent_conflicts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_session_files_session_id_file_path_unique" ON "agent_session_files" USING btree ("session_id","file_path");--> statement-breakpoint
CREATE INDEX "agent_session_files_session_id_idx" ON "agent_session_files" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "agent_session_runs_session_id_idx" ON "agent_session_runs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "agent_session_runs_run_id_idx" ON "agent_session_runs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_sessions_pr_number_repository_idx" ON "agent_sessions" USING btree ("pr_number","repository");--> statement-breakpoint
CREATE INDEX "agent_sessions_status_idx" ON "agent_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_sessions_pr_branch_idx" ON "agent_sessions" USING btree ("pr_branch");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_unique" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_events_timestamp_idx" ON "audit_events" USING btree ("timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "failure_classifications_fingerprint_run_unique" ON "failure_classifications" USING btree ("fingerprint","run_id");--> statement-breakpoint
CREATE INDEX "failure_clusters_fingerprint_idx" ON "failure_clusters" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "failure_clusters_status_idx" ON "failure_clusters" USING btree ("status");--> statement-breakpoint
CREATE INDEX "generated_test_suggestions_session_id_idx" ON "generated_test_suggestions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "generated_test_suggestions_status_idx" ON "generated_test_suggestions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "repair_attempts_session_id_idx" ON "repair_attempts" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repair_attempts_session_id_attempt_number_unique" ON "repair_attempts" USING btree ("session_id","attempt_number");--> statement-breakpoint
CREATE INDEX "results_run_id_idx" ON "results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "results_test_id_idx" ON "results" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "results_fingerprint_idx" ON "results" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "results_run_id_test_id_retry_idx" ON "results" USING btree ("run_id","test_id","retry");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_unique" ON "roles" USING btree ("name");--> statement-breakpoint
CREATE INDEX "runs_started_at_idx" ON "runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "runs_finished_at_idx" ON "runs" USING btree ("finished_at");--> statement-breakpoint
CREATE INDEX "runs_workspace_id_idx" ON "runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "runs_branch_idx" ON "runs" USING btree ("branch");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "runs_pr_number_idx" ON "runs" USING btree ("pr_number");--> statement-breakpoint
CREATE INDEX "runs_commit_sha_idx" ON "runs" USING btree ("commit_sha");--> statement-breakpoint
CREATE UNIQUE INDEX "test_failure_correlations_test_file_unique" ON "test_failure_correlations" USING btree ("test_stable_id","source_file_path");--> statement-breakpoint
CREATE INDEX "tests_run_id_idx" ON "tests" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "tests_stable_id_idx" ON "tests" USING btree ("stable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "conversations_created_at_idx" ON "conversations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "execution_log_conversation_id_idx" ON "execution_log" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "execution_log_created_at_idx" ON "execution_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "trace_links_source_idx" ON "trace_links" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "trace_links_target_idx" ON "trace_links" USING btree ("target_type","target_id");