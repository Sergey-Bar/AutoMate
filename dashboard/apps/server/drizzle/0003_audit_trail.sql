-- Migration: 0003_audit_trail.sql
-- Adds audit_events table for persistent audit logging.
-- Actor is a text field (not FK) so records survive user/key deletion.

CREATE TABLE IF NOT EXISTS `audit_events` (
  `id` text PRIMARY KEY NOT NULL,
  `timestamp` text NOT NULL,
  `actor_id` text NOT NULL,
  `actor_type` text NOT NULL DEFAULT 'user',
  `action` text NOT NULL,
  `resource_type` text,
  `resource_id` text,
  `ip` text,
  `user_agent` text,
  `request_id` text,
  `details` text,
  `tenant_id` text,
  `created_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `audit_events_actor_idx` ON `audit_events` (`actor_id`);
CREATE INDEX IF NOT EXISTS `audit_events_action_idx` ON `audit_events` (`action`);
CREATE INDEX IF NOT EXISTS `audit_events_timestamp_idx` ON `audit_events` (`timestamp`);
