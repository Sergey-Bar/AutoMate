CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`result_id` text NOT NULL,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`path` text NOT NULL,
	`size_bytes` integer,
	`thumbnail_path` text,
	`is_screenshot_diff` integer DEFAULT false,
	FOREIGN KEY (`result_id`) REFERENCES `results`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `blob_shards` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`shard_index` integer NOT NULL,
	`total_shards` integer NOT NULL,
	`file_path` text NOT NULL,
	`uploaded_at` text NOT NULL,
	`merged` integer DEFAULT false
);
--> statement-breakpoint
CREATE TABLE `defect_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#6b7280' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `defect_categories_name_unique` ON `defect_categories` (`name`);--> statement-breakpoint
CREATE TABLE `failure_classifications` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`run_id` text NOT NULL,
	`category` text NOT NULL,
	`confidence` real NOT NULL,
	`matched_rule_id` text,
	`rationale` text NOT NULL,
	`is_manual_override` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`matched_rule_id`) REFERENCES `failure_taxonomy_rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `failure_classifications_fingerprint_run_unique` ON `failure_classifications` (`fingerprint`,`run_id`);--> statement-breakpoint
CREATE TABLE `failure_taxonomy_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`priority` integer NOT NULL,
	`category` text NOT NULL,
	`pattern` text NOT NULL,
	`pattern_target` text NOT NULL,
	`description` text NOT NULL,
	`is_built_in` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fingerprint_categories` (
	`fingerprint` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`assigned_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `defect_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `known_failures` (
	`id` text PRIMARY KEY NOT NULL,
	`test_title` text NOT NULL,
	`test_file` text NOT NULL,
	`comment` text,
	`created_at` text NOT NULL,
	`created_by` text DEFAULT 'manual'
);
--> statement-breakpoint
CREATE TABLE `locator_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`test_id` text NOT NULL,
	`run_id` text NOT NULL,
	`original_selector` text NOT NULL,
	`suggested_selector` text NOT NULL,
	`confidence` real NOT NULL,
	`rationale` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `nl_query_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_query` text NOT NULL,
	`generated_sql` text NOT NULL,
	`result_count` integer,
	`user_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quality_gate_config` (
	`id` text PRIMARY KEY DEFAULT 'global' NOT NULL,
	`pass_rate_threshold` real DEFAULT 100 NOT NULL,
	`max_duration_ms` integer,
	`max_flaky_count` integer,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quarantine` (
	`id` text PRIMARY KEY NOT NULL,
	`test_title` text NOT NULL,
	`test_file` text NOT NULL,
	`reason` text,
	`quarantined_at` text NOT NULL,
	`quarantined_by` text DEFAULT 'manual'
);
--> statement-breakpoint
CREATE TABLE `results` (
	`id` text PRIMARY KEY NOT NULL,
	`test_id` text NOT NULL,
	`run_id` text NOT NULL,
	`retry` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`duration_ms` integer,
	`started_at` text,
	`error_message` text,
	`error_stack` text,
	`worker_index` integer,
	`parallel_index` integer,
	`stdout` text,
	`stderr` text,
	`steps` text,
	`attachments` text,
	`fingerprint` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `results_run_id_idx` ON `results` (`run_id`);--> statement-breakpoint
CREATE INDEX `results_test_id_idx` ON `results` (`test_id`);--> statement-breakpoint
CREATE INDEX `results_fingerprint_idx` ON `results` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `results_run_id_test_id_retry_idx` ON `results` (`run_id`,`test_id`,`retry`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text DEFAULT 'running' NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`passed` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`flaky` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`branch` text,
	`commit_sha` text,
	`commit_message` text,
	`triggered_by` text DEFAULT 'manual',
	`config` text,
	`raw_args` text,
	`source` text DEFAULT 'live' NOT NULL,
	`gate_status` text,
	`workspace_id` text,
	`pr_number` integer,
	`pr_branch` text,
	`base_branch` text,
	`commit_author` text
);
--> statement-breakpoint
CREATE INDEX `runs_started_at_idx` ON `runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `runs_finished_at_idx` ON `runs` (`finished_at`);--> statement-breakpoint
CREATE INDEX `runs_workspace_id_idx` ON `runs` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `runs_branch_idx` ON `runs` (`branch`);--> statement-breakpoint
CREATE INDEX `runs_status_idx` ON `runs` (`status`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`cron_expr` text NOT NULL,
	`run_options` text,
	`enabled` integer DEFAULT true,
	`last_run_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suites` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`parent_id` text,
	`title` text NOT NULL,
	`file` text,
	`project` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `test_failure_correlations` (
	`id` text PRIMARY KEY NOT NULL,
	`test_stable_id` text NOT NULL,
	`source_file_path` text NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`total_occurrences` integer DEFAULT 0 NOT NULL,
	`last_updated_run_id` text,
	`window_start_date` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`last_updated_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `test_failure_correlations_test_file_unique` ON `test_failure_correlations` (`test_stable_id`,`source_file_path`);--> statement-breakpoint
CREATE TABLE `tests` (
	`id` text NOT NULL,
	`run_id` text NOT NULL,
	`suite_id` text,
	`title` text NOT NULL,
	`file` text NOT NULL,
	`line` integer,
	`column` integer,
	`stable_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`duration_ms` integer,
	`tags` text,
	`annotations` text,
	`retry_count` integer DEFAULT 0,
	`expected_status` text,
	`worker_index` integer,
	PRIMARY KEY(`id`, `run_id`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`suite_id`) REFERENCES `suites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tests_run_id_idx` ON `tests` (`run_id`);--> statement-breakpoint
CREATE INDEX `tests_stable_id_idx` ON `tests` (`stable_id`);--> statement-breakpoint
CREATE TABLE `trends` (
	`date` text NOT NULL,
	`project` text NOT NULL,
	`branch` text DEFAULT 'main' NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`passed` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`flaky` integer DEFAULT 0 NOT NULL,
	`avg_duration_ms` real,
	`p95_duration_ms` real,
	PRIMARY KEY(`date`, `project`, `branch`)
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`config_path` text NOT NULL,
	`test_results_dir` text,
	`created_at` text NOT NULL
);
