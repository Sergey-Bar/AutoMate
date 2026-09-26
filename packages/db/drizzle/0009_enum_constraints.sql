-- Q0.15 item 8 — every enum column is constrained by the database.
--
-- Drizzle's `text(..., { enum: [...] })` is compile-time only, so a value
-- outside the list was accepted by the database: a typo, a stale writer or a
-- direct SQL write could put a state in the column that the schema says is
-- impossible, and it would then split every `GROUP BY` over that column and
-- surface as an unclassified 500 on the next read.
--
-- The value lists are extracted from the Drizzle schema by the generator, not
-- restated here, so a constraint cannot drift from the declaration it
-- enforces. `enum-constraints.test.ts` applies this file and reads the live
-- catalogue to assert that every declared enum column has a constraint, so a
-- future enum change without a matching migration fails rather than passing.
--
-- A table that already declares a CHECK for a column keeps it.

ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_role_check";
--> statement-breakpoint
ALTER TABLE "messages"
  ADD CONSTRAINT "messages_role_check"
  CHECK ("role" in ('user', 'assistant', 'system', 'tool'));
ALTER TABLE "execution_log" DROP CONSTRAINT IF EXISTS "execution_log_status_check";
--> statement-breakpoint
ALTER TABLE "execution_log"
  ADD CONSTRAINT "execution_log_status_check"
  CHECK ("status" in ('running', 'success', 'error', 'timeout'));
ALTER TABLE "runs" DROP CONSTRAINT IF EXISTS "runs_status_check";
--> statement-breakpoint
ALTER TABLE "runs"
  ADD CONSTRAINT "runs_status_check"
  CHECK ("status" in ('running', 'passed', 'failed', 'interrupted'));
ALTER TABLE "runs" DROP CONSTRAINT IF EXISTS "runs_gate_status_check";
--> statement-breakpoint
ALTER TABLE "runs"
  ADD CONSTRAINT "runs_gate_status_check"
  CHECK ("gate_status" in ('passed', 'failed', 'skipped'));
ALTER TABLE "results" DROP CONSTRAINT IF EXISTS "results_status_check";
--> statement-breakpoint
ALTER TABLE "results"
  ADD CONSTRAINT "results_status_check"
  CHECK ("status" in ('passed', 'failed', 'timedOut', 'skipped', 'interrupted'));
ALTER TABLE "quarantine" DROP CONSTRAINT IF EXISTS "quarantine_status_check";
--> statement-breakpoint
ALTER TABLE "quarantine"
  ADD CONSTRAINT "quarantine_status_check"
  CHECK ("status" in ('pending', 'approved', 'rejected'));
ALTER TABLE "failure_taxonomy_rules" DROP CONSTRAINT IF EXISTS "failure_taxonomy_rules_category_check";
--> statement-breakpoint
ALTER TABLE "failure_taxonomy_rules"
  ADD CONSTRAINT "failure_taxonomy_rules_category_check"
  CHECK ("category" in ('infra_issue', 'env_issue', 'test_debt', 'flaky', 'app_bug', 'unknown'));
ALTER TABLE "failure_taxonomy_rules" DROP CONSTRAINT IF EXISTS "failure_taxonomy_rules_pattern_target_check";
--> statement-breakpoint
ALTER TABLE "failure_taxonomy_rules"
  ADD CONSTRAINT "failure_taxonomy_rules_pattern_target_check"
  CHECK ("pattern_target" in ('error_message', 'error_stack', 'test_title', 'file_path'));
ALTER TABLE "failure_classifications" DROP CONSTRAINT IF EXISTS "failure_classifications_category_check";
--> statement-breakpoint
ALTER TABLE "failure_classifications"
  ADD CONSTRAINT "failure_classifications_category_check"
  CHECK ("category" in ('infra_issue', 'env_issue', 'test_debt', 'flaky', 'app_bug', 'unknown'));
ALTER TABLE "locator_suggestions" DROP CONSTRAINT IF EXISTS "locator_suggestions_status_check";
--> statement-breakpoint
ALTER TABLE "locator_suggestions"
  ADD CONSTRAINT "locator_suggestions_status_check"
  CHECK ("status" in ('pending', 'accepted', 'rejected', 'expired'));
