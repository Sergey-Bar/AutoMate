-- T13: Quarantine approval workflow
-- Add status column to quarantine table.
-- Default 'approved' preserves backward compatibility for existing entries.
ALTER TABLE quarantine ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';
