CREATE TABLE `failure_clusters` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`cluster_label` text NOT NULL,
	`first_seen_run_id` text,
	`last_seen_run_id` text,
	`occurrence_count` integer DEFAULT 1 NOT NULL,
	`representative_error` text NOT NULL,
	`category` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `failure_clusters_fingerprint_idx` ON `failure_clusters` (`fingerprint`);
--> statement-breakpoint
CREATE INDEX `failure_clusters_status_idx` ON `failure_clusters` (`status`);