ALTER TABLE "failure_clusters" DROP CONSTRAINT IF EXISTS "failure_clusters_status_check";
--> statement-breakpoint
ALTER TABLE "failure_clusters"
  ADD CONSTRAINT "failure_clusters_status_check"
  CHECK ("status" in ('active', 'resolved'));
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_check";
--> statement-breakpoint
ALTER TABLE "users"
  ADD CONSTRAINT "users_role_check"
  CHECK ("role" in ('admin', 'editor', 'viewer'));
ALTER TABLE "roles" DROP CONSTRAINT IF EXISTS "roles_name_check";
--> statement-breakpoint
ALTER TABLE "roles"
  ADD CONSTRAINT "roles_name_check"
  CHECK ("name" in ('admin', 'editor', 'viewer'));
ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_role_check";
--> statement-breakpoint
ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_role_check"
  CHECK ("role" in ('admin', 'editor', 'viewer', 'service'));
ALTER TABLE "agent_sessions" DROP CONSTRAINT IF EXISTS "agent_sessions_status_check";
--> statement-breakpoint
ALTER TABLE "agent_sessions"
  ADD CONSTRAINT "agent_sessions_status_check"
  CHECK ("status" in ('active', 'closed', 'error'));
ALTER TABLE "agent_sessions" DROP CONSTRAINT IF EXISTS "agent_sessions_file_sync_status_check";
--> statement-breakpoint
ALTER TABLE "agent_sessions"
  ADD CONSTRAINT "agent_sessions_file_sync_status_check"
  CHECK ("file_sync_status" in ('pending', 'synced', 'failed'));
ALTER TABLE "agent_session_files" DROP CONSTRAINT IF EXISTS "agent_session_files_change_type_check";
--> statement-breakpoint
ALTER TABLE "agent_session_files"
  ADD CONSTRAINT "agent_session_files_change_type_check"
  CHECK ("change_type" in ('added', 'modified', 'removed', 'renamed'));
ALTER TABLE "generated_test_suggestions" DROP CONSTRAINT IF EXISTS "generated_test_suggestions_source_type_check";
--> statement-breakpoint
ALTER TABLE "generated_test_suggestions"
  ADD CONSTRAINT "generated_test_suggestions_source_type_check"
  CHECK ("source_type" in ('pr_diff', 'requirement', 'source'));
ALTER TABLE "generated_test_suggestions" DROP CONSTRAINT IF EXISTS "generated_test_suggestions_status_check";
--> statement-breakpoint
ALTER TABLE "generated_test_suggestions"
  ADD CONSTRAINT "generated_test_suggestions_status_check"
  CHECK ("status" in ('draft', 'accepted', 'rejected', 'edited'));
ALTER TABLE "repair_attempts" DROP CONSTRAINT IF EXISTS "repair_attempts_status_check";
--> statement-breakpoint
ALTER TABLE "repair_attempts"
  ADD CONSTRAINT "repair_attempts_status_check"
  CHECK ("status" in ('payload_built', 'comment_posted', 'comment_failed', 'rerun_requested', 'escalated'));
ALTER TABLE "agent_conflicts" DROP CONSTRAINT IF EXISTS "agent_conflicts_severity_check";
--> statement-breakpoint
ALTER TABLE "agent_conflicts"
  ADD CONSTRAINT "agent_conflicts_severity_check"
  CHECK ("severity" in ('info', 'warning', 'critical'));
ALTER TABLE "agent_conflicts" DROP CONSTRAINT IF EXISTS "agent_conflicts_status_check";
--> statement-breakpoint
ALTER TABLE "agent_conflicts"
  ADD CONSTRAINT "agent_conflicts_status_check"
  CHECK ("status" in ('active', 'resolved'));
ALTER TABLE "saml_config" DROP CONSTRAINT IF EXISTS "saml_config_default_role_check";
--> statement-breakpoint
ALTER TABLE "saml_config"
  ADD CONSTRAINT "saml_config_default_role_check"
  CHECK ("default_role" in ('viewer', 'editor', 'admin'));
ALTER TABLE "audit_events" DROP CONSTRAINT IF EXISTS "audit_events_actor_type_check";
--> statement-breakpoint
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_actor_type_check"
  CHECK ("actor_type" in ('user', 'system', 'service'));
ALTER TABLE "runner_identities" DROP CONSTRAINT IF EXISTS "runner_identities_status_check";
--> statement-breakpoint
ALTER TABLE "runner_identities"
  ADD CONSTRAINT "runner_identities_status_check"
  CHECK ("status" in ('pending', 'active', 'revoked'));
