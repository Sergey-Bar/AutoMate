-- Migration: per-workspace quality gate configuration
-- Adds workspace_id column to quality_gate_config for workspace-specific gate overrides.
-- Adds max_quarantine_percent column as an anti-gaming guardrail (gates fail when
-- too many tests are quarantined, preventing teams from hiding failures via quarantine).

ALTER TABLE quality_gate_config ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE quality_gate_config ADD COLUMN max_quarantine_percent REAL;
